// Secret redaction hook — strips sensitive patterns from tool results
// before the LLM sees them. Runs as a post-execution tool_result handler.
//
// Covers common secret formats:
//   - OpenAI / Anthropic / Google API keys
//   - AWS access keys
//   - GitHub personal access tokens
//   - Generic KEY=VALUE patterns in shell output
//   - JWT tokens
//   - Private key headers (-----BEGIN ...-----)
//
// Strategy: replace matched content with [REDACTED] placeholders
// rather than silently dropping lines, so the model knows something was scrubbed.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const SECRET_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // OpenAI / Anthropic / Google API keys
  { pattern: /\b(sk|pk)-(?:proj-|svcacct-|ant-|admin-)?[A-Za-z0-9_-]{20,}\b/g, replacement: "sk-[REDACTED]" },
  // Generic API key assignments in env/files — captures KEY name for clean replacement
  { pattern: /\b((?:API|SECRET|TOKEN|PASSWORD|AUTH)_KEY)\s*=\s*\S+/gi, replacement: "$1=[REDACTED]" },
  // AWS access keys (AKIA...)
  { pattern: /\bAKIA[A-Z0-9]{16}\b/g, replacement: "AKIA[REDACTED]" },
  // AWS secret access keys
  { pattern: /\baws_secret_access_key\s*=\s*\S+/gi, replacement: "aws_secret_access_key=[REDACTED]" },
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  { pattern: /\bgh[opsru]_[A-Za-z0-9]{36,}\b/g, replacement: "ghx_[REDACTED]" },
  // GitLab tokens
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, replacement: "glpat-[REDACTED]" },
  // Slack tokens
  { pattern: /\bxox[bsprang]-\d+-\d+-[A-Za-z0-9_-]+\b/g, replacement: "xoxx-[REDACTED]" },
  // JWT tokens (header.payload.signature)
  { pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: "[JWT-REDACTED]" },
  // Private key blocks (PEM)
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, replacement: "-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----" },
  // Connection strings with credentials — capture scheme, replace user:pass
  { pattern: /((?:mongodb|mysql|postgres|postgresql|redis|rediss):\/\/)[^:]+:[^@]+@/gi, replacement: "$1[CREDENTIALS_REDACTED]@" },
  // Bearer tokens in Authorization headers
  { pattern: /\bAuthorization:\s*Bearer\s+\S+/gi, replacement: "Authorization: Bearer [REDACTED]" },
  // Generic long base64-looking secrets (>30 chars, typical for tokens)
  { pattern: /\b[A-Za-z0-9+/=]{40,}\b/g, replacement: "[BASE64_REDACTED]" },
];

const MAX_CHUNK_SIZE = 200_000; // skip redaction on massive chunks

export default function (pi: HookAPI): void {
  pi.on("tool_result", async (event) => {
    // Skip error results — they're already short
    if (event.isError) return;
    // Skip tool results with no content
    if (!event.content || !Array.isArray(event.content)) return;

    let changed = false;

    const redacted = event.content.map((chunk: Record<string, unknown>) => {
      if (chunk.type !== "text") return chunk;

      let text = String(chunk.text ?? "");

      // Skip massive chunks to avoid perf issues
      if (text.length > MAX_CHUNK_SIZE) return chunk;

      for (const { pattern, replacement } of SECRET_PATTERNS) {
        const before = text;
        text = text.replace(pattern, replacement);
        if (text !== before) changed = true;
      }

      return { ...chunk, text };
    });

    if (changed) {
      return { content: redacted };
    }
  });
}
