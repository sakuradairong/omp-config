# Oh My Pi (OMP) 配置合集

个人的 [Oh My Pi](https://github.com/oh-my-pi/omp) 编码代理配置，已脱敏可用于参考或复用。

## 目录结构

```
~/.omp/
├── CLAUDE.md                          # Agent 行为指令 + 全局工作流
├── skills/
│   └── plan-execute-review-commit.md  # 自定义 skill: 4 阶段工作流
└── agent/
    ├── config.yml                     # 主配置（模型角色、压缩、内存等）
    ├── models.yml                     # DeepSeek V4 模型覆盖（reasoning 兼容）
    ├── hooks/
    │   └── pre/
    │       ├── guard-destructive.ts        # 安全守卫：拦截危险 bash 命令
    │       ├── opencode-deepseek-cot.ts    # DeepSeek 思维链兼容 + 参数修复
    │       └── opencode-deepseek-tool-repair.ts  # DeepSeek 工具调用修复
    └── skills/
        └── deepseek-tool-calling/
            └── SKILL.md               # DeepSeek 工具调用最佳实践
```

## 要点

### 模型配置
- 使用 **OpenCode Go API**（`opencode-go` 提供者）
- 默认模型: `deepseek-v4-pro`（推理模式 xhigh）
- 计划模式: `deepseek-v4-pro`（关闭推理）
- 设计/快速: `deepseek-v4-flash`

### Hooks（钩子）
三个 pre-hook 协同工作，确保 DeepSeek V4 系列模型的稳定性：

| Hook | 功能 |
|------|------|
| `guard-destructive` | 拦截 `rm -rf /`、`dd`、`mkfs` 等危险命令 |
| `opencode-deepseek-cot` | 补全历史消息中缺失的 `reasoning_content`，修复工具调用参数 |
| `opencode-deepseek-tool-repair` | 修复 DeepSeek 常见 JSON 格式错误（双重编码、数组/可选/null 字段） |

### 自定义 Skills
- **plan-execute-review-commit**: 严格的 Plan → Execute → Review → Commit 四阶段工作流，实现类任务须先出方案等批准
- **deepseek-tool-calling**: 指导模型避免工具调用 JSON 格式错误

## 使用方法

将这些文件按目录结构放置到 `~/.omp/` 下，重启 OMP 即可生效。

```bash
# 克隆
git clone https://github.com/sakuradairong/omp-config.git /tmp/omp-config
# 复制到 OMP 配置目录
cp -r /tmp/omp-config/* ~/.omp/
```

> ⚠️ `config.yml` 中的路径已从 `/root/` 替换为 `~/`，适配非 root 环境。
