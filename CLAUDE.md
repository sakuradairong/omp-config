# Oh My Pi — Agent Instructions

This file configures agent behavior for the omp environment.
Skills are installed at `~/.omp/skills/` and loaded via `skill://<name>`.

## Workflow: always work in this order

For any non-trivial task, progress through these phases.
Use `/skill:<name>` or `read skill://<name>` to load the full skill.

```
Brainstorm → Plan → Implement/Execute → Verify → Review → Finish
```

| Phase | Skill | When |
|---|---|---|
| **Brainstorm** | `brainstorming` | Before creative work, features, design decisions |
| **Plan** | `writing-plans` | Before multi-step or multi-file changes |
| **Isolate** | `using-git-worktrees` | Before starting feature work (if workspace needs isolation) |
| **Parallel** | `dispatching-parallel-agents` | When 2+ independent tasks exist |
| **Execute** | `executing-plans` / `subagent-driven-development` | When executing a written plan |
| **Debug** | `systematic-debugging` | On any bug, test failure, or unexpected behavior |
| **Test** | `test-driven-development` | Before writing implementation code |
| **Verify** | `verification-before-completion` | Before claiming work is done |
| **Review** | `requesting-code-review` | Before merging or PR |
| **Finish** | `finishing-a-development-branch` | When implementation is complete |
| **Code Review (receiving)** | `receiving-code-review` | When responding to review feedback |

## Available Skills (16 total)

### From Superpowers
- `skill://using-superpowers` — Entry point: how to find and invoke skills
- `skill://brainstorming` — Structured ideation before implementation
- `skill://writing-plans` — Bite-sized implementation plans with task list
- `skill://dispatching-parallel-agents` — Fan out independent tasks
- `skill://subagent-driven-development` — Execute plans with parallel subagents
- `skill://executing-plans` — Single-session plan execution with checkpoints
- `skill://systematic-debugging` — 4-phase root cause debugging
- `skill://test-driven-development` — RED-GREEN-REFACTOR cycle
- `skill://verification-before-completion` — Evidence-based completion checks
- `skill://requesting-code-review` — Quality gates before merging
- `skill://receiving-code-review` — Handle review feedback with rigor
- `skill://finishing-a-development-branch` — Merge/PR/cleanup decisions
- `skill://using-git-worktrees` — Isolated workspace management
- `skill://writing-skills` — Creating and editing skills

### From astrbot-plugin-dev
- `skill://astrbot-plugin-development` — AstrBot plugin: structure, pitfalls, AI patterns

### Pre-installed
- `skill://spike` — Throwaway experiments to validate approaches

## Tool Priority (OMP convention)

Always prefer OMP's dedicated tools over shell commands:

| Task | Tool | Not |
|---|---|---|
| Read code | `read` | `cat`, `head`, `tail`, `sed -n` |
| Search code | `search` | `grep`, `rg`, `git grep` |
| Find files | `find` | `ls **/*`, `fd` |
| Edit code | `edit` (hashline) | `sed -i`, `echo >>` |
| Structural rewrite | `ast_edit` | `sed`, `awk` |
| Symbol-aware rename | `lsp rename` | `ast_edit`, `sed` |
| Code intelligence | `lsp` | blind text search |
| Debug | `debug` (DAP) | ad-hoc print/echo |
| Fetch web | `read <url>` | `curl`, `wget` |
| Parallel work | `task` | sequential bash |

## OMP Features to Leverage

| Feature | Mechanism | Benefit |
|---|---|---|
| Plan mode | `/plan` or `resolve(action:apply, extras:{plan...})` | Planner drafts read-only; approve before execute |
| Session branching | `/branch`, `/fork` | Explore alternatives without losing history |
| Context compaction | `/compact [focus]` | Free context window, keep summary |
| Subagents | `task` tool + IRC | Parallel investigation, DM between agents |
| LSP | `lsp references/definition/rename` | Cross-file refactors safely |
| Memory | `read memory://root` | Cross-session project knowledge |

## GitNexus — MCP Code Knowledge Graph

GitNexus indexes git repos into a code knowledge graph and exposes it via MCP (16 tools + 8 resources).

Used for: impact analysis, code search, symbol context, refactoring, change detection.

**MCP Server already configured** in both Hermes and OMP (`command: "gitnexus"`, `args: ["mcp"]`).

Index a repo:
```bash
cd /path/to/repo
gitnexus analyze
```

Tools available (prefixed with `mcp_gitnexus_`):
- `context` — 360° symbol view
- `impact` — blast radius analysis  
- `query` — hybrid search (BM25 + semantic)
- `detect_changes` — git diff impact mapping
- `rename` — cross-file coordinated rename

**IMPORTANT:** If you see `backup_script` as the only indexed repo, the user needs to `gitnexus analyze` their actual repos.

## Deep Patterns (learned from docs.omp.sh)

### Edit workflow (fail-safe)
```
1. read <file>:<range>   # capture §PATH header + LINEID|content
2. edit input="§<file>   # reference anchors exactly
   ≔ <anchors>
     <new code>"
3. lsp diagnostics       # verify after edit
```
If `edit` returns a stale-anchor error: re-`read` the file slice (anchors changed), then re-emit.

### GitHub as virtual FS
```
read pr://1234                     # metadata + comments
read pr://1234/diff/all            # full diff (hashline-anchorable)
read issue://?state=open&label=bug # list open bugs
github op=pr_create fill=true      # PR from commits
github op=pr_checkout pr=1234      # checkout into worktree
```

### Subagent patterns
- After `task` completes, `read agent://<id>` to inspect subagent transcript
- IRC asymmetric handshake: peer A stays alive, peer B DMs and waits for reply
- NEVER have peer A finish, then B tries to DM A (A is already dead)

### Read-only audit mode
For review/audit tasks without risk of unintended edits:
```
omp --tools read,grep,find,search --no-lsp -p "audit src/"
```

### LSP quick-fix pattern
After any edit, run `lsp diagnostics` + `lsp code_actions` to catch errors and apply server-offered fixes (missing imports, etc.).

### Context management
- `/compact [focus]` when approaching token limit
- `/context` to see breakdown before a big turn
- `/usage` to check rate-limit headroom
- When exceeding, disable streaming or compact before the next turn

### Model roles
- `smol`: title gen, classification, cheap tasks
- `slow`: deep reasoning, architecture decisions (Ctrl+P cycles)
- `plan`: `/plan` mode uses this role
- `main`: everything else (default)

### Safety
- `guard-destructive.ts` hook installed at `~/.omp/agent/hooks/pre/`
- Blocks `rm -rf /`, `dd to /dev`, `mkfs`, pipe-from-web to shell
- If a legitimate operation is blocked, retry with explicit path safety guards

## Round 3: Context, Templates, MCP

### Context files (filesystem-driven, no config needed)
| File | Purpose | When injected |
|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | Project notes, conventions | System prompt at session start |
| `APPEND_SYSTEM.md` | Append after default prompt | System prompt |
| `SYSTEM.md` | ⚠️ Replace entire system prompt | System prompt (last wins) |
| `RULES.md` | Hard constraints, sticky | Every turn (stays in recency) |

### Custom slash commands
`~/.omp/agent/commands/<name>.md` with YAML frontmatter
```markdown
---
description: Review a file
argument-hint: <path>
model: smol
allowed-tools: [read, search]
---
Review $1 for correctness and edge cases.
```

### Three-tier web access
1. `web_search` synthesised answer + URLs
2. `read <url>` reader-mode (faster, cheaper)
3. `browser` only for JS/auth/interactive

### MCP integration
Config in `.omp/mcp.json` or `~/.omp/agent/mcp.json`:
- `stdio`: local process via npx
- `http`: remote endpoint + bearer/OAuth
- `tools.discoveryMode: mcp-only` saves context by gating behind mcp_discover

### Plugins
`omp install <source>` from npm, git, local, or marketplace.
`omp install -l <source>` for project scope (sharable via git).
Plugins bundle skills, commands, hooks, tools, MCP, themes.

### Session JSONL format
Tool calls are inside `assistant` messages as `tool_use` blocks.
Read any session file with hashline anchors: `read ~/.omp/agent/sessions/<hash>/<id>.jsonl`
Entry types: session, message, model_change, mode_change, label, compaction, branch_summary
Labels survive compaction.

### Custom tools (TypeScript)
`~/.omp/agent/tools/<name>/index.ts` with TypeBox `parameters` schema.
`onUpdate(partial)` streams progress to TUI.
Return `{ content, details, isError }`.
Name collisions with built-ins are rejected (built-ins win).

### OMP CLI shorthand
| Flag | Use case |
|---|---|
| `--tools read,search,edit` | Restrict tool surface for audit |
| `--no-lsp` | Skip language server startup |
| `--no-session` | Ephemeral run, nothing persisted |
| `--system-prompt @file.txt` | Custom system prompt per run |
| `--append-system-prompt @file.txt` | Extend default prompt |

---

## 🌍 全局工作流：Plan → Execute → Review → Commit

对于任何**实现类任务**（编写代码、修改功能、修复 bug、重构），必须严格遵循以下 4 阶段流程。这是默认行为，不需要用户每次重复指示。

加载 skill：`skill://plan-execute-review-commit`

### 阶段 1：Plan 🔍
1. 彻底理解需求，阅读相关代码，分析现有结构
2. 制定清晰的分步实施方案
3. **向用户呈现方案并等待批准** → 用户确认后才能进入下一阶段

### 阶段 2：Execute 🛠️
1. 按计划顺序逐一实现
2. 改完后验证文件正确性
3. 遇到问题立即修复
4. 运行测试/linter 确保无破坏

### 阶段 3：Review 👀
1. 全面审查所有改动：正确性、边界情况、错误处理、风格一致性、安全性、性能
2. 修复发现的问题
3. 输出审查总结

### 阶段 4：Commit ✅
1. `git add` 相关文件
2. `git diff --cached` 确认改动
3. 规范的 commit message：
   `<type>(<scope>): <简短描述>`
4. 需要时推送

### 规则
- 必须先出方案，批准后再实施
- 不改方案范围外的代码
- 遇到意外问题先停住告知用户
- commit message 用英文（除非项目规范要求中文）
- 简单的回答/解释/咨询类问题不触发此流程（只用于实现类任务）

---

## GitNexus Code Intelligence

GitNexus indexes codebases into a knowledge graph for symbol lookup, call chains, and execution flow analysis.

### Setup
```bash
source ~/.bashrc.d/gitnexus.sh
```

### Commands
| Command | Purpose |
|---|---|
| `gx analyze <path>` | Index a repo (generates CLAUDE.md in repo root) |
| `gx list` | List indexed repos |
| `gx serve` | Start backend API on :4747 |
| `gx-proxy` | Web UI proxy on :8888 |

### Integration
- `gx analyze` generates a `CLAUDE.md` in the target repo — omp auto-loads it when working in that directory
- Generated skills go to `.claude/skills/` in the repo — configure `skills.customDirectories` to include them
- Use `read file://repo/.gitnexus/` or start the MCP server (`gx mcp`) for querying the graph

### First-time use
```bash
source ~/.bashrc.d/gitnexus.sh
gx analyze /path/to/repo
```
