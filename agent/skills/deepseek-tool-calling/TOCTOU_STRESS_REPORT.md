# TOCTOU 并发压力测试报告

> 测试日期：2026-05-25
> 版本：edit_helper V5 (read-enforced)

## 测试场景

子代理在上游 INSERT 行 → 主进程的 read_output 过期 → TOCTOU 窗口打开

```
时间线:
  ① 主进程: read L5 → read_output 包含 hash=pp
  ② 子代理: INSERT 行在 L3 → 所有行号漂移
  ③ 主进程: edit_line(read_output, L5) → hash=pp 已过期 → 被拒绝
```

## 测试矩阵

| # | 语言 | 行数 | 项目 | 来源 |
|---|---|---|---|---|
| 1 | Python | 50 | DRAM 图表脚本 | dram_price_chart.py |
| 2 | JavaScript | 60 | Joplin turndown 规则 | commonmark-rules.js |
| 3 | Kotlin | 104 | Android AudioRecorder | AudioRecorder.kt |
| 4 | Bash | 60 | OMP 安装脚本 | install.sh |
| 5 | YAML | 61 | 模型配置 | models.yml |
| 6 | TypeScript | 50 | CoT hook | opencode-deepseek-cot.ts |
| 7 | Markdown | 262 | CLAUDE.md | CLAUDE.md |
| 8 | Python | 177 | edit_helper.py 自身 | edit_helper.py |
| 9 | JSON | 16 | MCP 配置 | mcp.json |
| 10 | Markdown | 40 | Go 测试代理 | TestGo.md |

每文件 20 轮，共 **200 次 TOCTOU 操作**。

## 结果

```
总操作:          200
TOCTOU 检测:     200 (100%)   ← 全部被乐观锁拦截
漏检:              0   (0%)   ← 无漏报
错误:              0   (0%)

mismatches 字段: 200 (100%)   ← 每次拒绝都有完整纠错数据
correct_hash:    200 (100%)   ← 每次拒绝都给出正确 hash
```

## 结论

1. **TOCTOU 检测率 100%**：200 次并发插入全部被 edit 工具的乐观锁拦截
2. **纠错数据完整**：每次 `status=rejected` 都附带 `mismatches[].line`、`.correct_hash`、`.actual_content`
3. **跨语言一致**：6 种语言（Python/JS/Kotlin/Bash/YAML/TS/MD/JSON）行为完全一致
4. **文件大小无关**：16 行 JSON 和 262 行 Markdown 结果相同

## 防御层次

```
edit_line(read_output)   →  _extract_hash(read_output, line)
                              ↓ hash 提取
                          →  tool.edit(anchor_spec=hash)
                              ↓
                          →  edit 工具乐观锁校验
                              ↓
                          拒绝 ←  _parse_rejection(error)
                              ↓
                          返回 {
                            status: "rejected",
                            mismatches: [{line, correct_hash, actual_content}],
                            correct_hash, actual_content
                          }
```
