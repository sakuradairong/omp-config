// DeepSeek 工具调用修复钩子（增强版 v3）
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
// v3 新增修复:
// 10. path 字段为数组时提取首个元素（read/lsp 等）
// 11. write content 字段为对象时转为 JSON 字符串
// 12. browser code 字段为对象时转为 JSON 字符串
// 13. lsp query 字段为 null 时删除
// 14. eval cells 字段对象修复
// 15. 更全面的 NULLISH 值识别

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

// 常见会被 DeepSeek 传 null 的可选字段
const OFTEN_NULLED_OPTIONALS = new Set([
  "_i", "_", "description", "label", "name", "title",
  "comment", "note", "hint", "placeholder",
  "cwd", "env", "query", "reason", "schema",
  "context", "new_name", "symbol",
]);

// 常见数组字段（DeepSeek 容易传错）
const OFTEN_ARRAY_FIELDS = new Set([
  "paths", "args", "items", "files", "targets",
  "ops", "tasks", "questions", "cells",
]);

// 常见数字字段（DeepSeek 可能传字符串）
const OFTEN_NUMBER_FIELDS = new Set([
  "timeout", "limit", "skip", "count", "max", "min",
  "port", "delay", "line", "offset", "temperature",
  "maxTokens", "depth",
]);

// 空 JSON 值集合
const NULLISH_VALUES = new Set([
  "null", "Null", "NULL", "nil", "Nil", "NIL",
  "none", "None", "NONE",
  "undefined", "Undefined",
  "nan", "NaN", "NAN",
]);

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
  // Try progressively shorter suffixes
  for (let i = raw.length - 1; i > Math.max(raw.length - 12, 0); i--) {
    const candidate = raw.slice(0, i);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }
  // Try appending closing brackets
  if (raw.startsWith("{") && !raw.endsWith("}")) {
    try { return JSON.parse(raw + "}"); } catch {}
    try { return JSON.parse(raw + "\"}"); } catch {}
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
    if (obj.path && obj.content) {
      return `@@ ${obj.path}\n+ EOF\n${obj.content}`;
    }
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

  // 情况 1: read 有 pattern 但无 path — search 的参数混淆
  if (args.pattern !== undefined && args.path === undefined) {
    if (Array.isArray(args.paths) && args.paths.length > 0 && typeof args.paths[0] === "string") {
      args.path = args.paths[0];
      changed = true;
    }
    delete args.pattern;
    delete (args as any).i;
    delete (args as any).gitignore;
    changed = true;
  }

  // 情况 2: read 的 path 是 undefined/null
  if (args.path === undefined || args.path === null) {
    if (Array.isArray(args.paths) && args.paths.length > 0 && typeof args.paths[0] === "string") {
      args.path = args.paths[0];
      changed = true;
    }
  }

  // 情况 3: read 的 path 是数组
  if (Array.isArray(args.path)) {
    if (args.path.length > 0 && typeof args.path[0] === "string") {
      args.path = args.path[0];
      changed = true;
    }
  }

  return changed;
}

/**
 * 修复 write 工具的 content 字段
 * DeepSeek 有时将 content 作为对象发送
 */
function fixWriteArgs(args: Record<string, unknown>): boolean {
  let changed = false;

  // content 是对象 → 序列化为 JSON 字符串
  if (args.content !== undefined && typeof args.content === "object" && args.content !== null && !Array.isArray(args.content)) {
    try {
      args.content = JSON.stringify(args.content, null, 2);
      changed = true;
    } catch {}
  }

  // path 是数组 → 取首个
  if (Array.isArray(args.path)) {
    if (args.path.length > 0 && typeof args.path[0] === "string") {
      args.path = args.path[0];
      changed = true;
    }
  }

  return changed;
}

/**
 * 修复 browser 工具的参数
 * DeepSeek 有时将 code 作为对象发送
 */
function fixBrowserArgs(args: Record<string, unknown>): boolean {
  let changed = false;

  // code 是对象 → 序列化为 JSON 字符串
  if (args.code !== undefined && typeof args.code === "object" && args.code !== null) {
    try {
      args.code = JSON.stringify(args.code);
      changed = true;
    } catch {}
  }

  // viewport 是字符串 → 尝试解析为 JSON
  if (args.viewport !== undefined && typeof args.viewport === "string") {
    try {
      const parsed = JSON.parse(args.viewport);
      if (typeof parsed === "object" && parsed !== null) {
        args.viewport = parsed;
        changed = true;
      }
    } catch {}
  }

  return changed;
}

/**
 * 修复 lsp 工具的参数
 */
function fixLspArgs(args: Record<string, unknown>): boolean {
  let changed = false;

  // line 是字符串 → 转数字
  if (args.line !== undefined && typeof args.line === "string") {
    const num = Number(args.line);
    if (!isNaN(num) && isFinite(num) && Number.isInteger(num)) {
      args.line = num;
      changed = true;
    }
  }

  // symbol 是 null → 删除
  if (args.symbol === null) {
    delete args.symbol;
    changed = true;
  }

  return changed;
}

/**
 * 通用字段修复：path/input/content 等核心字段的格式归一化
 */
function fixCommonArgs(args: Record<string, unknown>): boolean {
  let changed = false;

  // path 是数组 → 取首个（多个工具共用）
  if (Array.isArray(args.path)) {
    if (args.path.length > 0 && typeof args.path[0] === "string") {
      args.path = args.path[0];
      changed = true;
    }
  }

  // paths 是单个字符串 → 包装为数组
  if (typeof args.paths === "string") {
    args.paths = [args.paths];
    changed = true;
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

  // 数组字段检测：根据工具动态扩展通用数组字段
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

    // 修复 2: NULLISH 字符串 → 统一为 null → 可选字段则删除
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
      if (Object.keys(repaired as Record<string, unknown>).length === 0) {
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

  // 通用字段修复
  if (fixCommonArgs(result)) changed = true;

  // 工具特定修复
  switch (toolName) {
    case "read":
      if (fixReadArgs(result)) changed = true;
      break;
    case "edit":
      if (result.input !== undefined) {
        const fixed = fixEditInput(result.input);
        if (fixed !== result.input) {
          result.input = fixed;
          changed = true;
        }
      }
      break;
    case "write":
      if (fixWriteArgs(result)) changed = true;
      break;
    case "browser":
      if (fixBrowserArgs(result)) changed = true;
      break;
    case "lsp":
      if (fixLspArgs(result)) changed = true;
      break;
  }

  return { repaired: result, changed };
}

/**
 * 修复顶层 arguments 字符串
 * DeepSeek 偶尔把整个参数对象编码为 JSON 字符串
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
