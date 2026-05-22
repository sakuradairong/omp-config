// Safety guard: block destructive commands before bash runs.
// Catches rm -rf /, dd if=/dev/zero, mkfs, and similar catastrophic patterns.
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const PATTERNS: { regex: RegExp; reason: string }[] = [
  // rm -rf /
  { regex: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(\/|~\/?(\s|$)|\$HOME|\$HOMEDIR)/, reason: "Refused: destructive rm" },
  // dd if=/dev/zero or /dev/urandom to a block device
  { regex: /\bdd\s+if=\/dev\/(zero|urandom)\s+of=\/(dev|mnt|run)/, reason: "Refused: dd to block device" },
  // mkfs / mkswap on a device
  { regex: /\bmkfs\b/i, reason: "Refused: mkfs" },
  // chmod -R 000 or 777 on root
  { regex: /\bchmod\s+-R\s+0{3,4}\s+\//, reason: "Refused: chmod -R 000 on /" },
  // wget/curl pipe to bash as root
  { regex: /\b(curl|wget)\b.*\|.*\b(bash|sh)\s*$/, reason: "Refused: pipe-from-web to shell" },
];

export default function (pi: HookAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const cmd = String(event.input.command ?? "");
    for (const p of PATTERNS) {
      if (p.regex.test(cmd)) {
        return { block: true, reason: p.reason };
      }
    }
  });
}
