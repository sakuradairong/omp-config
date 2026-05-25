# edit_helper — 完整设计与验证报告

> 项目：OMP `edit` 工具 hash anchor 优化
> 仓库：github.com/sakuradairong/omp-config
> 路径：agent/skills/deepseek-tool-calling/
> 最终版本：V5（read-enforced）

---

## 一、问题分析

### 1.1 Hash Anchor 机制

OMP 的 `edit` 工具使用 `行号+2字节内容指纹` 作为操作锚点：

```
42ab|    "debug": True
```

两层设计意图：
- **乐观锁**：内容变更后 hash 不匹配，拒绝执行
- **强制读文件**：只有 `read` 能看到 hash

### 1.2 根因

hash 是随机 2 字节指纹，LLM 无法可靠复现。更关键的是：**hash 错误通常不是"模型抄错了 hash"，而是"模型根本没读文件"**。如果模型读了文件，hash 就在眼前，只是复制粘贴，不会错。

### 1.3 接口设计问题

`edit` 工具把内部乐观锁机制暴露给调用者（模型），强迫模型管理它无法推理的随机值。正确的设计是工具内部处理 hash，只暴露行号接口。

---

## 二、方案演进

| 版本 | 核心思路 | 问题 | 废弃原因 |
|---|---|---|---|
| V1 | 自动解析 hash，模型只管行号 | bypass 强制读文件 | 模型可跳过 read |
| V2 | 前置校验，模型声称 hash，校验后 edit | 多一步 check，效率低 | invalidate_cache 遗漏 |
| V3 | auto-retry，错误时自动修正 hash | 掩盖了"不读文件"的错误 | 修 hash 不修内容 |
| V4 | 结构化 reveal，返回正确 hash 和内容 | 模型可能编造 hash | 未强制 read |
| V5 | read_output 参数强制 read | ✅ | 当前版本 |

### V5 设计

```
模型: lines = tool.read({"path": "/app.py:42-42"})
      # ↑ 必须 read，否则没有 lines 变量

模型: r = edit_line(lines, "/app.py", 42, '    "debug": False")
      # ↑ hash 从 lines 中机械提取，模型不接触

如果 hash 过期（TOCTOU）:
  r = {"status": "rejected",
       "mismatches": [{"line": 42, "correct_hash": "ak", "actual_content": "..."}],
       "correct_hash": "ak",
       "actual_content": "...",
       "file_context": "*42ak|..."}
```

**三条防线**：
1. 无 read_output → `edit_line` 报 `ValueError`
2. hash 机械提取，模型不触随机字符
3. edit 工具乐观锁，不可绕过

---

## 三、API

### 必须 read 的函数

| 函数 | 作用 |
|---|---|
| `edit_line(read_output, path, line, content)` | 替换单行 |
| `edit_range(read_output, path, s, e, content)` | 替换范围 |
| `delete_line(read_output, path, line)` | 删除单行 |
| `delete_range(read_output, path, s, e)` | 删除范围 |
| `insert_after(read_output, path, line, content)` | 行后插入 |
| `insert_before(read_output, path, line, content)` | 行前插入 |

### 无需 read 的函数

| 函数 | 作用 |
|---|---|
| `append(path, content)` | 末尾追加 |
| `check_anchor(path, hash, line)` | 诊断: 返回 (匹配, 正确hash, 行内容) |

### 返回值结构

```python
# 成功
{"status": "ok", "details": {...}}

# 拒绝（hash 不匹配 / TOCTOU）
{"status": "rejected",
 "correct_hash": "ak",        # 目标行正确 hash
 "actual_content": "...",      # 目标行实际内容
 "mismatches": [               # 所有 hash 不匹配的行
   {"line": 42, "correct_hash": "ak", "actual_content": "..."}
 ],
 "was_mismatch": True,
 "file_context": "*42ak|...",
 "message": "Edit rejected: ..."}

# 错误
{"status": "error", "message": "..."}
```

---

## 四、测试汇总

### 4.1 功能测试

六轮测试，覆盖 6 种语言、106+ 次操作：

| 测试 | 操作数 | hash 纠正 | 失败 |
|---|---|---|---|
| 第一轮（bash/YAML/TS） | 17 | 9 | 0 |
| 第二轮（Python/JS/Kotlin） | 47 | 34 | 0 |
| TOCTOU 场景（5 种冲突） | 5 | 3 | 0 |
| V3 循环（4 语言 37 轮） | 37 | 31 | 0 |
| V5 验证（10 项） | 10 | 1 | 0 |
| 审查后验证（10 项） | 10 | 1 | 0 |

### 4.2 TOCTOU 压力测试

**10 项目 × 20 轮 = 200 次并发冲突操作**

| 指标 | 结果 |
|---|---|
| TOCTOU 检测 | 200/200 (100%) |
| 漏检 | 0 |
| 错误 | 0 |
| mismatches 字段完整性 | 200/200 (100%) |
| correct_hash 完整性 | 200/200 (100%) |

覆盖 6 种语言，16-262 行文件，行为完全一致。

### 4.3 累计统计

```
总操作数:    ~320 次
总纠正/检测:  100%
失败:          0
语言覆盖:     6 (Python/JS/Kotlin/Bash/YAML/TS/MD/JSON)
```

---

## 五、文件清单

```
agent/skills/deepseek-tool-calling/
├── SKILL.md                # 技能文档（含 §7 Hash Anchor）
├── edit_helper.py          # V5 实现（read-enforced）
├── DESIGN.md               # 设计说明
├── COMPLETE_REPORT.md      # 本文档
├── TEST_REPORT_v2.md       # 第二轮测试报告
├── V3_TEST_REPORT.md       # V3 循环测试报告
├── TOCTOU_REPORT.md        # 并发冲突测试报告
└── TOCTOU_STRESS_REPORT.md # 200 次压力测试报告
```

---

## 六、已知限制

| 限制 | 影响 | 缓解 |
|---|---|---|
| TOCTOU 窗口 (read↔edit) | 并发修改导致拒绝 | `mismatches` + `actual_content` 反馈，模型可 retry |
| 错误信息格式依赖 | OMP 升级可能改变格式 | 两层解析（`_parse_rejection` + `_extract_context`） |
| `check_anchor` 内部隐藏 read | 与"强制 read"理念不一致 | 诊断工具，不参与核心流程 |
| `edit_range` 双遍遍历 | 大文件略低效 | 模型按惯例读小范围 |

---

## 七、结论

V5（read-enforced）方案通过 API 约定强制模型先 read 后 edit，hash 机械提取消除幻觉风险，edit 工具乐观锁兜底 TOCTOU 并发。320+ 次操作、200 次 TOCTOU 压力测试 **零漏检、零失败**。

唯一无法修复的固有限制是 edit 工具自身的接口设计：**hash 不应暴露给调用者**。理想方案是 edit 工具内部管理 hash，只暴露行号接口。
