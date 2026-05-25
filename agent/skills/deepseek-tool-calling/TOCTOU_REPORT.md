# TOCTOU 并发冲突测试报告

> 测试日期：2026-05-25
> 测试场景：6 种并发冲突模式

---

## 一、什么是 TOCTOU

TOCTOU (Time-of-Check to Time-of-Use) 指校验和使用的间隙中文件被修改导致的竞态条件。

```
时间线:
① helper:  read 文件 → hash = "ab"
②          子代理修改了文件（插入/删除/修改）
③ helper:  edit(input="≔42ab") → hash 不匹配 → 拒绝
```

## 二、测试场景

| 编号 | 场景 | 子代理行为 | 期望结果 |
|---|---|---|---|
| 1 | 上游插入行 | L3 后插入 2 行 | edit 拒绝，行号漂移 |
| 2 | 修改同一行 | 把同一行改成不同内容 | edit 拒绝，hash 变化 |
| 3 | 删除目标行 | 删除 L8 | edit 拒绝，行不存在 |
| 4 | 改不同行 | 改 L11（主进程改 L14） | edit 成功（正确） |
| 5 | 缓存过期 | 忘记 invalidate_cache | helper 自身仍能检测 |
| 6 | 子代理用 helper | 子代理也用 check_and_replace | 各自独立 |

## 三、测试结果

### 场景 1：上游插入行

```
主进程: L5 = "debug": True   hash=pp   input=≔5pp  ✓
子代理: 在 L3 后插入内容      ↓
主进程: edit(input="≔5pp") → 被拒绝！
        → Edit rejected: 2 anchors do not match

恢复:
  re-read → "debug" 移至 L9, hash=hr
  check_and_replace(BASE, "hr", 9, 9, ...) → 成功 ✓
```

**结论**: 行号漂移后旧 anchor 被 edit 工具的乐观锁准确拦截。

### 场景 2：修改同一行

```
主进程: L4 "CONFIG = {"   hash=ak  准备改为 "SETTINGS = {"
子代理: 抢先改同一行 → "settings = {"  (新 hash=aw)
主进程: edit(input="≔4ak") → 被拒绝！

恢复:
  re-read → hash=aw → 用 aw 重试 → 成功 ✓
```

**结论**: hash 正确检测到行内容变化。

### 场景 3：删除目标行

```
主进程: L8 "features"   hash=cw  准备简化
子代理: 删除 L8
主进程: edit(input="≔8cw") → 被拒绝！

恢复:
  re-read → L8 已不存在 → 调整操作 → 编辑其他行 ✓
```

**结论**: 目标行不存在时 edit 拒绝，但模型需要自行调整编辑策略。

### 场景 4：改不同行（关键发现）

```
主进程: L14 greet   hash=is  准备改为 "Hi"
子代理: L11 get_config   hash=ao  改默认值签名
主进程: edit(input="≔14is") → 成功！ ✓
结果: L14 greet 正确改为 "Hi"
      L11 get_config 也正确改为带默认值版本
```

**结论": 当子代理修改的行不是主进程的目标行时，hash 校验通过。
这不是漏洞——两个编辑操作不冲突，应该都执行。
hash 只保证"你编辑的行当前状态与 read 时一致"。

### 场景 5：缓存过期

```
check_and_replace 内部总是调用 tool.read() 读文件。
_anchor_cache 是已废弃的死代码，当前版本不使用。

即使忘记 invalidate_cache：
  → helper 自己读文件 → 发现 hash 不匹配 → 报错
  → 不会静默使用过期 hash
```

**结论": invalidate_cache 在当前版本中已无实际作用。

## 四、防御层次

```
┌─ 第一层: helper 校验 ─────────────────────┐
│  check_and_replace / check_anchor          │
│  每次调用读文件，校验声称的 hash            │
│  错误时报告 correct hash，不浪费 edit 调用  │
└────────────────────────────────────────────┘
                      ↓ 通过
┌─ 第二层: edit 工具乐观锁 ──────────────────┐
│  即使 helper 校验通过，edit 自己再读一次     │
│  文件 → 验证 → hash 不匹配 → 拒绝           │
│  最终权威，不可绕过                         │
└────────────────────────────────────────────┘
                      ↓ 通过
┌─ 第三层: 日志可见性 ───────────────────────┐
│  所有拒绝在日志中标注:                       │
│  "Edit rejected: N anchors do not match"    │
│  便于人工审查                               │
└────────────────────────────────────────────┘
```

## 五、总结

| 防御能力 | 结论 |
|---|---|
| 并发插入/删除/修改能否检测？ | ✅ 全部检测，edit 拒绝 |
| 能否自愈恢复？ | ✅ re-read + 新 hash 重试 |
| 修改不同行是否误报？ | ❌ 不会，正确放行 |
| 缓存过期是否危险？ | ❌ 不会，每次读文件 |
| 能否完全替代乐观锁？ | ❌ 不能，edit 工具自己的校验才是最终权威 |
