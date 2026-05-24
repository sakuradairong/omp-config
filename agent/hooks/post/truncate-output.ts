// Context truncation hook — caps large tool outputs to prevent context blow-up.
//
// Very large tool results (e.g. reading a multi-MB log file, a huge JSON dump,
// or a full database export) can consume the entire context window in a single
// turn, forcing premature compaction and degrading the agent's memory.
//
// This hook runs on every successful tool_result and truncates text content
// exceeding a configurable threshold. The truncation is clearly marked so the
// model knows content was omitted and can request the specific section it needs.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

// Per-tool type, some tools naturally produce large output and need higher limits
const TOOL_LIMITS: Record<string, number> = {
  // Code / text — moderate
  read: 80_000,
  eval: 40_000,
  bash: 60_000,
  // Structured search — can be huge
  search: 30_000,
  find: 30_000,
  ast_grep: 30_000,
  // Diagnostics
  lsp: 40_000,
  // References can explode
};

// Fallback for any tool not explicitly listed
const DEFAULT_LIMIT = 50_000;

// Truncation marker appended to clipped content
function truncationNote(originalLen: number, truncatedLen: number): string {
  const omitted = originalLen - truncatedLen;
  const kb = (omitted / 1024).toFixed(1);
  return (
    `\n\n[... truncated by output-limit hook: ${kb} KB (${omitted.toLocaleString()} chars) omitted. ` +
    `Re-run with a narrower scope or use offset/limit to fetch the specific section needed.]`
  );
}

export default function (pi: HookAPI): void {
  pi.on("tool_result", async (event) => {
    if (event.isError) return;
    if (!event.content || !Array.isArray(event.content)) return;

    const limit = TOOL_LIMITS[event.toolName] ?? DEFAULT_LIMIT;
    let changed = false;

    const capped = event.content.map((chunk: Record<string, unknown>) => {
      if (chunk.type !== "text") return chunk;

      const text = String(chunk.text ?? "");
      if (text.length <= limit) return chunk;

      changed = true;
      return {
        ...chunk,
        text: text.slice(0, limit) + truncationNote(text.length, limit),
      };
    });

    if (changed) {
      return { content: capped };
    }
  });
}
