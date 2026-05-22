// DeepSeek 编辑锚点验证钩子
//
// 问题: DeepSeek 模型在调用 edit 工具时偶尔省略锚点的 2 位 hash 后缀，
// 例如将 "9yf" 写成 "9"，导致 edit 工具拒绝操作。
//
// 解决: 此钩子在 edit 工具执行前验证 input 中的锚点格式。
// 如果检测到格式错误的锚点，会阻塞调用并提供清晰的错误信息，
// 引导模型重新读取文件获取正确的锚点。
//
// 锚点格式: 行号 + 2 位 hash（如 "9yf", "123ab"）
// 正则: /^\d+[a-z0-9]{2}$/

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

/**
 * 解析 edit input 中的锚点引用
 * edit DSL 格式:
 *   @@ PATH
 *   OP ANCHOR          ( + 1..5, < 3..7, - 10..15)
 *   或
 *   OP ANCHOR..ANCHOR  ( = 9yf..10he)
 */
function extractAnchors(input: string): { line: number; raw: string }[] {
  const anchors: { line: number; raw: string }[] = [];
  const lines = input.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过空行、注释行、@@ header、~ payload
    if (!trimmed || trimmed.startsWith("@@") || trimmed.startsWith("~") || trimmed.startsWith("#")) {
      continue;
    }

    // 匹配操作符行: OP ANCHOR 或 OP ANCHOR..ANCHOR
    // 操作符: + < - =
    const opMatch = trimmed.match(/^[+\-<=]\s+(.+)$/);
    if (!opMatch) continue;

    const anchorPart = opMatch[1];
    // 拆分 "X..Y" 或单独 "X"
    const parts = anchorPart.split("..");
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

// 有效锚点: 数字 + 恰好 2 个 hex/base36 字符
const VALID_ANCHOR_RE = /^\d+[a-z0-9]{2}$/i;

function validateAnchors(anchors: { line: number; raw: string }[]): string[] {
  const errors: string[] = [];
  for (const a of anchors) {
    if (!VALID_ANCHOR_RE.test(a.raw)) {
      errors.push(
        `Anchor "${a.raw}" 缺少 hash 后缀。` +
        `正确格式如 "${a.line}xy" (行号 + 2位hash)。` +
        `请用 read 工具以 raw 模式重新读取文件，获取带 hash 的锚点后再构造 edit 调用。`
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
          `提示: 先用 read <文件>:raw 获取精确锚点，然后直接复制使用。`,
      };
    }
  });
}
