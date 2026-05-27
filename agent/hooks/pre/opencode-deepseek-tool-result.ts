// DeepSeek 工具返回结果优化钩子（增强版 v2）
//
// DeepSeek 模型在处理工具返回结果时对内容格式敏感。
// 此钩子优化所有工具的结果格式，确保：
//   1. 内容从不为空/null — 无输出也提供有意义的消息
//   2. 工具特定格式化 — read/search/bash/edit/write 等优化展示
//   3. 数量/行数统计 — 大型结果前加摘要行
//   4. 错误信息规范化 — 确保 DeepSeek 能理解错误原因
//   5. ANSI 终端码清理 — 移除 bash 输出中的控制字符
//   6. 结果结构清晰 — 使用统一的前缀标记

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

/**
 * 从内容块中提取纯文本
 * 处理 content: [{ type: "text", text: "..." }, ...] 格式
 */
function extractText(blocks: unknown): string {
  if (!blocks) return "";
  if (typeof blocks === "string") return blocks;
  if (Array.isArray(blocks)) {
    return blocks
      .map((b: Record<string, unknown>) => {
        if (typeof b?.text === "string") return b.text;
        if (typeof b?.content === "string") return b.content;
        if (typeof b === "string") return b;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof blocks === "object" && blocks !== null) {
    const obj = blocks as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}

/**
 * 移除 ANSI 终端转义序列
 */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * 清理 bash 输出中的终端噪声
 */
function cleanBashOutput(text: string): string {
  let cleaned = stripAnsi(text);
  cleaned = cleaned.replace(/\n{4,}/g, "\n\n\n");
  cleaned = cleaned.replace(/\n[$#%>]\s*$/, "");
  return cleaned.trim();
}

/**
 * 格式化 read 工具结果
 */
function formatReadResult(text: string, input: unknown): string {
  if (!text.trim()) {
    const path = (input as Record<string, unknown>)?.path ?? "unknown";
    return `[File "${path}" is empty]`;
  }
  return text;
}

/**
 * 格式化 search 工具结果
 */
function formatSearchResult(text: string): string {
  if (!text.trim()) return "[No matches found]";
  const matchLines = text.split("\n").filter((l) => l.startsWith("*")).length;
  const header = matchLines > 0 ? `[Search: ${matchLines} match(es)]` : "";
  if (header && !text.startsWith("[")) return header + "\n" + text;
  return text;
}

/**
 * 格式化 bash 工具结果
 */
function formatBashResult(text: string, isError: boolean): string {
  if (isError) {
    const cleaned = cleanBashOutput(text);
    return cleaned || "[Command failed with no output]";
  }

  const cleaned = cleanBashOutput(text);
  if (!cleaned) return "[Command produced no output]";

  const lines = cleaned.split("\n");
  if (lines.length > 50) {
    return `[Output: ${lines.length} lines]\n${cleaned}`;
  }
  return cleaned;
}

/**
 * 格式化 edit 工具结果
 */
function formatEditResult(text: string, isError: boolean): string {
  if (isError) {
    const msg = text.trim() || "no details";
    return `[Edit failed] ${msg}`;
  }
  if (!text.trim()) return "[Edit applied successfully]";
  return text;
}

/**
 * 格式化 find 工具结果
 */
function formatFindResult(text: string): string {
  if (!text.trim()) return "[No files found]";
  const files = text.split("\n").filter(Boolean);
  const header = `[Found ${files.length} file(s)]`;
  if (files.length > 20) {
    return (
      header + "\n" +
      files.slice(0, 20).join("\n") +
      `\n... and ${files.length - 20} more`
    );
  }
  return header + "\n" + text;
}

/**
 * 格式化 write 工具结果
 */
function formatWriteResult(text: string, input: unknown): string {
  if (!text.trim()) {
    const path = (input as Record<string, unknown>)?.path ?? "unknown";
    return `[File written: ${path}]`;
  }
  return text;
}

/**
 * 格式化 browser 工具结果（可能含大量截图/base64）
 */
function formatBrowserResult(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return "[Browser returned no content]";
  return cleaned;
}

/**
 * 格式化错误结果
 */
function formatError(text: string, toolName: string): string {
  const msg = text.trim() || "no error message";
  return `[${toolName} error] ${msg}`;
}

/**
 * 通用保底：确保内容非空
 */
function ensureNonEmpty(text: string, toolName: string, isError: boolean): string {
  if (text.trim()) return text;
  if (isError) return `[${toolName} failed with no error details]`;
  return `[${toolName} completed with no output]`;
}

export default function (pi: HookAPI): void {
  pi.on("tool_result", async (event) => {
    const { toolName, content: blocks, isError, input } = event;

    // 1. 提取文本内容
    let text = extractText(blocks);

    // 2. 错误结果特殊处理
    if (isError) {
      return {
        content: formatError(text, toolName),
        details: { toolName, isError: true },
      };
    }

    // 3. 工具特定格式化
    switch (toolName) {
      case "read":
        text = formatReadResult(text, input);
        break;
      case "search":
        text = formatSearchResult(text);
        break;
      case "bash":
        text = formatBashResult(text, false);
        break;
      case "edit":
      case "ast_edit":
        text = formatEditResult(text, false);
        break;
      case "find":
        text = formatFindResult(text);
        break;
      case "write":
        text = formatWriteResult(text, input);
        break;
      case "browser":
        text = formatBrowserResult(text);
        break;
    }

    // 4. 通用保证：内容非空
    text = ensureNonEmpty(text, toolName, false);

    return { content: text };
  });
}
