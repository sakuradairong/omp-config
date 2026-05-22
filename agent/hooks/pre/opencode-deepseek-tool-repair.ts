// DeepSeek 工具调用修复钩子（增强版 v2）
//
// DeepSeek 系列模型在工具调用时有几个已知的失败模式：
//
// 1. 双重重编码: 模型将整个 arguments 编码为 JSON 字符串
// 2. arguments 整体是字符串: 模型把整个参数对象写成字符串
// 3. 数组字段传空对象: 模型在期待数组的字段传 {}
// 4. 数组字段传裸字符串: 模型在期待数组的字段传单个字符串
// 5. 可选字段传 null: DeepSeek 特别容易在可选字段传 null
// 6. JSON 截断: 流式场景下工具调用 JSON 可能被截断
//
// v2 新增修复:
// 7. read 工具参数混淆: 模型将 search 参数 (paths+pattern) 传给了 read
// 8. edit input 字段为对象而非字符串
// 9. read path 缺失时从 paths 恢复
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
      return tryHealJson(trimmed) ?? raw;
    }
  }

  if (NULLISH_VALUES.has(trimmed)) return null;
  return raw;
}

/**
 * 尝试修复截断/不完整的 JSON
 */
function tryHealJson(raw: string): unknown | undefined {
  for (let i = raw.length - 1; i > Math.max(raw.length - 10, 0); i--) {
    const candidate = raw.slice(0, i);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }
  if (raw.startsWith("{") && !raw.endsWith("}")) {
    try { return JSON.parse(raw + "}"); } catch {}
  }
  if (raw.startsWith("[") && !raw.endsWith("]")) {
    try { return JSON.parse(raw + "]"); } catch {}
  }
  return undefined;
}

/**
 * 修复 edit 工具的 input 字段
 * DeepSeek 有时将 input 作为对象发送而非字符串
 */
function fixEditInput(input: unknown): unknown {
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    // 如果 input 是 { path, content } 形式，尝试重建为 edit DSL
    if (obj.path && obj.content) {
      return `@@ ${obj.path}\n+ EOF\n${obj.content}`;
    }
    // 如果是其他对象，转为空操作（不会损坏文件）
    return "@@ \n";
  }
  return input;
}

/**
 * 修复 read 工具的路径参数
 * DeepSeek 可能将 search 的参数 (paths+pattern) 传给 read，
 * 或者遗漏 path 字段
 */
function fixReadArgs(args: Record<string, unknown>): boolean {
  let changed = false;

  // 情况 1: read 有 pattern 但无 path — 是 search 的参数混淆
  if (args.pattern !== undefined && args.path === undefined) {
    // 如果有 paths 数组，用 paths[0] 作为 path
    if (Array.isArray(args.paths) && args.paths.length > 0 && typeof args.paths[0] === "string") {
      args.path = args.paths[0];
      changed = true;
    }
    // 删除 read 不接受的字段
    delete args.pattern;
    delete (args as any).i;
    delete (args as any).gitignore;
    changed = true;
  }

  // 情况 2: read 的 path 是 undefined/null 但有 _i
  if (args.path === undefined || args.path === null) {
    // 检查是否有 paths 可用
    if (Array.isArray(args.paths) && args.paths.length > 0 && typeof args.paths[0] === "string") {
      args.path = args.paths[0];
      changed = true;
    }
  }

  return changed;
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

  if (toolName === "find" || toolName === "search" || toolName === "ast_grep" || toolName === "ast_edit") {
    knownArrayFields.add("pattern");
  }

  for (const [key, value] of Object.entries(args)) {
    let repaired = value;

    // 修复 1: 可选字段传 null → 删除
    if (value === null && OFTEN_NULLED_OPTIONALS.has(key)) {
      changed = true;
      continue;
    }

    // 修复 2: NULLISH 字符串 → null → 可选字段删除
    if (typeof value === "string" && NULLISH_VALUES.has(value.trim())) {
      if (OFTEN_NULLED_OPTIONALS.has(key)) {
        changed = true;
        continue;
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

  // 工具特定修复
  if (toolName === "read") {
    if (fixReadArgs(result)) changed = true;
  }
  if (toolName === "edit") {
    if (result.input !== undefined) {
      const fixed = fixEditInput(result.input);
      if (fixed !== result.input) {
        result.input = fixed;
        changed = true;
      }
    }
  }

  return { repaired: result, changed };
}

/**
 * 修复顶层 arguments 字符串
 */
function repairTopLevelArgs(rawArgs: unknown): Record<string, unknown> {
  if (typeof rawArgs === "string") {
    const trimmed = rawArgs.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) &&
        (trimmed.endsWith("}") || trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
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
  pi.on("context", async (event) => {
    const msgs = event.messages;
    if (!msgs || !Array.isArray(msgs)) return;

    let needsPatch = false;

    for (const msg of msgs) {
      if (msg.role === "assistant") {
        const toolCalls = (msg as any).tool_calls ?? (msg as any).toolCalls;
        if (!toolCalls || !Array.isArray(toolCalls)) continue;

        for (const tc of toolCalls) {
          if (!tc || typeof tc !== "object") continue;
          const rawArgs = (tc as any).arguments ?? (tc as any).args;
          if (rawArgs === undefined || rawArgs === null) continue;

          const args = repairTopLevelArgs(rawArgs);
          const result = repairArgs(args, tc.name ?? "");

          if (result.changed) {
            (tc as any).arguments = result.repaired;
            if ((tc as any).function) {
              (tc as any).function.arguments = JSON.stringify(result.repaired);
            }
            needsPatch = true;
          }
        }
      }
    }

    if (needsPatch) {
      return { messages: msgs };
    }
  });
}
