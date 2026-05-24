// Safety guard: block destructive commands before bash runs.
//
// Catches catastrophic command patterns across multiple risk categories:
//   - Filesystem destruction (rm -rf /, dd to block devices, mkfs, redirect truncation)
//   - Permission bricking (chmod 000 on /, chown -R on system paths)
//   - Remote code execution via pipe (curl/wget | bash)
//   - Git force-push to protected branches
//   - Docker nuke-all patterns
//   - System shutdown/halt/reboot
//   - Fork bombs and resource exhaustion
//   - Firewall flush
//
// Contract: returns { block: true, reason } on match. First match wins.
// Non-bash tools pass through immediately.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

interface GuardRule {
  regex: RegExp;
  reason: string;
}

const RULES: GuardRule[] = [
  // ── Filesystem destruction ──
  {
    regex: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*[rf]|[a-zA-Z-]*[rf][a-zA-Z-]*)\s+(\/|~\/?(\s|$)|\$HOME|\$HOMEDIR)/,
    reason: "Refused: destructive rm targeting root or home",
  },
  {
    regex: /\bdd\s+.*\bif=\/dev\/(zero|urandom|random)\b.*\bof=\/(dev|mnt|run|proc|sys)/,
    reason: "Refused: dd overwriting block device or system mount",
  },
  {
    regex: /\bmk(?:fs|swap|dosfs|ext[234]|xfs|btrfs|ntfs|f2fs)\b/i,
    reason: "Refused: filesystem creation (mkfs/mkswap)",
  },
  {
    // Redirect truncation: > /dev/sda, > /etc/passwd etc.
    regex: />\s*\/(dev|etc|boot|proc|sys)\b/,
    reason: "Refused: redirect overwriting system path",
  },
  {
    // mv overwriting system directories
    regex: /\bmv\b.*\s+\/(etc|boot|bin|sbin|lib|lib64|usr|var)\b/,
    reason: "Refused: mv targeting system directory",
  },

  // ── Permission bricking ──
  {
    regex: /\bchmod\s+.*-R\s*(?:0+|[0-3]?0{2,3})\s+\//,
    reason: "Refused: chmod -R removing all permissions on /",
  },
  {
    regex: /\bchown\s+-R\b.*\s+\/(etc|boot|bin|sbin|lib|usr|var)\b/,
    reason: "Refused: chown -R on system directory",
  },

  // ── Remote code execution pipe ──
  {
    regex: /\b(curl|wget)\b.*(?:\|\s*(?:sudo\s+)?(?:ba)?sh|\|\s*(?:sudo\s+)?bash)/,
    reason: "Refused: pipe-from-web to shell",
  },

  // ── Git force-push to protected branches ──
  {
    regex: /\bgit\s+push\b.*--(?:force|delete|force-with-lease)\b.*\b(main|master|prod\w*|release\S*)\b/,
    reason: "Refused: git force-push to protected branch (main/master/prod/release)",
  },
  {
    regex: /\bgit\s+push\b.*--(?:force|delete)\b/,
    reason: "Refused: git force-push/delete — if intentional, unprotect the branch or use a non-blocked ref",
  },

  // ── Docker nuke ──
  {
    regex: /\bdocker\s+(?:rm\s+-f\s+(?:\$\(|`)\s*docker\s+ps\s+-a?q?|system\s+prune\s+-af?\b)/,
    reason: "Refused: docker mass-removal of all containers/volumes/images",
  },
  {
    regex: /\bdocker\s+volume\s+prune\s+-f\b/,
    reason: "Refused: docker volume prune -f (destroys all unused volumes)",
  },

  // ── System shutdown ──
  {
    regex: /\b(?:shutdown|reboot|halt|poweroff|init\s+[06])\b(?!\s+--help)/i,
    reason: "Refused: system shutdown/reboot/halt command",
  },

  // ── Fork bomb ──
  {
    regex: /:\(\)\s*\{[^}]*:\|:.*&\s*\}[^}]*;/,
    reason: "Refused: fork bomb pattern detected",
  },

  // ── Firewall flush ──
  {
    regex: /\biptables\s+-F\b/,
    reason: "Refused: iptables -F (flushes all firewall rules)",
  },
  {
    regex: /\biptables\s+-P\s+(INPUT|OUTPUT|FORWARD)\s+ACCEPT\b/,
    reason: "Refused: iptables -P ACCEPT (opens all traffic)",
  },
];

export default function (pi: HookAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const cmd = String(event.input.command ?? "");

    for (const rule of RULES) {
      if (rule.regex.test(cmd)) {
        return { block: true, reason: rule.reason };
      }
    }
  });
}
