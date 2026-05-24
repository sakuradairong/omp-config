// DeepSeek V4 思维链兼容钩子
//
// DeepSeek 思考模式核心规则:
//   1. 启用思考模式: extra_body={"thinking": {"type": "enabled"}}
//      + reasoning_effort="max" (xhigh → max)
//   2. 有工具调用的 assistant 轮次:
//      reasoning_content 必须完整回传，否则 API 返回 400
//   3. 无工具调用的 assistant 轮次:
//      reasoning_content 可忽略（API 自动忽略）
//
// 此钩子只负责 reasoning_content 补丁。
// tool_calls 参数修复已交由 opencode-deepseek-tool-repair.ts 统一处理。
//
// 参考资料: https://api-docs.deepseek.com/zh-cn/guides/thinking_mode

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

export default function (pi: HookAPI): void {
  pi.on("context", async (event) => {
    const msgs = event.messages;
    if (!msgs || !Array.isArray(msgs) || msgs.length === 0) return;

    let needsPatch = false;

    for (const msg of msgs) {
      if (msg.role !== "assistant") continue;

      const toolCalls = (msg as any).tool_calls ?? (msg as any).toolCalls;
      if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) continue;

      // 补全 reasoning_content：DeepSeek V4 要求 tool_calls 轮次必须有 reasoning_content
      // 缺少时使用空格占位符 — 安全，对非 DeepSeek API 无害
      const hasReasoning =
        (msg as any).reasoning_content !== undefined ||
        (msg as any).reasoning !== undefined ||
        (msg as any).reasoning_text !== undefined;

      if (!hasReasoning) {
        (msg as any).reasoning_content = " ";
        needsPatch = true;
      }
    }

    if (needsPatch) {
      return { messages: msgs };
    }
  });
}
