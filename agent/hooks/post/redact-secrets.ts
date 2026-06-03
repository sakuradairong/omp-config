export const name = "redact-secrets";
export const event = "tool_result";

export function execute(toolResult: any) {
  const secrets = [
    /sk-[a-zA-Z0-9]{20,}/g,
    /(?:ghp|gho|ghu|ghs)_[a-zA-Z0-9]{36,}/g,
    /api[_-]?key['"]?\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi,
    /(?:eyJ|R0VU)[a-zA-Z0-9_\-]{10,}(?:\.(?:[a-zA-Z0-9_\-]{10,})){1,}/g,
  ];
  if (typeof toolResult?.result !== "string") return;
  for (const pattern of secrets) {
    toolResult.result = toolResult.result.replace(pattern, "[REDACTED]");
  }
}
