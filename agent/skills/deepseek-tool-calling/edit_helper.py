"""
edit_helper — Smart anchor resolution for the `edit` tool.

DeepSeek 调用 `edit` 工具时最大的问题：hash anchor 是随机 2 字节指纹，
LLM 无法可靠复现。这个模块帮你自动解析正确的 hash anchor。

用法（在 eval 中）：
    exec(tool.read({"path": "skill://deepseek-tool-calling/edit_helper.py"})["text"])

    # 使用文件系统路径（不能用 skill:// URI，否则拿不到锚点信息）
    result = edit_replace("/path/to/src/main.py", 10, 15, "def new_func():\\n    pass")
    # result 可直接传入 edit 工具: edit(input=result)

不会产生幻觉，因为 anchors 是通过 read 工具实时读取的。
"""

import re
from typing import Optional

# 缓存最近的锚点解析结果，避免反复 read
_anchor_cache: dict[str, dict[int, str]] = {}
_cache_path: Optional[str] = None

# 行锚点正则：`LINE_NR + 2CHAR_HASH + | + CONTENT`
_ANCHOR_RE = re.compile(r"^(\d+)([a-z0-9]{2})\|(.*)$")


def _refresh_anchors(path: str) -> dict[int, str]:
    """使用 read 工具读取文件，解析所有行号→hash 映射。"""
    resp = tool.read({"path": f"{path}:1-99999"})
    raw = resp["text"] if isinstance(resp, dict) else resp
    anchors: dict[int, str] = {}
    for line in raw.splitlines():
        m = _ANCHOR_RE.match(line)
        if m:
            line_no = int(m.group(1))
            hash_val = m.group(2)
            anchors[line_no] = hash_val
    if not anchors:
        raise RuntimeError(
            f"Cannot parse anchors from '{path}'. "
            f"The file may not exist or read returned unparseable output. "
            f"Verify with `read {path}` first."
        )
    global _cache_path
    _cache_path = path
    _anchor_cache[path] = anchors
    return anchors


def _get_anchor(path: str, line: int) -> str:
    """获取指定行的完整 anchor（行号+hash），带缓存。"""
    if path not in _anchor_cache:
        _refresh_anchors(path)
    anchors = _anchor_cache[path]
    if line not in anchors:
        raise ValueError(
            f"Line {line} not found in '{path}'. "
            f"Available lines: {min(anchors)}-{max(anchors)}"
        )
    return f"{line}{anchors[line]}"


def _build_input(path: str, content: str) -> str:
    """构造 edit 工具的 input 字符串。"""
    return f"§{path}\n{content}"


def edit_replace(path: str, start_line: int, end_line: Optional[int] = None, new_content: str = "") -> str:
    """替换 start_line..end_line（含）范围的内容。

    Args:
        path: 文件路径
        start_line: 起始行号
        end_line: 结束行号（默认等于 start_line，即单行替换）
        new_content: 新内容（空字符串 = 删除该范围）
    Returns:
        可直接传入 edit 工具 input 字段的字符串
    """
    if end_line is None:
        end_line = start_line

    start_anchor = _get_anchor(path, start_line)
    end_anchor = _get_anchor(path, end_line)

    if start_line == end_line:
        range_spec = start_anchor
    else:
        range_spec = f"{start_anchor}..{end_anchor}"

    if new_content:
        return _build_input(path, f"≔{range_spec}\n{new_content}")
    else:
        # 删除 = ≔A..B 不带 payload
        return _build_input(path, f"≔{range_spec}")

def edit_delete(path: str, start_line: int, end_line: Optional[int] = None) -> str:
    """删除 start_line..end_line 范围。

    等价于 edit_replace(..., new_content="")
    """
    return edit_replace(path, start_line, end_line, "")


def edit_insert_after(path: str, line: int, content: str) -> str:
    """在指定行之后插入内容。

    Args:
        path: 文件路径
        line: 目标行号（传 0 则在文件开头插入）
        content: 要插入的内容
    Returns:
        可直接传入 edit 工具 input 字段的字符串
    """
    if line == 0:
        return _build_input(path, f"«BOF\n{content}")
    anchor = _get_anchor(path, line)
    return _build_input(path, f"»{anchor}\n{content}")


def edit_insert_before(path: str, line: int, content: str) -> str:
    """在指定行之前插入内容。"""
    anchor = _get_anchor(path, line)
    return _build_input(path, f"«{anchor}\n{content}")


def edit_append(path: str, content: str) -> str:
    """在文件末尾追加内容（无锚点检查）。"""
    # 先验证文件可读
    _refresh_anchors(path)
    return _build_input(path, f"»EOF\n{content}")


def invalidate_cache(path: Optional[str] = None) -> None:
    """清除锚点缓存。文件被修改后必须调用。"""
    if path is None:
        _anchor_cache.clear()
        global _cache_path
        _cache_path = None
    else:
        _anchor_cache.pop(path, None)
        if _cache_path == path:
            _cache_path = None
