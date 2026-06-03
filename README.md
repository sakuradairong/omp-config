# Oh My Pi (OMP) 配置合集

个人的 [Oh My Pi](https://github.com/oh-my-pi/omp) 编码代理配置，完整同步自 `~/.omp/`。
## 目录结构

```
~/.omp/
├── CLAUDE.md                                   # Agent 行为指令 + 全局工作流
├── .gitignore                                  # 排除运行时文件
├── skills/                                     # 全局技能（18 个）
│   ├── brainstorming/                          # 结构化构思
│   ├── ecc/                                    # ECC 技能集（249 个）
│   ├── ...（共 18 个技能目录）
└── agent/
    ├── config.yml                              # 主配置（角色/压缩/模型/扩展）
    ├── models.yml                              # 模型定义 + DeepSeek V4 覆盖
    ├── mcp.json                                # MCP 服务（gitnexus）
    ├── .env.example                            # 环境变量模板
    ├── .gitignore
    ├── agents/                                 # 子代理（70 个）
    │   ├── task.md                             # 通用子代理
    │   ├── explore.md                          # 代码探索子代理
    │   ├── plan.md                             # 架构规划子代理
    │   ├── reviewer.md                         # 代码审查子代理
    │   ├── ecc-planner.md                      # ECC 规划代理
    │   ├── ecc-code-reviewer.md                # ECC 代码审查代理
    │   └── ...（共 70 个代理定义）
    ├── hooks/
    │   ├── pre/
    │   │   ├── guard-destructive.ts            # 安全守卫：拦截危险 bash 命令
    │   │   ├── opencode-deepseek-cot.ts        # DeepSeek reasoning_content 补全
    │   │   ├── opencode-deepseek-tool-repair.ts# DeepSeek 工具参数修复
    │   │   ├── opencode-deepseek-edit-anchor.ts# edit 锚点格式验证
    │   │   └── opencode-deepseek-tool-result.ts# 工具结果格式化
    │   └── post/
    │       ├── redact-secrets.ts               # 工具输出脱敏
    │       └── truncate-output.ts              # 超长输出截断
    └── skills/                                 # Agent 技能（12 个）
        ├── deepseek-tool-calling/              # DeepSeek V4 工具调用最佳实践
        ├── conventional-commits/               # Conventional Commits 规范
        ├── docker-compose/                     # Docker Compose V2 最佳实践
        ├── go-testing/                         # Go 测试规范
        ├── caveman/                            # 极简通信模式
        ├── diagnose/                           # 诊断循环
        ├── grill-with-docs/                    # 文档对质
        ├── handoff/                            # 交接文档生成
        ├── improve-codebase-architecture/      # 架构深化
        ├── prototype/                          # 快速原型
        ├── tdd/                                # TDD（red-green-refactor）
        └── zoom-out/                           # 代码全景理解
```

## 要点

### 模型配置
- **主提供方**: OpenCode Go API（`opencode-go`，通过 `opencode.ai/zen/go/v1` 代理）
- **默认模型**: `deepseek-v4-flash`（推理模式 xhigh）
- **规划/慢速**: `deepseek-v4-pro`（xhigh）
- **视觉模型**: `qwen3.5-plus`（high）
- **模型覆盖**: `models.yml` 补充了 OpenCode Go API 动态发现缺失的 reasoning/compat 标志
  - `maxTokensField: max_tokens`（DeepSeek 使用 max_tokens 而非 max_completion_tokens）
  - `requiresAssistantContentForToolCalls: true`（DeepSeek 工具调用需非空 content）
  - `supportsDeveloperRole: false`（DeepSeek 不支持 developer role，使用 system）
  - `extraBody: thinking: { type: enabled }`（显式启用 DeepSeek V4 推理模式）
- **直连备选**: `deepseek` provider 直连 DeepSeek API 的完整覆盖
- **Anthropic 格式**: `deepseek-anthropic` provider 通过 Anthropic Messages API 访问 DeepSeek
### 模型角色

| 角色 | 模型 | 推理级别 |
|------|------|----------|
| default | deepseek-v4-flash | xhigh |
| plan | deepseek-v4-pro | xhigh |
| slow | deepseek-v4-pro | xhigh |
| designer | deepseek-v4-flash | xhigh |
| smol | deepseek-v4-flash | xhigh |
| vision | qwen3.5-plus | high |

### Hooks（钩子）

所有钩子使用 `@oh-my-pi/pi-coding-agent/extensibility/hooks` API，兼容 OMP 15.3.x。

#### Pre-hooks（工具调用前）

| Hook | 事件 | 功能 |
|------|------|------|
| `guard-destructive` | `tool_call` | 拦截 `rm -rf /`、`dd`、`mkfs` 等危险命令 |
| `opencode-deepseek-cot` | `context` | 补全历史消息中缺失的 `reasoning_content` |
| `opencode-deepseek-tool-repair` | `context` | 修复 DeepSeek 常见 JSON 格式错误（双重编码、数组/null/可选字段） |
| `opencode-deepseek-edit-anchor` | `tool_call` | 验证 edit 锚点 `LINE+HASH` 格式正确性 |
| `opencode-deepseek-tool-result` | `tool_result` | 工具结果格式化（非空保证、ANSI 清理、摘要行） |

#### Post-hooks（工具结果后）

| Hook | 事件 | 功能 |
|------|------|------|
| `redact-secrets` | `tool_result` | 输出中脱敏 API Key、Token 等密钥 |
| `truncate-output` | `tool_result` | 超长输出（>50KB）截断并标记 |

### Agents（子代理）

`agent/agents/` 目录包含 70 个子代理定义，格式为 Markdown 指令文件：

| 类别 | 代理 |
|------|------|
| **通用** | `task`、`explore`、`plan`、`reviewer`、`designer`、`librarian`、`quick_task` |
| **ECC 审查** | `ecc-code-reviewer`、`ecc-cpp-reviewer`、`ecc-csharp-reviewer`、`ecc-django-reviewer`、`ecc-fastapi-reviewer`、`ecc-flutter-reviewer`、`ecc-fsharp-reviewer`、`ecc-go-reviewer`、`ecc-java-reviewer`、`ecc-kotlin-reviewer`、`ecc-python-reviewer`、`ecc-react-reviewer`、`ecc-rust-reviewer`、`ecc-swift-reviewer`、`ecc-typescript-reviewer`、`ecc-mle-reviewer`、`ecc-healthcare-reviewer`、`ecc-network-config-reviewer` |
| **ECC 构建** | `ecc-build-error-resolver`、`ecc-cpp-build-resolver`、`ecc-dart-build-resolver`、`ecc-django-build-resolver`、`ecc-go-build-resolver`、`ecc-java-build-resolver`、`ecc-kotlin-build-resolver`、`ecc-pytorch-build-resolver`、`ecc-react-build-resolver`、`ecc-rust-build-resolver`、`ecc-swift-build-resolver` |
| **ECC 架构** | `ecc-architect`、`ecc-code-architect`、`ecc-code-explorer`、`ecc-code-simplifier`、`ecc-network-architect`、`ecc-homelab-architect`、`ecc-planner`、`ecc-harness-optimizer` |
| **ECC 安全** | `ecc-security-reviewer`、`ecc-security-scan`、`ecc-silent-failure-hunter`、`ecc-type-design-analyzer`、`ecc-pr-test-analyzer`、`ecc-comment-analyzer` |
| **ECC 测试** | `ecc-e2e-runner`、`ecc-tdd-guide`、`ecc-gan-planner`、`ecc-gan-generator`、`ecc-gan-evaluator` |
| **ECC 其他** | `ecc-a11y-architect`、`ecc-chief-of-staff`、`ecc-doc-updater`、`ecc-docs-lookup`、`ecc-conversation-analyzer`、`ecc-database-reviewer`、`ecc-homelab-architect`、`ecc-marketing-agent`、`ecc-network-troubleshooter`、`ecc-network-config-reviewer`、`ecc-loop-operator`、`ecc-opensource-forker`、`ecc-opensource-sanitizer`、`ecc-opensource-packager`、`ecc-performance-optimizer`、`ecc-refactor-cleaner`、`ecc-harmonyos-app-resolver`、`ecc-seo-specialist` |

### Skills

#### 全局技能（`~/.omp/skills/`）

ECC 技能集（249 个）+ Superpowers 工作流技能集（17 个），共 18 个技能目录，通过 `customDirectories: [/root/.omp/skills]` 加载。

| 技能 | 用途 |
|------|------|
| `using-superpowers` | 入口：如何发现和使用技能 |
| `brainstorming` | 结构化工期，always-apply |
| `writing-plans` | 编写分步实施计划 |
| `subagent-driven-development` | 子代理驱动执行 |
| `executing-plans` | 单会话计划执行 |
| `systematic-debugging` | 四阶段根因调试 |
| `test-driven-development` | RED-GREEN-REFACTOR |
| `verification-before-completion` | 基于证据的完成验证 |
| `using-git-worktrees` | 隔离工作区管理 |
| `dispatching-parallel-agents` | 并行任务分发 |
| `requesting-code-review` | 代码审查请求 |
| `receiving-code-review` | 审查反馈处理 |
| `finishing-a-development-branch` | 分支完结决策 |
| `writing-skills` | 技能编写指南 |
| `spike` | 快速技术验证 |
| `plan-execute-review-commit` | 四阶段工作流 |
| `ecc/` | ECC 技能集，249 个跨领域技能（自动发现） |
| `astrbot-plugin-development` | AstrBot 插件开发参考 |

#### Agent 技能（`~/.omp/agent/skills/`）

原生 provider 发现，支持 `hide: true` 前置元数据（技能仍可通过 `skill://` 访问，但不显示在系统提示技能列表）。

| 技能 | hide | 说明 |
|------|------|------|
| `deepseek-tool-calling` | ✅ | DeepSeek V4 工具调用最佳实践（always-apply） |
| `caveman` | ✅ | 极简通信模式（通过 /caveman 触发） |
| `handoff` | ✅ | 交接文档生成（通过 /handoff 触发） |
| `diagnose` | — | 系统化诊断循环 |
| `grill-with-docs` | — | 文档对质以完善设计 |
| `improve-codebase-architecture` | — | 架构深化建议 |
| `prototype` | — | 快速原型设计 |
| `tdd` | — | 测试驱动开发 |
| `zoom-out` | — | 代码全景理解 |
| `conventional-commits` | — | Conventional Commits 规范 |
| `docker-compose` | — | Docker Compose V2 最佳实践 |
| `go-testing` | — | Go 测试规范（testify + 表驱动） |

### 编辑工作流

OMP 15.3.x 原生 hashline 编辑系统，无需辅助脚本：

```
read <file>:<range>        # 获取 §PATH 头和 LINEID|content
edit input="§<file>
   ≔ <line><hash>          # 替换：行号+哈希锚点
     <new content>"
   « <line><hash>          # 行前插入
     <new line>"
   » <line><hash>          # 行后插入
     <new line>"
```

原生 stale-anchor recovery 通过 read 缓存 3-way merge 自动恢复哈希不匹配。

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
