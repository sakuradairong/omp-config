// DeepSeek V4 思维链兼容钩子（精简版）
//
// DeepSeek 思考模式核心规则:
//   1. 有工具调用的 assistant 轮次:
//      reasoning_content 必须完整回传，否则 API 返回 400
//   2. 无工具调用的 assistant 轮次:
//      reasoning_content 可忽略（API 自动忽略）
//
// 职责范围（单一职责）:
//   - 只处理 reasoning_content 字段的补全和修复
//   - 工具参数修复由 opencode-deepseek-tool-repair.ts 处理
//
// 参考资料: https://api-docs.deepseek.com/zh-cn/guides/thinking_mode

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

/**
 * 检查 assistant 消息是否有 reasoning/thinking 字段
 * DeepSeek 使用 "reasoning_content"（OpenAI 格式）
 * 其他 provider 可能用 "reasoning"、"reasoning_text"
 */
function hasReasoningContent(msg: Record<string, unknown>): boolean {
  return (
    msg.reasoning_content !== undefined ||
    msg.reasoning !== undefined ||
    msg.reasoning_text !== undefined
  );
}

/**
 * 为 tool_calls 消息补全合适的 reasoning_content 占位符
 * DeepSeek V4 要求:
 *   - 如果 assistant 消息包含 tool_calls，必须同时有 reasoning_content
 *   - 值可以是空字符串或空格（仅占位）
 *   - 缺失会返回 HTTP 400
 */
function ensureReasoningContent(msg: Record<string, unknown>): boolean {
  if (hasReasoningContent(msg)) return false;

  // 检查是否有 tool_calls
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) return false;

  // 注入空格占位符
  // 空格对非 DeepSeek API 也无害，只是被忽略
  msg.reasoning_content = " ";
  return true;
}

export default function (pi: HookAPI): void {
  pi.on("context", async (event, _ctx) => {
    const msgs = event.messages;
    if (!msgs || !Array.isArray(msgs) || msgs.length === 0) return;

    let needsPatch = false;

    for (const msg of msgs) {
      if (msg.role !== "assistant") continue;

      // 补全 reasoning_content
      if (ensureReasoningContent(msg)) {
        needsPatch = true;
      }
    }

    if (needsPatch) {
      return { messages: msgs };
    }
  });
}
