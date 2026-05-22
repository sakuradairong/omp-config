// DeepSeek 工具调用修复钩子
//
// DeepSeek 系列模型在工具调用时有几个已知的失败模式：
//
// 1. 双重重编码: 模型将整个 arguments 编码为 JSON 字符串
//    { "paths": "[\"src/main.ts\", \"src/utils.ts\"]" }
//    → 修复: 检测到 JSON 字符串时先尝试 JSON.parse
//
// 2. arguments 整体是字符串: 模型把整个参数对象写成字符串
//    { "command": "ls -la" } → 整个工具调用的 arguments 变成 "{\"command\": \"ls -la\"}"
//    → 修复: 顶层 arguments 如果是字符串则尝试 parse
//
// 3. 数组字段传空对象: 模型在期待数组的字段传 {}
//    { "paths": {} } → 修复: 转为 []
//
// 4. 数组字段传裸字符串: 模型在期待数组的字段传单个字符串
//    { "paths": "src/main.ts" } → 修复: 转为 ["src/main.ts"]
//
// 5. 可选字段传 null: DeepSeek 特别容易在可选字段传 null
//    { "path": "foo.ts", "_i": null } → 修复: 删除 null 可选字段
//
// 6. JSON 截断: 流式场景下工具调用 JSON 可能被截断
//    例如 {"paths": ["src/"} → 修复: 通过 healing logic 补全
//
// 这些修复发生在 core validation pipeline 之前，确保进入 AJV 校验时
// 参数已经经过初步清洗，提高校验通过率。

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

// 常见会被 DeepSeek 传 null 的可选字段
const OFTEN_NULLED_OPTIONALS = new Set([
  "_i", "_", "description", "label", "name", "title",
  "comment", "note", "hint", "placeholder",
  "cwd", "env", "query", "reason",
]);

// 常见数组字段（DeepSeek 容易传错）
const OFTEN_ARRAY_FIELDS = new Set([
  "paths", "args", "items", "files", "targets",
  "ops", "tasks", "questions",
]);

// 常见数字字段（DeepSeek 可能传字符串）
const OFTEN_NUMBER_FIELDS = new Set([
  "timeout", "limit", "skip", "count", "max", "min",
  "port", "delay", "line", "offset", "temperature",
]);

// 空 JSON 值集合
const NULLISH_VALUES = new Set(["null", "Null", "NULL", "nil", "None", "none", "undefined"]);

/**
 * 尝试从字符串中提取 JSON 值
 * 处理 DeepSeek 双重重编码问题
 */
function tryExtractFromString(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  // 检查是否是 JSON 字符串
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // 尝试修复截断 JSON
      return tryHealJson(trimmed) ?? raw;
    }
  }

  // 检查是否是 NULLISH 值（作为字符串时）
  if (NULLISH_VALUES.has(trimmed)) return null;

  return raw;
}

/**
 * 尝试修复截断/不完整的 JSON
 * 处理 DeepSeek 流式截断问题
 */
function tryHealJson(raw: string): unknown | undefined {
  // 尝试逐字符删除尾端字符
  for (let i = raw.length - 1; i > Math.max(raw.length - 10, 0); i--) {
    const candidate = raw.slice(0, i);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue trying shorter strings
    }
  }

  // 尝试补全结尾括号
  if (raw.startsWith("{") && !raw.includes("}")) {
    try { return JSON.parse(raw + "}"); } catch {}
  }
  if (raw.startsWith("[") && !raw.includes("]")) {
    try { return JSON.parse(raw + "]"); } catch {}
  }

  return undefined;
}

/**
 * 递归修复参数对象中的常见 DeepSeek 错误模式
 */
function repairArgs(args: Record<string, unknown>, toolName: string): {
  repaired: Record<string, unknown>;
  changed: boolean;
} {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { repaired: args as Record<string, unknown>, changed: false };
  }

  let changed = false;
  const result: Record<string, unknown> = {};
  const knownArrayFields = new Set(OFTEN_ARRAY_FIELDS);

  // 优先检测工具名称是否暗示某些字段
  if (toolName === "find" || toolName === "search" || toolName === "ast_grep" || toolName === "ast_edit") {
    knownArrayFields.add("pattern");
  }

  for (const [key, value] of Object.entries(args)) {
    let repaired = value;

    // 修复 1: 可选字段传 null → 删除
    if (value === null && OFTEN_NULLED_OPTIONALS.has(key)) {
      changed = true;
      continue; // skip this key entirely
    }

    // 修复 2: NULLISH 字符串 → null → 可选字段删除
    if (typeof value === "string" && NULLISH_VALUES.has(value.trim())) {
      if (OFTEN_NULLED_OPTIONALS.has(key)) {
        changed = true;
        continue; // skip
      }
      repaired = null;
      changed = true;
    }

    // 修复 3: 顶层字段值是 JSON 字符串 → 自动 parse
    if (typeof repaired === "string") {
      const extracted = tryExtractFromString(repaired);
      if (extracted !== repaired) {
        repaired = extracted;
        changed = true;
      }
    }

    // 修复 4: 数组字段传裸字符串 → 包装为 [string]
    if (knownArrayFields.has(key) && typeof repaired === "string") {
      repaired = [repaired];
      changed = true;
    }

    // 修复 5: 数组字段传空对象 → []
    if (knownArrayFields.has(key) && typeof repaired === "object" && !Array.isArray(repaired) && repaired !== null) {
      if (Object.keys(repaired).length === 0) {
        repaired = [];
        changed = true;
      }
    }

    // 修复 6: 数字字段传字符串 → 尝试转为数字
    if (OFTEN_NUMBER_FIELDS.has(key) && typeof repaired === "string") {
      const num = Number(repaired);
      if (!isNaN(num) && isFinite(num)) {
        repaired = num;
        changed = true;
      } else {
        // 尝试提取前缀数字 ("42abc" → 42, "3.14px" → 3.14)
        const match = repaired.match(/^[+-]?(?:\d+\.?\d*|\.\d+)/);
        if (match) {
          const extracted = Number(match[0]);
          if (isFinite(extracted)) {
            repaired = extracted;
            changed = true;
          }
        }
      }
    }

    // 修复 7: 数字字段传 null → 使用 0 兜底
    if (OFTEN_NUMBER_FIELDS.has(key) && repaired === null) {
      repaired = 0;
      changed = true;
    }

    result[key] = repaired;
  }

  return { repaired: result, changed };
}

/**
 * 修复顶层 arguments 字符串（DeepSeek 可能把整个参数编码为 JSON 字符串）
 */
function repairTopLevelArgs(rawArgs: unknown): Record<string, unknown> {
  // 如果整个 arguments 是字符串，尝试 parse
  if (typeof rawArgs === "string") {
    const trimmed = rawArgs.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.endsWith("}") || trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // 尝试修复后 parse
        const healed = tryHealJson(trimmed);
        if (healed && typeof healed === "object" && !Array.isArray(healed)) {
          return healed as Record<string, unknown>;
        }
      }
    }
    return {};
  }

  if (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
    return {};
  }

  return rawArgs as Record<string, unknown>;
}

export default function (pi: HookAPI): void {
  // 在 tool_call 事件中修复参数
  // 注意: hook 无法修改 tool input，只能 block
  // 所以我们通过 context 事件在消息发送前修复历史中的工具调用参数
  //
  // 但实际上最有效的方式是在 validation.ts 层面修复。
  // 这里作为补充：记录 DeepSeek 特定修复的统计信息

  pi.on("context", async (event) => {
    const msgs = event.messages;
    if (!msgs || !Array.isArray(msgs)) return;

    let needsPatch = false;

    for (const msg of msgs) {
      // 处理 assistant 消息中的 tool_calls
      if (msg.role === "assistant") {
        const toolCalls = (msg as any).tool_calls ?? (msg as any).toolCalls;
        if (!toolCalls || !Array.isArray(toolCalls)) continue;

        for (const tc of toolCalls) {
          if (!tc || typeof tc !== "object") continue;
          const rawArgs = (tc as any).arguments ?? (tc as any).args;
          if (rawArgs === undefined || rawArgs === null) continue;

          // 修复顶层 arguments
          const args = repairTopLevelArgs(rawArgs);

          // 修复每个参数
          const result = repairArgs(args, tc.name ?? "");
          if (result.changed) {
            (tc as any).arguments = result.repaired;
            needsPatch = true;
          }
        }
      }

      // 处理 tool_result 消息（检查是否含有可修复的错误信息）
      if (msg.role === "tool" || (msg as any).role === "tool_result") {
        const content = msg.content;
        if (!content || !Array.isArray(content)) continue;

        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            // 如果工具调用因校验失败而报错，标记以便后续重试可以自动修复
            if (block.text.includes("Validation failed for tool")) {
              // 这里可以做额外的错误分析
              // 但修复逻辑已经在 validation.ts 中
            }
          }
        }
      }
    }

    if (needsPatch) {
      return { messages: msgs };
    }
  });
}
