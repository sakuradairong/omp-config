"""
edit_helper — 结构化 edit 执行器。

设计理念：
  hash 错误的真正原因通常是"模型没读文件"，而不是"hash 抄错了"。
  因此本模块不自动修正 hash，而是把拒绝原因、正确 hash、文件实际内容
  结构化地返回给模型，让模型看到真实状态后自己决定。

用法：
  result = try_replace("/app.py", "xx", 42, 42, '    "debug": False')
  if result["status"] == "ok":
      pass  # edit 成功
  elif result["status"] == "rejected":
      # result.correct_hash → 正确的 hash
      # result.actual_content → 该行实际内容
      # result.file_context → 当前文件上下文
      # 模型 re-read 后决定重试或调整
  elif result["status"] == "error":
      # result.message → 错误描述

  不会静默修正任何东西。模型总是看到执行结果。
"""

import re
from typing import Optional

_EDIT_HEADER = chr(0xA7)    # §
_REPLACE_OP = chr(0x2254)   # ≔
_INSERT_AFTER = chr(0xBB)   # »
_INSERT_BEFORE = chr(0xAB)  # «
_APPEND_MARKER = "EOF"

_ANCHOR_LINE_RE = re.compile(r"^(\*?)(\d+)([a-z0-9]{2})\|")


def _build_input(path: str, op: str, anchor_spec: str, content: str = "") -> str:
    if not content:
        return f"{_EDIT_HEADER}{path}\n{op}{anchor_spec}"
    return f"{_EDIT_HEADER}{path}\n{op}{anchor_spec}\n{content}"


def _parse_rejection(error: str, target_line: int) -> Optional[dict]:
    """解析 edit 拒绝信息。

    输入: edit 工具的错误文本
    返回: {
        "correct_hash": "ab",
        "actual_content": '    "debug": True',
        "line": 42
    } 或 None（该行不在错误信息中）
    """
    for line in error.splitlines():
        m = _ANCHOR_LINE_RE.match(line)
        if m and int(m.group(2)) == target_line:
            is_marked = m.group(1) == "*"
            hash_val = m.group(3)
            # 提取 | 之后的内容
            pipe_idx = line.index("|")
            content = line[pipe_idx + 1:] if pipe_idx >= 0 else ""
            return {
                "correct_hash": hash_val,
                "actual_content": content,
                "line": target_line,
                "was_mismatch": is_marked,
            }
    return None


def _extract_context(error: str) -> str:
    """从拒绝信息中提取文件上下文（锚点行）。"""
    lines = []
    started = False
    for line in error.splitlines():
        if line.startswith("Edit rejected") or line.startswith("The edit was"):
            started = True
            continue
        if started and _ANCHOR_LINE_RE.match(line):
            lines.append(line)
    return "\n".join(lines) if lines else ""


def _do_try(path: str, op: str, anchor_spec: str, content: str = "") -> dict:
    """执行 edit，从不抛出异常。总是返回结构化 dict。"""
    inp = _build_input(path, op, anchor_spec, content)

    try:
        result = tool.edit({"input": inp, "_i": "edit"})
        return {
            "status": "ok",
            "details": result.get("details", result) if isinstance(result, dict) else result,
        }
    except RuntimeError as e:
        msg = str(e)

        # 提取涉及的行号
        first_line_match = re.match(r"^(\d+)", anchor_spec.split("..")[0])
        target_line = int(first_line_match.group(1)) if first_line_match else None

        # 解析拒绝信息
        rejection = _parse_rejection(msg, target_line) if target_line else None
        context = _extract_context(msg)

        return {
            "status": "rejected",
            "message": msg,
            "target_line": target_line,
            "correct_hash": rejection["correct_hash"] if rejection else None,
            "actual_content": rejection["actual_content"] if rejection else None,
            "was_mismatch": rejection["was_mismatch"] if rejection else False,
            "file_context": context,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }


# ---- 公共 API ----

def try_replace(path: str, claimed_hash: str, start_line: int, end_line: int, content: str = "") -> dict:
    """尝试替换范围内容。返回结构化结果。"""
    if start_line == end_line:
        spec = f"{start_line}{claimed_hash}"
    else:
        spec = f"{start_line}{claimed_hash}..{end_line}{claimed_hash}"
    return _do_try(path, _REPLACE_OP, spec, content)


def try_delete(path: str, claimed_hash: str, start_line: int, end_line: int) -> dict:
    """尝试删除范围。返回结构化结果。"""
    return try_replace(path, claimed_hash, start_line, end_line, "")


def try_insert_after(path: str, claimed_hash: str, line: int, content: str) -> dict:
    """尝试行后插入。返回结构化结果。"""
    spec = f"{line}{claimed_hash}"
    return _do_try(path, _INSERT_AFTER, spec, content)


def try_insert_before(path: str, claimed_hash: str, line: int, content: str) -> dict:
    """尝试行前插入。返回结构化结果。"""
    spec = f"{line}{claimed_hash}"
    return _do_try(path, _INSERT_BEFORE, spec, content)


def try_append(path: str, content: str) -> dict:
    """尝试末尾追加。无需 hash。"""
    return _do_try(path, _INSERT_AFTER, _APPEND_MARKER, content)


def check_anchor(path: str, claimed_hash: str, line: int) -> tuple:
    """校验 hash，返回 (是否匹配, 正确hash, 行内容)。"""
    resp = tool.read({"path": f"{path}:{line}-{line}"})
    raw = resp["text"] if isinstance(resp, dict) else resp
    for l in raw.splitlines():
        m = re.match(r"^(\d+)([a-z0-9]{2})\|(.*)", l)
        if m and int(m.group(1)) == line:
            actual = m.group(2)
            content = m.group(3)
            return (claimed_hash == actual, actual, content)
    raise RuntimeError(f"Cannot find anchor for '{path}' line {line} in read output.")
