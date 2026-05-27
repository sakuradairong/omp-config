// DeepSeek 编辑锚点验证钩子（增强版）
//
// 问题: DeepSeek 模型在调用 edit 工具时偶尔省略锚点的 2 位 hash 后缀，
// 例如将 "9yf" 写成 "9"，导致 edit 工具拒绝操作。
//
// 解决:
// 1. 验证锚点格式是否匹配 /^\d+[a-z0-9]{2}$/i（行号 + 2 位 hash）
// 2. 如果锚点仅为行号（缺少 hash 后缀），给出明确的修复指引
// 3. 锚点格式错误时阻塞调用，并提示模型重新读取文件
//
// 锚点格式: 行号 + 2 位 hash（如 "9yf", "123ab"）

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

// 有效锚点: 数字 + 恰好 2 个 alphanumeric 字符
const VALID_ANCHOR_RE = /^\d+[a-z0-9]{2}$/i;

// 纯数字锚点（缺少 hash 后缀）
const NUMERIC_ONLY_RE = /^\d+$/;

/**
 * 解析 edit input 中的锚点引用
 * edit DSL 格式:
 *   @@ PATH
 *   OP ANCHOR          (» 5 or « 10 or ≔ 42)
 *   OP A..B            (≔ 9yf..10he — range)
 */
function extractAnchors(input: string): { line: number; raw: string }[] {
  const anchors: { line: number; raw: string }[] = [];
  const lines = input.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("@@") || trimmed.startsWith("~") || trimmed.startsWith("#")) continue;

    // Match op + anchor: » 5yf, « 3ab, ≔ 1df..42he
    const opMatch = trimmed.match(/^[»«≔><+\-=]\s+(.+)$/);
    if (!opMatch) continue;

    const anchorPart = opMatch[1];
    // Split "A..B" or "A.." or standalone "A"
    const parts = anchorPart.split(/\.{2,}/);
    for (const part of parts) {
      const m = part.trim().match(/^(\d+)([a-z0-9]*)$/i);
      if (m) {
        anchors.push({
          line: parseInt(m[1], 10),
          raw: part.trim(),
        });
      }
    }
  }

  return anchors;
}

/**
 * 验证锚点格式，返回错误信息列表
 */
function validateAnchors(anchors: { line: number; raw: string }[]): string[] {
  const errors: string[] = [];
  for (const a of anchors) {
    if (VALID_ANCHOR_RE.test(a.raw)) continue;

    if (NUMERIC_ONLY_RE.test(a.raw)) {
      // 纯数字锚点—缺少 2 字符 hash 后缀
      errors.push(
        `锚点 "${a.raw}" 缺少 hash 后缀。` +
        `正确格式 "${a.raw}ab"（行号 + 2位字符）。` +
        `请用 read 工具重新读取该文件，` +
        `直接从输出中复制带 hash 的锚点。`
      );
    } else {
      errors.push(
        `锚点 "${a.raw}" 格式无效。` +
        `正确格式如 "${a.line}ab"（行号 + 2位hash）。` +
        `请用 read <文件>:raw 获取精确锚点后重试。`
      );
    }
  }
  return errors;
}

export default function (pi: HookAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "edit") return;

    const rawInput = (event.input as any)?.input;
    if (!rawInput || typeof rawInput !== "string") return;

    const anchors = extractAnchors(rawInput);
    if (anchors.length === 0) return;

    const errors = validateAnchors(anchors);
    if (errors.length > 0) {
      return {
        block: true,
        reason:
          `Edit 锚点格式错误:\n${errors.join("\n")}\n\n` +
          `提示: 先用 read <文件>:raw 获取完整锚点，` +
          `然后直接复制使用，不要手动编写 hash 后缀。`,
      };
    }
  });
}
