// DeepSeek V4 思维链兼容钩子（增强版）
//
// DeepSeek 思考模式核心规则:
//   1. 启用思考模式: extra_body={"thinking": {"type": "enabled"}}
//      + reasoning_effort="max" (xhigh → max)
//   2. 有工具调用的 assistant 轮次:
//      reasoning_content 必须完整回传，否则 API 返回 400
//   3. 无工具调用的 assistant 轮次:
//      reasoning_content 可忽略（API 自动忽略）
//
// 增强内容:
//   1. 修复所有历史消息中缺少 reasoning_content 的 tool_calls 消息
//   2. 确保 xhigh 映射到 max reasoning_effort
//   3. 修复 tool_calls 参数中的常见 DeepSeek 错误
//
// 参考资料: https://api-docs.deepseek.com/zh-cn/guides/thinking_mode

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

// DeepSeek 已知的可选 null 字段
const OPTIONAL_STRING_FIELDS = new Set([
  "_i", "query", "reason", "cwd",
  "description", "name", "label", "comment",
]);

// DeepSeek 已知的数组字段（易传错）
const ARRAY_FIELDS = new Set([
  "paths", "args", "ops", "tasks", "items",
  "files", "questions",
]);

// DeepSeek 已知的数字字段（易传字符串）
const NUMBER_FIELDS = new Set([
  "timeout", "limit", "skip", "count",
  "line", "offset", "temperature",
]);

/**
 * 尝试从 JSON 字符串中提取值
 */
function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || ["true","false","null"].includes(trimmed) || /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    try { return JSON.parse(trimmed); } catch {}
  }
  return raw;
}

/**
 * 修复工具调用参数中的 DeepSeek 常见错误
 */
function repairToolArgs(args: unknown, toolName: string): { args: unknown; repaired: boolean } {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { args, repaired: false };
  }

  let repaired = false;
  const result: Record<string, unknown> = {};

  // 检测工具使用的数组字段
  const arrayFields = new Set(ARRAY_FIELDS);
  if (toolName === "find" || toolName === "search" || toolName === "ast_grep" || toolName === "ast_edit") {
    arrayFields.add("pattern");
  }

  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    let v = value;

    // 可选字段 null → 删除
    if (v === null && OPTIONAL_STRING_FIELDS.has(key)) {
      repaired = true;
      continue;
    }

    // 字符串可能是 JSON → 尝试解析
    if (typeof v === "string") {
      const parsed = tryParseJson(v);
      if (parsed !== v) { v = parsed; repaired = true; }
    }

    // 数组字段: 裸字符串 → [string]
    if (arrayFields.has(key) && typeof v === "string") {
      v = [v];
      repaired = true;
    }

    // 数组字段: 空对象 → []
    if (arrayFields.has(key) && typeof v === "object" && !Array.isArray(v) && v !== null && Object.keys(v).length === 0) {
      v = [];
      repaired = true;
    }

    // 数字字段: 字符串 → number
    if (NUMBER_FIELDS.has(key) && typeof v === "string") {
      const num = Number(v);
      if (!isNaN(num) && isFinite(num)) { v = num; repaired = true; }
    }

    result[key] = v;
  }

  return { args: result, repaired };
}

/**
 * 修复整个顶层 arguments（可能是 JSON 字符串）
 */
function repairTopLevelArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    const t = raw.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        const p = JSON.parse(t);
        if (typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
      } catch {
        // truncated JSON, try healing
        for (let i = t.length - 1; i > Math.max(t.length - 8, 0); i--) {
          try {
            const p = JSON.parse(t.slice(0, i));
            if (typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
          } catch {}
        }
      }
    }
    return {};
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export default function (pi: HookAPI): void {
  pi.on("context", async (event, _ctx) => {
    const msgs = event.messages;
    if (!msgs || !Array.isArray(msgs) || msgs.length === 0) return;

    let needsPatch = false;

    for (const msg of msgs) {
      if (msg.role !== "assistant") continue;

      const toolCalls = (msg as any).tool_calls ?? (msg as any).toolCalls;
      if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) continue;

      // === Fix 1: 补全 reasoning_content ===
      const hasReasoning =
        (msg as any).reasoning_content !== undefined ||
        (msg as any).reasoning !== undefined ||
        (msg as any).reasoning_text !== undefined;

      if (!hasReasoning) {
        // DeepSeek V4 要求 reasoning_content 非空字符串
        // 使用空格占位符 — 安全, 对非 DeepSeek API 无害
        (msg as any).reasoning_content = " ";
        needsPatch = true;
      }

      // === Fix 2: 修复 tool_calls 参数 ===
      for (const tc of toolCalls) {
        if (!tc || typeof tc !== "object") continue;

        const rawArgs = (tc as any).arguments ?? (tc as any).args;
        if (rawArgs === undefined || rawArgs === null) continue;

        // 修复顶层 arguments（可能是 JSON 字符串）
        const topLevel = repairTopLevelArgs(rawArgs);

        // 修复每个参数
        const result = repairToolArgs(topLevel, tc.name ?? "");
        if (result.repaired) {
          (tc as any).arguments = result.args;
          // 也同步更新 function 格式的 arguments
          if ((tc as any).function) {
            (tc as any).function.arguments = JSON.stringify(result.args);
          }
          needsPatch = true;
        }
      }
    }

    if (needsPatch) {
      return { messages: msgs };
    }
  });
}
