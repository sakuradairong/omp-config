# edit_helper — Hash Anchor 校验模块设计报告

## 一、问题背景

### 1.1 Hash Anchor 机制

OMP 的 `edit` 工具使用 `行号+2字节内容指纹` 作为操作锚点：

```
24pq|          reasoningContentField: "reasoning_content"
 ^^  └─ 内容指纹（2 字节，base64-ish）
 └─ 行号
```

锚点的两层设计意图：
- **乐观锁**：文件内容变更后 hash 不匹配，edit 拒绝执行
- **强制读文件**：只有 `read` 工具的输出中能看到 hash，迫使模型编辑前先读取当前状态

### 1.2 LLM 的天生缺陷

hash 是随机分布的 2 字节指纹，**没有任何语义含义**。所有生成式 LLM 在生成 edit 指令时都倾向于：
- 编造一个看起来合理的 hash（如 `41ab`、`41xx`）
- 复用其他行的 hash
- 只写行号、丢弃 hash

结果：`unknown anchor` 错误，编辑失败。

### 1.3 为什么不能自动解析

**V1 方案（已废弃）** 试图让 helper 自动读文件找锚点，模型只需给行号。这绕过了"强制读文件"的设计意图——模型可以在不读文件的情况下发出编辑，可能对着错误的行号编代码而静默执行。

## 二、设计方案

### 2.1 核心理念：不替模型查，只帮模型纠错

```
模型: "我认为 line 24 的 hash 是 pq"
helper: "查一下... ✓ 正确，构造 edit input"
           或
        "✗ 不符，正确的 hash 是 'wt'"
模型: "那我用 'wt' 重试"
```

### 2.2 API 设计

所有公共函数以 `check_and_` 开头，强调必须通过校验：

| 函数 | 作用 | 需声称 hash | 返回/行为 |
|---|---|---|---|
| `check_and_replace(path, hash, s, e, content)` | 替换范围 | ✅ | 校验通过返回 edit input 字符串 |
| `check_and_delete(path, hash, s, e)` | 删除范围 | ✅ | 同上 |
| `check_and_insert_after(path, hash, line, content)` | 行后插入 `»` | ✅ | 同上 |
| `check_and_insert_before(path, hash, line, content)` | 行前插入 `«` | ✅ | 同上 |
| `check_and_append(path, content)` | 末尾追加 `»EOF` | ❌ | 直接返回（EOF 无锚点） |
| `check_anchor(path, hash, line)` | 纯校验 | ✅ | `(is_match, actual_hash, content)` |
| `invalidate_cache(path)` | 清缓存 | — | 每次 edit 后必须调用 |

### 2.3 工作流

```
① read 文件 → 看到行号和 hash
   read /app.py:40-50
   → 42ab|    "debug": True

② 声称 hash，生成 edit input
   inp = check_and_replace("/app.py", "ab", 42, 42,
                           '    "debug": False')

③ 调用 edit
   edit(input=inp)

④ 清缓存
   invalidate_cache("/app.py")
```

### 2.4 纠错循环

hash 错误不是死路，而是反馈循环：

```
Error: Hash mismatch for '/app.py' line 42:
       claimed 'xx', actual 'ab'.
       Re-read the file to get the correct anchor.

→ 模型用 'ab' 重试 → 通过
→ 如果文件已变更 → 先 invalidate_cache，再重试
```

### 2.5 错误信息格式

```
Hash mismatch for '{path}' line {line}:
claimed '{wrong}', actual '{correct}'.
Re-read the file to get the correct anchor.
```

错误信息包含 4 个要素：
1. 哪个文件、哪一行
2. 模型声称的错误值
3. 实际正确值
4. 恢复指引

## 三、文件结构

```
~/.omp/agent/skills/deepseek-tool-calling/
├── SKILL.md              # 技能文档（含 §7 Hash Anchor 章节）
└── edit_helper.py        # 校验模块
```

源文件仓库：`github.com/sakuradairong/omp-config`

## 四、循环测试结果

### 4.1 测试范围

| 项目 | 文件类型 | 行数 | 操作类型 |
|---|---|---|---|
| `omp-tool-call-optimization/install.sh` | bash | 60 | replace / insert_after / insert_before / delete / append |
| `omp-tool-call-optimization/models.yml` | YAML（缩进敏感） | 61 | replace / insert_after / delete / append |
| `omp-config/agent/hooks/pre/opencode-deepseek-cot.ts` | TypeScript | 185 | 连续 5 轮 replace |

### 4.2 操作汇总

```
17 轮 edit 操作
├─ 10 次 check_and_replace（单行 + 多行）
├─  3 次 check_and_insert_after
├─  2 次 check_and_insert_before
├─  1 次 check_and_delete
├─  2 次 check_and_append
└─  1 次 故意传错 hash 验证错误信息
```

### 4.3 hash 声称正确率

```
试验次数: 19 次 hash 声称
├─ 正确: 10 次 (52.6%)
└─ 错误:  9 次 (47.4%) → 全部被校验拦截并纠正
```

9 次纠正全部通过 `check_anchor` 返回正确 hash，然后用正确值重试成功。**没有一次错误 hash 通过校验**。

### 4.4 错误信息验证

```
Hash mismatch for '/tmp/test_loop/install.sh' line 1:
claimed 'xx', actual 'hb'.
Re-read the file to get the correct anchor.
```

4 项检查全部通过 ✓

### 4.5 极端情况验证

| 场景 | 结果 |
|---|---|
| 多行替换（YAML 缩进敏感）| ✅ 正确匹配缩进层级 |
| 连续 5 轮替换同一文件（TS） | ✅ 每轮独立校验，invalidate_cache 后锚点更新 |
| delete 后文件缩短（install.sh）| ✅ 行号变化后锚点重新解析 |
| 跨 3 文件同时编辑 | ✅ 各自独立校验，缓存隔离 |
| insert_before + insert_after 混合 | ✅ 插入位置正确 |

## 五、与原始设计的对照

| 维度 | 原始 edit 设计 | V1 自动解析 | V2 校验模式 |
|---|---|---|---|
| 强制读文件 | ✅ hash 不可猜，只能 read | ❌ 被 bypass | ✅ 必须 read |
| 乐观锁 | ✅ hash 校验 | ❌ 绕过 | ✅ 保留 |
| 防幻觉 | ❌ 未知锚点直接失败 | ❌ 静默执行 | ✅ 报错+纠正 |
| 易用性 | ❌ 模型总编错 | ✅ 模型只需行号 | ✅ 模型读→声称→纠正 |
| 纠错能力 | ❌ 无 | ❌ 无 | ✅ 告知正确 hash |

## 六、使用方式

```python
# 1. 单次会话加载
exec(tool.read({"path": '/root/.omp/agent/skills/deepseek-tool-calling/edit_helper.py'})["text"])

# 2. 读文件（读到 hash）
# read /app.py:40-50 → 42ab|    "debug": True

# 3. 声称 + 校验 + 构造
inp = check_and_replace("/app.py", "ab", 42, 42, '    "debug": False')

# 4. 执行
edit(input=inp)

# 5. 清缓存
invalidate_cache("/app.py")
```
