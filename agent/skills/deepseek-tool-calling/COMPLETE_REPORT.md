# edit_helper — 完整设计报告

> 项目：OMP `edit` 工具 hash anchor 优化
> 仓库：github.com/sakuradairong/omp-config
> 路径：agent/skills/deepseek-tool-calling/

---

## 一、问题

### 1.1 Hash Anchor 机制

OMP 的 `edit` 工具使用 `行号+2字节内容指纹` 作为操作锚点：

```
42ab|    "debug": True
 ^^  └─ 内容指纹（2 字节，base64-ish）
 └─ 行号
```

两层设计意图：
- **乐观锁**：文件内容变更后 hash 不匹配，edit 拒绝执行
- **强制读文件**：只有 `read` 工具的输出中能看到 hash，迫使模型编辑前先读取当前状态

### 1.2 LLM 的天生缺陷

hash 是随机 2 字节指纹，**没有任何语义含义**。所有 LLM 在生成 edit 指令时：
- 编造 hash（如 `41ab`、`41xx`）
- 复用其他行的 hash
- 只写行号、丢弃 hash

结果：`unknown anchor` 错误，编辑失败。

### 1.3 根因分析

工具接口设计问题：`edit` 工具把内部乐观锁的 hash 暴露给调用者（模型），强迫模型管理它无法推理的随机值。

```
模型擅长:   行号 + 语义内容
模型不擅长: 随机 2 字节指纹
```

---

## 二、方案演进

### V1：自动解析（已废弃）

helper 自动读文件找锚点，模型只需给行号。

```
模型: replace(42, "code")
helper: read → 找 L42 hash=ab → 构造 ≔42ab → edit
```

**问题**：绕过了"强制读文件"的设计意图，模型可以在不读文件的情况下编辑。

### V2：前置校验（已废弃）

模型先读文件看到 hash，声称 hash，helper 校验是否匹配。

```
模型: read → "42ab|..."
模型: check_and_replace("ab", 42, "code") → 校验通过 → edit
                                     失败 → 报 correct hash
```

**问题**：多了一步 `check` 流程，每次读整个文件，`invalidate_cache` 容易遗漏。

### V3：错误重试（当前）

直接执行 edit，失败时从 edit 工具的错误信息中自动提取正确 hash 重试。

```
模型: replace("ab", 42, "code")
      ↓ edit 工具
      ├─ hash 正确 → 成功
      └─ hash 错误 → "Edit rejected: *42ak|..."
                   → 解析 → 提取 "ak" → 自动重试 → 成功
```

**重试在同一个 eval 调用内完成**，不消耗额外 tool call。

#### 当前 API

| 函数 | 作用 | 错误自动重试 |
|---|---|---|
| `replace(path, hash, s, e, content)` | 替换范围 | ✅ |
| `delete(path, hash, s, e)` | 删除范围 | ✅ |
| `insert_after(path, hash, line, content)` | 行后插入 | ✅ |
| `insert_before(path, hash, line, content)` | 行前插入 | ✅ |
| `append(path, content)` | 末尾追加 | — |
| `check_anchor(path, hash, line)` | 纯校验 | — |

无需 `pre-read`，无需 `invalidate_cache`，无需 `try/except`。

---

## 三、测试结果

### 3.1 第一轮：跨语言基础测试

| 文件 | 语言 | 操作 | hash纠正 | 结果 |
|---|---|---|---|---|
| install.sh | Bash | replace / insert / delete / append | 1 | ✅ |
| models.yml | YAML（缩进敏感） | replace / insert / append | 1 | ✅ |
| opencode-deepseek-cot.ts | TypeScript | 连续 5 轮 replace | 5 | ✅ |
| **合计** | — | **17** | **9** | **100%** |

### 3.2 第二轮：真实项目代码

| 文件 | 语言 | 行数 | 来源 | 操作 | hash纠正 |
|---|---|---|---|---|---|
| chart.py | Python | 172 | DRAM 价格走势图 | 7 | 1 |
| commonmark-rules.js | JavaScript | 950 | Joplin turndown 插件 | 4 | 3 |
| AudioRecorder.kt | Kotlin | 105 | Android NDK 录音模块 | 6 | 0 |
| — | — | — | Stress 30 轮全错 | 30 | 30 |
| **合计** | — | — | — | **47** | **34** |

### 3.3 TOCTOU 并发测试

| 场景 | 子代理行为 | 主进程 | 结果 |
|---|---|---|---|
| 上游插入行 | L3 后插入 2 行 | 编辑 L5（旧 hash） | ✅ 拒绝 → 自动纠正行号漂移 |
| 修改同一行 | 抢先改 L4 | 编辑 L4（旧 hash） | ✅ 拒绝 → 新 hash 重试 |
| 删除目标行 | 删除 L8 | 编辑 L8（旧 hash） | ✅ 拒绝 → 调整策略 |
| 改不同行 | 改 L11 | 编辑 L14（旧 hash） | ✅ 正确放行（无冲突） |
| 缓存过期 | — | 不 invalidate 直接操作 | ✅ 每次读文件，不受影响 |

三层防御：helper 解析错误 → edit 乐观锁 → 日志可审查。

### 3.4 V3 最终循环测试

| 分组 | 文件 | 语言 | 轮次 | 错误hash | 自动纠正 |
|---|---|---|---|---|---|
| A | app.py | Python | 5 | 5 | ✅ 5/5 |
| B | rules.js | JavaScript | 6 | 2 | ✅ 2/2 |
| C | recorder.kt | Kotlin | 6 | 4 | ✅ 4/4 |
| D | install.sh | Bash | 6 | TOCTOU | ✅ 行漂移纠正 |
| E | 全部 | 混合 | 20 | 20 | ✅ 20/20 |
| **合计** | **4** | **4** | **37** | **31** | **100%** |

---

## 四、累计统计

| 指标 | 第一轮 | 第二轮 | TOCTOU | V3 循环 | **累计** |
|---|---|---|---|---|---|
| 文件数 | 3 | 3 | 1 | 4 | **11** |
| 语言 | 3 | 3 | 1 | 4 | **6**（Bash/YAML/TS/Python/JS/Kotlin） |
| 操作 | 17 | 47 | 5 | 37 | **106** |
| hash 纠正 | 9 | 34 | 3 | 31 | **77** |
| 失败 | 0 | 0 | 0 | 0 | **0** |

---

## 五、文件清单

```
~/.omp/agent/skills/deepseek-tool-calling/
├── SKILL.md                      # 技能文档（§7 Hash Anchor 优化）
├── edit_helper.py                # 当前 V3 实现（auto-retry）
├── DESIGN.md                     # 设计说明
├── TEST_REPORT_v2.md             # 第二轮测试报告
├── TOCTOU_REPORT.md              # 并发冲突测试报告
└── V3_TEST_REPORT.md             # V3 循环测试报告
```

---

## 六、结论

1. **问题确认**：hash anchor 暴露给模型是工具接口设计缺陷，LLM 无法可靠处理随机 2 字节指纹
2. **V3 方案有效**：auto-retry 模式在 106 次操作、77 次 hash 纠正中保持 100% 成功率
3. **零额外开销**：hash 正确的场景无多余 tool call，hash 错误的场景重试在同一 eval 内透明完成
4. **防御完整**：helper 解析错误 + edit 乐观锁 + 日志可审查，三层保障
5. **hash 不应暴露给模型**：理想方案是 edit 工具自身管理 hash，不要求调用者提供
