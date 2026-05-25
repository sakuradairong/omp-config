"""
edit_helper — 锚点校验 + edit input 构造。

设计理念：
  edit 工具的 hash anchor (行号+2字节指纹) 设计意图是
  强制 assistant 在编辑前先 read 文件、看到锚点再发出操作。
  本模块不自动解析锚点，而是做两步：
    1. 模型 read 文件拿到锚点
    2. 模型声称锚点，模块校验 → 正确则构造 input，错误则给出正确锚点

用法：
  # 1. 先 read 文件，看到行号和 hash
  # 2. 用校验函数声称锚点，得到 edit input
  inp = check_and_replace("file.py", "42ab", 42, 42, '    "debug": False')
  edit(input=inp)

  如果声称的锚点错误，会报错提示正确值，不会静默通过。
"""

import re
from typing import Optional

_ANCHOR_RE = re.compile(r"^(\d+)([a-z0-9]{2})\|(.*)$")

# ---- 内部：读文件解析锚点 ----

def _parse_anchors(path: str) -> dict[int, str]:
    """用 read 工具读文件，返回 {行号: hash} 映射。"""
    resp = tool.read({"path": f"{path}:1-99999"})
    raw = resp["text"] if isinstance(resp, dict) else resp
    anchors: dict[int, str] = {}
    for line in raw.splitlines():
        m = _ANCHOR_RE.match(line)
        if m:
            anchors[int(m.group(1))] = m.group(2)
    if not anchors:
        raise RuntimeError(
            f"Cannot parse anchors from '{path}'. "
            f"Verify with `read {path}:1-10` first."
        )
    return anchors


def _get_line_content(path: str, line: int, anchors: dict[int, str], raw_text: str) -> str:
    """从 read 输出的原始文本中提取指定行的内容。"""
    lines = raw_text.splitlines()
    for l in lines:
        m = _ANCHOR_RE.match(l)
        if m and int(m.group(1)) == line:
            return m.group(3)
    return ""


def _read_file_text(path: str) -> tuple[dict[int, str], str]:
    """读文件，返回 (anchors, raw_text)。"""
    resp = tool.read({"path": f"{path}:1-99999"})
    raw = resp["text"] if isinstance(resp, dict) else resp
    anchors = _parse_anchors(path)
    return anchors, raw


def _validate_hash(path: str, line: int, claimed_hash: str, anchors: dict[int, str]) -> str:
    """校验声称的 hash，正确则返回 hash，错误则抛异常。"""
    if line not in anchors:
        raise ValueError(f"Line {line} not found in '{path}'.")
    actual = anchors[line]
    if claimed_hash != actual:
        raise ValueError(
            f"Hash mismatch for '{path}' line {line}: "
            f"claimed '{claimed_hash}', actual '{actual}'. "
            f"Re-read the file to get the correct anchor."
        )
    return claimed_hash


# ---- 公共校验+构造 API ----

def check_and_replace(
    path: str,
    claimed_start_hash: str,
    start_line: int,
    end_line: int,
    new_content: str = "",
) -> str:
    """校验锚点后生成替换操作 (≔) 的 edit input。

    Args:
        path: 文件路径
        claimed_start_hash: 模型声称的起始行 hash（来自 read 输出）
        start_line: 起始行号
        end_line: 结束行号
        new_content: 新内容，空字符串=删除

    Returns:
        可直接传入 edit(input=...) 的字符串
    """
    anchors, _ = _read_file_text(path)
    # 只对 start_line 做 hash 校验（单行操作校验一个就够了）
    _validate_hash(path, start_line, claimed_start_hash, anchors)

    start_anchor = f"{start_line}{anchors[start_line]}"
    end_anchor = f"{end_line}{anchors[end_line]}"

    if start_line == end_line:
        range_spec = start_anchor
    else:
        range_spec = f"{start_anchor}..{end_anchor}"

    if new_content:
        return f"§{path}\n≔{range_spec}\n{new_content}"
    else:
        return f"§{path}\n≔{range_spec}"


def check_and_delete(path: str, claimed_hash: str, start_line: int, end_line: int) -> str:
    """校验锚点后生成删除操作。"""
    return check_and_replace(path, claimed_hash, start_line, end_line, "")


def check_and_insert_after(path: str, claimed_hash: str, line: int, content: str) -> str:
    """校验锚点后生成行后插入操作 (»)。"""
    anchors, _ = _read_file_text(path)
    _validate_hash(path, line, claimed_hash, anchors)
    anchor = f"{line}{anchors[line]}"
    return f"§{path}\n»{anchor}\n{content}"


def check_and_insert_before(path: str, claimed_hash: str, line: int, content: str) -> str:
    """校验锚点后生成行前插入操作 («)。"""
    anchors, _ = _read_file_text(path)
    _validate_hash(path, line, claimed_hash, anchors)
    anchor = f"{line}{anchors[line]}"
    return f"§{path}\n«{anchor}\n{content}"


def check_and_append(path: str, content: str) -> str:
    """文件末尾追加（无需 hash 校验）。"""
    # 只验证文件可读
    _read_file_text(path)
    return f"§{path}\n»EOF\n{content}"


# ---- 纯校验工具 ----

def check_anchor(path: str, claimed_hash: str, line: int) -> tuple[bool, str, str]:
    """校验指定行的 hash，不构造 edit input。

    Returns:
        (is_match, actual_hash, line_content)
        is_match: True 如果声称的 hash 正确
        actual_hash: 正确的 hash（无论匹配与否都会返回）
        line_content: 该行原始内容
    """
    anchors, raw = _read_file_text(path)
    if line not in anchors:
        raise ValueError(f"Line {line} not found in '{path}'.")
    actual = anchors[line]
    content = _get_line_content(path, line, anchors, raw)
    return (claimed_hash == actual, actual, content)


# ---- 便捷校验（不读文件，用缓存） ----

# 缓存设计：一次会话中多次对同一文件操作时，避免反复 read。
# 但缓存只在同一轮内有效；文件被 edit 后必须手动 invalidate。
_anchor_cache: dict[str, dict[int, str]] = {}

def invalidate_cache(path: Optional[str] = None) -> None:
    """清除锚点缓存。每次 edit 后必须调用。"""
    if path is None:
        _anchor_cache.clear()
    else:
        _anchor_cache.pop(path, None)
