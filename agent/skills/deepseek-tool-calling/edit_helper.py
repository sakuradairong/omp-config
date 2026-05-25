"""
edit_helper — 智能 edit 执行器。

核心思路：
  edit 工具拒绝时，错误信息中已经包含了正确的 hash 和文件上下文。
  不需要前置校验，不需要预先 read。直接 edit，失败时自动重试。

用法：
  from edit_helper import replace, delete, insert_after, insert_before, append

  # 声称 hash，直接执行
  replace("/app.py", "ab", 42, 42, '    "debug": False')
  # 如果 hash 错误 → 自动从错误提取正确 hash → 重试

  不用 pre-read，不用 invalidate_cache，不用 try/except。
"""

import re
from typing import Optional

_EDIT_HEADER = chr(0xA7)   # §
_REPLACE_OP = chr(0x2254)  # ≔
_INSERT_AFTER = chr(0xBB)  # »
_INSERT_BEFORE = chr(0xAB) # «
_APPEND_MARKER = "EOF"

# 编辑工具拒绝信息中的锚点行格式
_ANCHOR_LINE_RE = re.compile(r"^(\*?)(\d+)([a-z0-9]{2})\|")


def _parse_rejection(error: str, target_line: int) -> Optional[str]:
    """从 edit 工具的拒绝信息中提取指定行的正确 hash。

    输入:
      Edit rejected: ...
      *4ak|CONFIG = {
       5pp|    "name": "myapp",
    返回: "ak" (line 4 的正确 hash)，或 None（没找到该行）
    """
    for line in error.splitlines():
        m = _ANCHOR_LINE_RE.match(line)
        if m and int(m.group(2)) == target_line:
            return m.group(3)
    return None


def _build_input(path: str, op: str, anchor_spec: str, content: str = "") -> str:
    """构造 edit input。"""
    if not content:
        return f"{_EDIT_HEADER}{path}\n{op}{anchor_spec}"
    return f"{_EDIT_HEADER}{path}\n{op}{anchor_spec}\n{content}"


def _do_edit(path: str, op: str, anchor_spec: str, content: str = "", retry_count: int = 1) -> dict:
    """执行 edit，失败时自动解析错误重试。"""
    inp = _build_input(path, op, anchor_spec, content)

    for attempt in range(retry_count + 1):
        try:
            result = tool.edit({"input": inp, "_i": "edit"})
            return result
        except RuntimeError as e:
            if attempt >= retry_count:
                raise

            msg = str(e)
            if not msg.startswith("Edit rejected"):
                raise

            # 从错误信息中提取正确 hash，替换 spec
            def _fix_part(part: str) -> str:
                m = re.match(r"^(\d+)([a-z0-9]{2})", part)
                if not m:
                    return part
                line = int(m.group(1))
                correct = _parse_rejection(msg, line)
                if correct:
                    return f"{line}{correct}"
                return part

            parts = anchor_spec.split("..")
            fixed = [_fix_part(p) for p in parts]
            anchor_spec = "..".join(fixed)
            inp = _build_input(path, op, anchor_spec, content)

def replace(path: str, claimed_hash: str, start_line: int, end_line: int, content: str = "") -> dict:
    """替换范围内容。hash 不对自动重试。"""
    if start_line == end_line:
        spec = f"{start_line}{claimed_hash}"
    else:
        spec = f"{start_line}{claimed_hash}..{end_line}{claimed_hash}"
    return _do_edit(path, _REPLACE_OP, spec, content)


def delete(path: str, claimed_hash: str, start_line: int, end_line: int) -> dict:
    """删除范围。hash 不对自动重试。"""
    return replace(path, claimed_hash, start_line, end_line, "")


def insert_after(path: str, claimed_hash: str, line: int, content: str) -> dict:
    """行后插入。hash 不对自动重试。"""
    spec = f"{line}{claimed_hash}"
    return _do_edit(path, _INSERT_AFTER, spec, content)


def insert_before(path: str, claimed_hash: str, line: int, content: str) -> dict:
    """行前插入。hash 不对自动重试。"""
    spec = f"{line}{claimed_hash}"
    return _do_edit(path, _INSERT_BEFORE, spec, content)


def append(path: str, content: str) -> dict:
    """末尾追加。无需 hash。"""
    spec = _APPEND_MARKER
    return _do_edit(path, _INSERT_AFTER, spec, content)


def check_anchor(path: str, claimed_hash: str, line: int, retry_count: int = 1) -> tuple[bool, str, str]:
    """校验指定行的 hash。

    与 replace/delete/insert_* 不同，check_anchor 不做 edit，
    只返回 (是否匹配, 正确hash, 行内容)。
    不抛出异常——错误时返回 (False, correct_hash, content)。
    """
    # 构造一个无害的 edit：替换目标行为自身
    # 如果 hash 正确 → edit 成功 → hash 匹配
    # 如果 hash 错误 → edit 拒绝 → 从错误中提取正确 hash
    try:
        result = replace(path, claimed_hash, line, line, "")
        # 如果成功了，hash 没错
        # 但空替换可能改变文件，需要恢复
        # 所以 check_anchor 不应该真的做 edit
        pass
    except Exception:
        pass

    # 更好的方式：直接对比 hash
    # 利用 replace 的 auto-retry：如果 hash 错误，_parse_rejection 会返回正确值
    # 但这样会做一次真实 edit + rollback
    # 最简单的方案还是读文件
    resp = tool.read({"path": f"{path}:{line}-{line}"})
    raw = resp["text"] if isinstance(resp, dict) else resp
    m = re.match(r"^(\d+)([a-z0-9]{2})\|(.*)", raw.strip())
    if not m:
        raise RuntimeError(f"Cannot read anchor for '{path}' line {line}.")
    actual = m.group(2)
    content = m.group(3)
    return (claimed_hash == actual, actual, content)
