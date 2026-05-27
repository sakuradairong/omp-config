---
name: deepseek-tool-calling
description: |
  DeepSeek 模型工具调用最佳实践引导。
  帮助 DeepSeek V4 系列模型正确格式化工具调用参数，
  减少因 JSON 格式错误导致的调用失败。
alwaysApply: true
hide: true
tags: [deepseek, tool-calling, compatibility]
---

# DeepSeek Tool Calling Guide

## 为什么需要这个 skill

DeepSeek 系列模型（尤其是 Flash 版本）在工具调用时有一些已知的模式差异。与其他模型（如 Claude、GPT）不同，DeepSeek 更容易出现特定的参数格式问题。这个 skill 帮助你在调用工具时避免这些常见错误。

## 工具调用格式规则

### 1. 数组字段（Arrays）

DeepSeek 容易把数组字段写成单个字符串或空对象。正确的格式：

✅ **正确格式 —— JSON 数组**
```json
{
  "paths": ["src/main.ts", "src/utils.ts"]
}
```

❌ **错误格式 —— 单个字符串**
```json
{
  "paths": "src/main.ts"
}
```

❌ **错误格式 —— JSON 字符串**
```json
{
  "paths": "[\"src/main.ts\", \"src/utils.ts\"]"
}
```

❌ **错误格式 —— 空对象**
```json
{
  "paths": {}
}
```

**常见数组字段：**
- `paths` — 文件路径列表（find, search, ast_grep, ast_edit）
- `ops` — AST 编辑操作列表（ast_edit）
- `tasks` — 子任务列表（task）
- `items` — 项目列表
- `args` — 参数列表
- `questions` — 问题列表（ask）
- `cells` — eval 单元的代码列表

### 2. 可选字段（Optional Fields）

DeepSeek 容易把未使用的可选字段传为 `null`。这可能触发 schema 校验错误。

✅ **正确格式 —— 省略不需要的字段**
```json
{
  "path": "src/main.ts"
}
```

❌ **错误格式 —— 传 null**
```json
{
  "path": "src/main.ts",
  "_i": null,
  "query": null,
  "reason": null
}
```

**常见可选字段：**
- `_i` — 工具调用意图描述（大部分工具都有）
- `query` — 搜索查询（lsp, search）
- `reason` — 原因描述（resolve）
- `cwd` — 工作目录（bash）
- `env` — 环境变量（bash）
- `description` — 描述
- `timeout` — 超时秒数（bash, task）
- `symbol` — LSP 符号名
- `schema` — 子任务输出 schema

### 3. 数值字段（Number Fields）

DeepSeek 偶尔把数字写成字符串。

✅ **正确格式 —— 纯数字**
```json
{
  "limit": 10,
  "timeout": 30
}
```

❌ **错误格式 —— 字符串数字**
```json
{
  "limit": "10",
  "timeout": "30"
}
```

❌ **错误格式 —— 带单位字符串**
```json
{
  "timeout": "30seconds"
}
```

### 4. 顶层参数（Top-level Arguments）

DeepSeek 偶尔把整个参数对象包装成 JSON 字符串。

✅ **正确格式 —— 直接传对象**
```json
{
  "path": "src/main.ts",
  "pattern": "TODO"
}
```

❌ **错误格式 —— 字符串包裹**
```json
"{\"path\": \"src/main.ts\", \"pattern\": \"TODO\"}"
```

### 5. Enum 字段

传递枚举值时使用小写，大小写会被自动匹配。

✅ **正确格式**
```json
{
  "action": "apply"
}
```

✅ **会被自动修复**
```json
{
  "action": "APPly"
}
```

### 6. JSON 截断

DeepSeek 在流式生成时可能产生截断的 JSON。如果看到类似以下错误，说明工具调用在流输出中被截断了：

```
Unexpected end of JSON input
```

如果是这种情况，需要等待完整输出再发送工具调用请求，或者使用更短的参数值。

## 各工具参数速查

| 工具 | 必需字段 | 数组字段 | 数字字段 | 可选字段 |
|---|---|---|---|---|
| `read` | path | - | - | _i |
| `write` | path, content | - | - | _i |
| `edit` | input | - | - | _i |
| `search` | pattern, paths | paths | skip | _i, i, gitignore |
| `find` | paths | paths | limit | _i, hidden |
| `bash` | command | - | timeout | _i, env, cwd, pty |
| `ast_grep` | pat, paths | paths | skip | _i |
| `ast_edit` | ops, paths | ops, paths | - | _i |
| `lsp` | action | - | line | file, symbol, query, timeout |
| `eval` | cells | cells | timeout | - |
| `task` | agent, tasks | tasks | - | context, schema |
| `ask` | questions | questions | - | - |
| `resolve` | action, reason | - | - | - |
| `browser` | action | - | timeout | name, url, viewport, code, etc. |
| `todo_write` | ops | ops | - | - |

## 工具参数格式注意事项

### read 工具
- `path` 必须是字符串，**不要**传数组
- 如果查看文件需要指定行号范围，使用 `path: "file.ts:10-30"` 格式
- 不要将 search 的参数（`paths`, `pattern`）传给 read

### edit 工具
- `input` 必须是字符串（DSL 格式），**不要**传对象
- 锚点格式：`行号+2位hash`（如 `42ab`），不要只写行号
- 必须先 read 获取精确锚点，再构造 edit 调用

### write 工具
- `content` 必须是字符串，**不要**传对象
- 如果是 JSON 内容，直接用多行字符串传递

### browser 工具
- `code` 必须是字符串，**不要**传对象
- `viewport` 必须是对象 `{width, height}`，不要传字符串

### lsp 工具
- `line` 必须是数字，不要传字符串
- `symbol` 可选，不要传 null

## 思考模式 + 工具调用

### reasoning_content 回传规则

DeepSeek 思考模式下，当模型进行了工具调用时，`reasoning_content` **必须**在后续所有轮次中完整回传给 API。否则 API 返回 400 错误。

OMP 已通过 hooks 自动处理此规则（`opencode-deepseek-cot.ts`），但手动构造消息时需注意：

✅ **正确 — 保留 reasoning_content**
```json
{
  "role": "assistant",
  "content": null,
  "reasoning_content": "我需要调用工具来...",
  "tool_calls": [...]
}
```

❌ **错误 — 丢失 reasoning_content**
```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [...]
}
```

### 无工具调用的轮次

如果 assistant 没有进行工具调用，其 `reasoning_content` 不需要回传，API 会自动忽略。

### tool_choice 限制

DeepSeek V4 在启用思考模式时**不支持** `tool_choice` 参数。如果强制指定 `tool_choice`（如 `{type:"function", function:{name:"..."}}`），API 返回 400 错误。OMP 已通过 `supportsToolChoice: false` 配置自动处理。

## 工具返回结果格式

DeepSeek 处理工具返回结果时（OpenAI 格式），`content` 字段必须是**非空字符串**。

✅ **tool result 正确格式**
```json
{
  "role": "tool",
  "tool_call_id": "call_xxx",
  "content": "文件内容或工具输出..."
}
```

❌ **避免空 content**
```json
{
  "role": "tool",
  "tool_call_id": "call_xxx",
  "content": ""
}
```

OMP 已通过 hook（`opencode-deepseek-tool-result.ts`）自动保证：
- content 从不为空
- 工具返回的 ANSI 转义码已清理
- 大量输出前有摘要统计行

## 优化栈概述

OMP 对 DeepSeek V4 的优化分 5 层：

1. **models.yml** — 模型元数据覆盖（reasoning/compat/thinking 等 10+ 字段）
2. **COT 钩子** — `reasoning_content` 自动补全
3. **工具修复钩子** — 工具调用参数自动清洗（JSON 解析、类型转换、字段修正）
4. **工具调用 skill** — 系统提示注入最佳实践（本文档）
5. **结果优化钩子** — 工具返回结果格式归一化（非空、ANSI 清理、摘要统计）

## 模型版本

- **deepseek-v4-pro**: 1M 上下文，384K 最大输出，默认思考模式
- **deepseek-v4-flash**: 1M 上下文，384K 最大输出，支持思考/非思考模式
- `deepseek-chat` / `deepseek-reasoner` 将于 2026/07/24 弃用

## API 格式选择

- **OpenAI 格式** (`openai-completions`): 完整功能支持，推荐使用
- **Anthropic 格式** (`anthropic-messages`): 通过 `https://api.deepseek.com/anthropic`，不支持 image/document
