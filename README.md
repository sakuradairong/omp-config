# Oh My Pi (OMP) 配置合集

个人的 [Oh My Pi](https://github.com/oh-my-pi/omp) 编码代理配置，已脱敏可用于参考或复用。

融合了 [kmou424/omp-agent](https://git.kmou424.moe:8443/configs/omp-agent) 的结构化最佳实践。

## 目录结构

```
~/.omp/
├── CLAUDE.md                                   # Agent 行为指令 + 全局工作流
├── skills/
│   └── plan-execute-review-commit.md           # 自定义 skill: 4 阶段工作流
└── agent/
    ├── config.yml                              # 主配置（角色/压缩/模型/扩展）
    ├── models.yml                              # 模型定义 + DeepSeek V4 覆盖
    ├── mcp.json                                # MCP 服务（deepwiki + github）
    ├── .env.example                            # 环境变量模板
    ├── .gitignore                              # 版本控制忽略规则
    ├── agents/
    │   └── TestGo.md                           # Go 测试子代理
    ├── hooks/
    │   └── pre/
    │       ├── guard-destructive.ts            # 安全守卫：拦截危险 bash 命令
    │       ├── opencode-deepseek-cot.ts        # DeepSeek 思维链兼容 + 参数修复
    │       └── opencode-deepseek-tool-repair.ts # DeepSeek 工具调用修复
    └── skills/
        ├── deepseek-tool-calling/              # DeepSeek 工具调用最佳实践
        ├── go-testing/                         # Go 测试规范
        ├── conventional-commits/               # Conventional Commits 规范
        └── docker-compose/                     # Docker Compose V2 专家
```

## 要点

### 模型配置
- **主提供方**: OpenCode Go API（`opencode-go`，通过 `opencode.ai` 代理）
- **默认模型**: `deepseek-v4-pro`（推理模式 xhigh）
- **内置覆盖**: 补充了 OpenCode Go API 缺失的 reasoning/compat 标志
- **扩展提供方**: DeepSeek 直连、自托管 OpenAI、NekoCode（Claude/GPT 代理）—— 按需取消注释

### 模型角色

| 角色 | 模型 | 推理 |
|------|------|------|
| default | deepseek-v4-pro | xhigh |
| smol / commit / quick_task | deepseek-v4-flash | off |
| slow | deepseek-v4-pro | xhigh |
| designer / task / explore / reviewer / librarian | deepseek-v4-flash | xhigh |
| plan | deepseek-v4-pro | off |
| vision | qwen3.5-plus | — |

### Hooks（钩子）

| Hook | 功能 |
|------|------|
| `guard-destructive` | 拦截 `rm -rf /`、`dd`、`mkfs` 等危险命令 |
| `opencode-deepseek-cot` | 补全历史消息中缺失的 `reasoning_content`，修复工具调用参数 |
| `opencode-deepseek-tool-repair` | 修复 DeepSeek 常见 JSON 格式错误（双重编码、数组/可选/null 字段） |

### Skills

| Skill | 来源 | 说明 |
|-------|------|------|
| plan-execute-review-commit | 自定义 | Plan → Execute → Review → Commit 四阶段工作流 |
| deepseek-tool-calling | 自定义 | 指导模型避免工具调用 JSON 格式错误 |
| go-testing | 移植 | Go 测试规范（testify + 表驱动） |
| conventional-commits | 移植 | 规范化 commit message |
| docker-compose | 移植 | Docker Compose V2 最佳实践 |

## 使用方法

```bash
git clone https://github.com/sakuradairong/omp-config.git /tmp/omp-config
cp -r /tmp/omp-config/* ~/.omp/

# 配置环境变量
cp ~/.omp/agent/.env.example ~/.omp/agent/.env
# 编辑 .env 填入 API Key
```

> ⚠️ `config.yml` 中的路径已从 `/root/` 替换为 `~/`，适配非 root 环境。
> 扩展提供方（自托管/NekoCode）默认注释，按需开启。
