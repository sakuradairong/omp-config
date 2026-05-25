# V3 Helper 循环测试报告

> 测试日期：2026-05-25
> 测试版本：auto-retry from edit tool error

---

## 测试范围

| 分组 | 文件 | 语言 | 行数 | 轮次 | 错误hash | 说明 |
|---|---|---|---|---|---|---|
| A | app.py | Python | 22 | 5 | 5 | replace / insert / delete |
| B | rules.js | JavaScript | 40 | 6 | 2 | replace / append |
| C | recorder.kt | Kotlin | 105 | 6 | 4 | 多行replace / insert / delete |
| D | install.sh | Bash | 60 | 6 | 1+TOCTOU | 混合操作 + 并发行漂移 |
| E | 全部(4文件) | 混合 | — | 20 | 20 | Stress 全部错误hash |
| **合计** | **4** | **4** | — | **37** | **31** | **100%** |

## 操作类型分布

| 操作 | 次数 |
|---|---|
| replace (单行) | 25 |
| replace (多行) | 2 |
| insert_after | 3 |
| insert_before | 3 |
| delete | 2 |
| append | 2 |
| **总计** | **37** |

## 结果

- 总轮次: 37
- 成功: 37 (100%)
- 失败: 0
- 自动重试: 31 次（全部由错误 hash 触发，全部成功）
- TOCTOU: 子代理插入 → 主进程行漂移 → 自动纠正

## 关键验证

### 重试透明度

```python
# 模型声称错误 hash
replace("/app.py", "xx", 4, 9, "CONFIG = { ... }")
# 内部：edit 拒绝 → 解析错误 → 提取正确 hash → retry
# 外部：一次函数调用，返回成功
```

31 次重试全部在 `eval` 调用内完成，不消耗额外 tool call。

### TOCTOU 并发

```
子代理: replace(hash=ay, L3, "# subagent insert")
主进程: replace(hash=ay, L5, "# after conflict")
        实际 L5 已被子代理插入的行推到 L7
        → edit 拒绝 → 自动提取正确 hash → 重试成功
```

### Stress 全错误

20 轮全部使用随机错误 hash（如 `bd`, `mf`, `za` 等），全部被 edit 工具拒绝后自动纠正。
