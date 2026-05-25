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

### 设计理念：不替模型查，只帮模型纠错

edit_helper **不自动解析锚点**。你必须先 read 文件看到锚点，然后声称锚点，模块校验是否匹配。

保留了 hash 设计的两层意图：
1. **乐观锁** — hash 不匹配的操作被拒绝
2. **强制读文件** — 只有 read 能拿到当前 hash

### 加载方式

```python
exec(tool.read({"path": "skill://deepseek-tool-calling/edit_helper.py"})["text"])
```

### 核心原则

1. **先 read，再声称，再校验**
2. **hash 不对不执行** — 模块报错并告知正确 hash
3. **每次 edit 后必须 `invalidate_cache`**

### 函数速查

| 函数 | 作用 | 需声称 hash | 示例 |
|---|---|---|---|
| `check_and_replace(path, hash, s, e, content)` | 替换范围 | ✅ | `check_and_replace("/app.py", "ab", 42, 45, "code")` |
| `check_and_delete(path, hash, s, e)` | 删除范围 | ✅ | `check_and_delete("/app.py", "ab", 42, 45)` |
| `check_and_insert_after(path, hash, line, content)` | 行后插入 | ✅ | `check_and_insert_after("/app.py", "ab", 42, "# note")` |
| `check_and_insert_before(path, hash, line, content)` | 行前插入 | ✅ | `check_and_insert_before("/app.py", "ab", 42, "import os")` |
| `check_and_append(path, content)` | 末尾追加 | ❌ | `check_and_append("/app.py", "\\n# EOF")` |
| `check_anchor(path, hash, line)` | 纯校验 | ✅ | `check_anchor("/app.py", "ab", 42)` → `(True, "ab", content)` |
| `invalidate_cache(path)` | 清缓存 | — | 每次 edit 后调用 |

hash 错误时的反馈：
```
Hash mismatch for '/app.py' line 42: claimed 'xx', actual 'ab'.
Re-read the file to get the correct anchor.
```

### 工作流

```
1. read 文件 → 看到行号和 hash
   read /app.py:40-50
   → 42ab|    "debug": True

2. 声称 hash，生成 edit input
   inp = check_and_replace("/app.py", "ab", 42, 42, '    "debug": False')

3. 调用 edit
   edit(input=inp)

4. 清缓存
   invalidate_cache("/app.py")
```

### hash 错误时的修复流程

1. 收到错误：`claimed 'xx', actual 'ab'`
2. 如果只是抄错锚点：用正确 hash 重试
3. 如果文件已变更（re-read 发现 hash 不同）：说明文件被外部修改，先 `invalidate_cache` 再重试

### 最佳实践

- **优先用 `ast_edit`**（AST 结构匹配，完全无需行号/锚点）
- **每次 `edit` 后必须 `invalidate_cache`**，否则后续操作使用过期缓存
- **hash 校验失败后**：re-read 文件 → 用正确 hash 重试