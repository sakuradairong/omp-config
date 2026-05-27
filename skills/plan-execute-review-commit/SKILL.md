---
name: plan-execute-review-commit
description: "Autonomous 4-stage workflow: Plan → Execute → Review → Commit"
---

# Plan → Execute → Review → Commit

Strict 4-stage workflow for every implementation task. Do NOT merge or skip stages.

## Stage 1: Plan 🔍
- Understand the request, read relevant files, analyze codebase
- Present a clear step-by-step plan to the user
- **Wait for approval** before proceeding to Stage 2

## Stage 2: Execute 🛠️
- Implement changes one step at a time in order
- Verify each file after writing
- Fix issues immediately
- Run relevant tests/linters

## Stage 3: Review 👀
- Review ALL changed files for: correctness, edge cases, error handling, style consistency, security, performance
- Fix any issues found
- Present review summary

## Stage 4: Commit ✅
- `git add` relevant files
- `git diff --cached` to verify
- Commit with structured message:
  ```
  <type>(<scope>): <brief summary>

  <detailed description>
  ```
  Types: feat | fix | refactor | docs | style | test | chore | perf
- Push if requested

## Constraints
- Always present plan before implementing (Stage 1 → user approval gate)
- No changes outside the approved plan's scope
- If something unexpected comes up, stop and inform user
- Commit messages in the language of the codebase
