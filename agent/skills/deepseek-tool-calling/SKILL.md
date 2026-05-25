---
name: deepseek-tool-calling
description: |
  DeepSeek 模型工具调用最佳实践引导。
  帮助 DeepSeek V4 系列模型正确格式化工具调用参数，
  减少因 JSON 格式错误导致的调用失败。
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
| `eval` | input | - | - | - |
| `task` | agent, tasks | tasks | - | context, schema |
| `ask` | questions | questions | - | - |
| `resolve` | action, reason | - | - | - |
| `browser` | action | - | timeout | name, url, viewport, code, etc. |
| `todo_write` | ops | ops | - | - |

## 总结

DeepSeek 工具调用的核心原则：

1. **数组始终用 `[...]` 语法**，不要用字符串或对象
2. **省略可选字段**，不要传 `null`
3. **数字直接写数字**，不要加引号
4. **参数直接传对象**，不要包字符串
5. **枚举值用小写**（大写会自动匹配但更可靠的是小写）

遵循这些规则可以避免 90% 以上的工具调用校验错误。

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

## 模型版本

- **deepseek-v4-pro**: 1M 上下文，384K 最大输出，默认思考模式
- **deepseek-v4-flash**: 1M 上下文，384K 最大输出，支持思考/非思考模式
- `deepseek-chat` / `deepseek-reasoner` 将于 2026/07/24 弃用

## API 格式选择

- **OpenAI 格式** (`openai-completions`): 完整功能支持，推荐使用
- **Anthropic 格式** (`anthropic-messages`): 通过 `https://api.deepseek.com/anthropic`，不支持 image/document

---

## 7. Edit 工具锚点（Hash Anchor）

### 问题

`edit` 工具的锚点格式为 `行号+2字节hash`（如 `42ab`）。hash 是随机 2 字节内容指纹，LLM 无法可靠复现。

### 方案：强制 read → 自动提取 hash

```python
# 1. READ（必须）
lines = tool.read({"path": "/app.py:42-42"})
# → 42ab|    "debug": True

# 2. EDIT（hash 从 lines 自动提取）
r = edit_line(lines, "/app.py", 42, '    "debug": False')
```

**必须先 read 才能 edit。** hash 从 read 输出中机械提取，模型不接触随机字符。没有 read 输出就报错。伪造 read 输出则 edit 工具乐观锁拒绝。

### 加载

```python
exec(tool.read({"path": "skill://deepseek-tool-calling/edit_helper.py"})["text"])
```

### 函数

| 函数 | 作用 | 需先 read |
|---|---|---|
| `edit_line(read_output, path, line, content)` | 替换单行 | ✅ |
| `edit_range(read_output, path, s, e, content)` | 替换范围 | ✅ |
| `insert_after(read_output, path, line, content)` | 行后插入 | ✅ |
| `insert_before(read_output, path, line, content)` | 行前插入 | ✅ |
| `append(path, content)` | 末尾追加 | ❌ |
| `check_anchor(path, hash, line)` | 纯校验 | ❌ |

### 返回值

| status | 含义 | 附带字段 |
|---|---|---|
| `ok` | 编辑成功 | `details` |
| `rejected` | hash 不匹配或行号错误 | `correct_hash`, `actual_content`, `file_context`, `was_mismatch` |
| `error` | 非预期错误 | `message` |

```python
{"status": "rejected",
 "correct_hash": "xy",
 "actual_content": '    "name": "myapp",',  # ← 模型看到实际内容
 "file_context": "*4xy|...",
 "was_mismatch": True}
```