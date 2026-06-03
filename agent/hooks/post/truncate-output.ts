export const name = "truncate-output";
export const event = "tool_result";

export function execute(toolResult: any) {
  if (typeof toolResult?.result !== "string") return;
  const MAX_LENGTH = 50000;
  if (toolResult.result.length > MAX_LENGTH) {
    toolResult.result = toolResult.result.slice(0, MAX_LENGTH) +
      `\n\n[... truncated to ${MAX_LENGTH} chars]`;
  }
}
