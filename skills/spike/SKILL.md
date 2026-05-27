---
name: spike
description: "Throwaway experiments to validate an idea before build"
---

# Spike — Throwaway Experiments

**When to use:**
- Validating an approach before committing to it
- Exploring unfamiliar APIs, libraries, or patterns
- Testing performance characteristics
- Confirming whether a design works

## Procedure

### 1. Define the Question
Write down exactly what you need to learn:
- "Does library X support feature Y?"
- "Will approach Z achieve acceptable performance?"
- "Is pattern W feasible in this codebase?"

### 2. Build Minimal Experiment
- Create isolated prototype (new file/scratch directory)
- Minimal code to answer the question — nothing else
- Hardcode inputs, skip error handling, no tests
- This is throwaway code — quality doesn't matter

### 3. Run and Learn
- Execute the experiment
- Collect data, timings, outputs
- Document the answer to your question

### 4. Decide
- **Proceed:** Approach validated → delete spike code, implement properly
- **Pivot:** Approach doesn't work → try alternative
- **Abandon:** Feature not feasible → document and move on

## Rules
- **Spike code is throwaway.** Never evolve it into production code.
- **Timebox.** Set a timer (30-60 min). If not answered, simplify question.
- **Delete when done.** Keep only the learnings, not the code.
- **Document decision.** Write down what you learned and why.
