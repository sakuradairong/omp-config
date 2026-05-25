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

## 7. Edit 工具锚点（Hash Anchor）注意事项

`edit` 工具的锚点格式为 `行号+2字节hash`（如 `41th` 表示第 41 行、内容指纹为 `th`）。

### ⚠️ 问题：LLM 无法可靠复现 hash

hash 是随机 2 字节内容指纹，**没有任何语义含义**。所有 LLM（不仅是 DeepSeek）在生成 edit 指令时都倾向于：
- 编造一个看起来合理的 hash（如 `41ab`、`41xx`）
- 复用其他行的 hash
- 只写行号、丢弃 hash

结果：`unknown anchor` 错误，编辑失败。

### ✅ 方案：用 edit_helper 自动解析 anchors

不要手写 `≔41th..45ab`。改用 Python helper 模块，它通过 `read` 工具实时读取文件、自动解析正确 hash。

#### 加载方式

```python
exec(tool.read({"path": "skill://deepseek-tool-calling/edit_helper.py"})["text"])
```

> ⚠️ 编辑文件时用**文件系统路径**（如 `/root/project/src/main.py`），不要用 `skill://` URI。
> `skill://` URI 返回的是纯文本（无锚点），文件系统路径 + 范围选择器才有锚点信息。

#### 函数速查

| 函数 | 作用 | 示例 |
|---|---|---|
| `edit_replace(path, start, end, content)` | 替换范围 | `edit_replace("/app.py", 5, 8, "def new():\\n    pass")` |
| `edit_delete(path, start, end)` | 删除范围 | `edit_delete("/app.py", 10, 15)` |
| `edit_insert_after(path, line, content)` | 行后插入 | `edit_insert_after("/app.py", 20, "logger.info('done')")` |
| `edit_insert_before(path, line, content)` | 行前插入 | `edit_insert_before("/app.py", 1, "import os")` |
| `edit_append(path, content)` | 末尾追加 | `edit_append("/app.py", "\\n# EOF")` |
| `invalidate_cache(path)` | 编辑后清缓存 | 每次 `edit` 后必须调用 |

#### 工作流

1. **思考**：确定要改什么文件、哪几行
2. **读文件**（可选，用于确认行号）：`read file.py:40-60`
3. **用 helper 生成 edit input**：
   ```python
   inp = edit_replace("file.py", 42, 45, "replacement_code")
   ```
4. **调用 edit 工具**：将 `inp` 传入 `edit(input=inp)`
5. **清缓存**：`invalidate_cache("file.py")` — 否则下次读的是旧锚点

#### 最佳实践

- **优先用 `ast_edit`**（AST 结构匹配，完全无需行号/锚点），只在 AST 无法表达的场景（如注释、字符串内容、空格调整）用 `edit` + helper
- **每次 `edit` 后必须 `invalidate_cache`**，否则后续 `edit_*` 调用会使用已过时的锚点
- **文件内容被外部修改后**也要清缓存
- **遇到 `unknown anchor` 错误** → 文件已被修改，先 `invalidate_cache` 再重试
