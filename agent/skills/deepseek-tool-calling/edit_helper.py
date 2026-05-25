"""
edit_helper — 强制先 read 再 edit。

核心设计：
  编辑必须先 read。hash 从 read 输出中机械提取，模型不接触随机字符。
  没有 read 输出 → edit_line/edit_range 直接报错。
  伪造 read 输出 → edit 工具乐观锁拒绝。

用法：
  # 1. READ（必须，可见的 tool call）
  lines = tool.read({"path": "/app.py:42-42"})
  # 2. EDIT（hash 从 lines 提取）
  r = edit_line(lines, "/app.py", 42, '    "debug": False')
  if r["status"] == "ok":
      pass
  elif r["status"] == "rejected":
      print(f"正确 hash={r['correct_hash']}, 内容={r['actual_content']}")
"""

import re

_EDIT_HEADER = chr(0xA7)    # §
_REPLACE_OP = chr(0x2254)   # ≔
_INSERT_AFTER = chr(0xBB)   # »
_INSERT_BEFORE = chr(0xAB)  # «
_APPEND_MARKER = "EOF"

_ANCHOR_LINE_RE = re.compile(r"^(\*?)(\d+)([a-z0-9]{2})\|")
_ANCHOR_RE = re.compile(r"^(\d+)([a-z0-9]{2})\|(.*)")


# ---- 内部辅助 ----

def _build_input(path: str, op: str, anchor_spec: str, content: str = "") -> str:
    if not content:
        return f"{_EDIT_HEADER}{path}\n{op}{anchor_spec}"
    return f"{_EDIT_HEADER}{path}\n{op}{anchor_spec}\n{content}"


def _extract_hash(read_output, line: int) -> str:
    """从 read 输出中提取指定行的 hash。"""
    if isinstance(read_output, dict):
        read_output = read_output.get("text", "")
    for l in read_output.splitlines():
        m = _ANCHOR_RE.match(l)
        if m and int(m.group(1)) == line:
            return m.group(2)
    raise ValueError(f"Line {line} not found in read output. Read the file with: read path:{line}-{line}")


def _parse_rejection(error: str, target_line: int = None) -> tuple:
    """解析 edit 拒绝信息。

    Returns:
        (target_info, all_mismatches)
        target_info: 目标行的信息 dict，或 None
        all_mismatches: 所有 * 标记行的 [{line, correct_hash, actual_content}]
    """
    target_info = None
    all_mismatches = []

    for line in error.splitlines():
        m = _ANCHOR_LINE_RE.match(line)
        if not m:
            continue
        ln = int(m.group(2))
        h = m.group(3)
        pipe_idx = line.index("|")
        content = line[pipe_idx + 1:] if pipe_idx >= 0 else ""
        is_marked = m.group(1) == "*"

        if is_marked:
            all_mismatches.append({"line": ln, "correct_hash": h, "actual_content": content})

        if target_line is not None and ln == target_line:
            target_info = {
                "correct_hash": h,
                "actual_content": content,
                "line": ln,
                "was_mismatch": is_marked,
            }

    return target_info, all_mismatches


def _extract_context(error: str) -> str:
    """提取拒绝信息中的文件上下文行。"""
    lines = []
    started = False
    for line in error.splitlines():
        if line.startswith("Edit rejected") or line.startswith("The edit was"):
            started = True
            continue
        if started and _ANCHOR_LINE_RE.match(line):
            lines.append(line)
    return "\n".join(lines)


def _do_edit(path: str, op: str, anchor_spec: str, content: str = "") -> dict:
    """执行 edit。不抛异常，返回结构化 dict。"""
    try:
        result = tool.edit({"input": _build_input(path, op, anchor_spec, content), "_i": "edit"})
        return {"status": "ok", "details": result.get("details", result) if isinstance(result, dict) else result}
    except RuntimeError as e:
        msg = str(e)
        if not msg.startswith("Edit rejected"):
            return {"status": "error", "message": msg}
        m = re.match(r"^(\d+)", anchor_spec.split("..")[0])
        target = int(m.group(1)) if m else None
        target_info, mismatches = _parse_rejection(msg, target)
        return {
            "status": "rejected",
            "message": msg,
            "target_line": target,
            "correct_hash": target_info["correct_hash"] if target_info else None,
            "actual_content": target_info["actual_content"] if target_info else None,
            "was_mismatch": target_info["was_mismatch"] if target_info else False,
            "mismatches": mismatches,
            "file_context": _extract_context(msg),
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def edit_line(read_output, path: str, line: int, content: str) -> dict:
    """替换单行。hash 从 read_output 提取。必须先 read。"""
    h = _extract_hash(read_output, line)
    return _do_edit(path, _REPLACE_OP, f"{line}{h}", content)


def edit_range(read_output, path: str, start_line: int, end_line: int, content: str) -> dict:
    """替换范围。hash 从 read_output 提取。必须先 read。"""
    sh = _extract_hash(read_output, start_line)
    eh = _extract_hash(read_output, end_line)
    return _do_edit(path, _REPLACE_OP, f"{start_line}{sh}..{end_line}{eh}", content)


def delete_line(read_output, path: str, line: int) -> dict:
    """删除单行。hash 从 read_output 提取。"""
    return edit_line(read_output, path, line, "")


def delete_range(read_output, path: str, start_line: int, end_line: int) -> dict:
    """删除范围。hash 从 read_output 提取。"""
    return edit_range(read_output, path, start_line, end_line, "")


def insert_after(read_output, path: str, line: int, content: str) -> dict:
    """行后插入。hash 从 read_output 提取。必须先 read。"""
    h = _extract_hash(read_output, line)
    return _do_edit(path, _INSERT_AFTER, f"{line}{h}", content)


def insert_before(read_output, path: str, line: int, content: str) -> dict:
    """行前插入。hash 从 read_output 提取。必须先 read。"""
    h = _extract_hash(read_output, line)
    return _do_edit(path, _INSERT_BEFORE, f"{line}{h}", content)


# ---- 不需 hash 的操作 ----

def append(path: str, content: str) -> dict:
    """末尾追加。无需 read。"""
    return _do_edit(path, _INSERT_AFTER, _APPEND_MARKER, content)


# ---- 诊断工具 ----

def check_anchor(path: str, claimed_hash: str, line: int) -> tuple:
    """校验行 hash。返回 (匹配, 正确hash, 行内容)。"""
    resp = tool.read({"path": f"{path}:{line}-{line}"})
    raw = resp["text"] if isinstance(resp, dict) else resp
    for l in raw.splitlines():
        m = _ANCHOR_RE.match(l)
        if m and int(m.group(1)) == line:
            return (claimed_hash == m.group(2), m.group(2), m.group(3))
    raise RuntimeError(f"Cannot find line {line} in read output.")
