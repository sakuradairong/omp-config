---
name: astrbot-plugin-development
description: Use when developing, debugging, or fixing AstrBot plugins and encountering import errors, async generator issues, plugin loading failures, or configuration problems
---

# AstrBot Plugin Development

## Overview

Reference for common pitfalls, patterns, and conventions when developing AstrBot plugins. For official API docs, see https://docs.astrbot.app/dev/star/plugin-new.html.

## Project Structure

```
astrbot_plugin_<name>/
├── main.py              # Required entry point
├── metadata.yaml         # Required metadata. Include `repo` field for update support.
├── _conf_schema.json     # Optional config schema
├── requirements.txt      # pip deps (use aiohttp, never requests)
├── logo.png             # Optional, 256x256
├── skills/              # Optional bundled skills
└── pages/               # Optional dashboard pages
```

## Critical Pitfalls

### 1. `star` decorator — v4 only

**Error:** `cannot import name 'star' from 'astrbot.api.star'`

```python
# ❌ Breaks on v3
from astrbot.api.star import Context, Star, star
@star
class MyPlugin(Star): ...

# ✅ Works on v3 and v4
from astrbot.api.star import Context, Star
class MyPlugin(Star): ...
```

### 2. Async generator delegation

**Error:** `object async_generator can't be used in 'await' expression`

```python
# ❌ A handler with yield is an async generator — can't await it
yield await self._handler(event, ...)

# ✅ Use async for delegation
async for result in self._handler(event, ...):
    yield result
```

### 3. Missing `repo` in metadata.yaml

**Error:** "没有指定仓库地址" — plugin cannot auto-update.

**Fix:** Add `repo: https://github.com/user/astrbot_plugin_xxx`

### 4. Never use `requests`

Always use `aiohttp` or `httpx` for HTTP. Synchronous `requests` blocks the event loop.

## Configuration

```python
from astrbot.api import AstrBotConfig

class MyPlugin(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.config = config
        token = config.get("key", "default")
```

## Message Handling Quick Reference

```python
# Filters
@filter.event_message_type(filter.EventMessageType.ALL)        # All messages
@filter.event_message_type(filter.EventMessageType.GROUP_MESSAGE)  # Group only
@filter.platform_adapter_type(filter.PlatformAdapterType.AIOCQHTTP)  # Specific platform
@filter.permission_type(filter.PermissionType.ADMIN)               # Admin only

# Commands
@filter.command("hello")
@filter.command("hello", alias={"hi", "hey"})              # Aliases
@filter.command("add")                                     # /add 1 2 → parsed args
async def add(self, event: AstrMessageEvent, a: int, b: int): ...

@filter.command_group("math")                              # /math add 1 2
def math(): pass
@math.command("add")
async def add(self, event, a: int, b: int): ...

# Sending
yield event.plain_result("text")
yield event.image_result("https://example.com/img.jpg")
event.stop_event()  # Stop propagation, skip LLM

# Active push (outside handlers)
await self.context.send_message(unified_msg_origin, message_chain)

# Event hooks (use event.send(), NOT yield)
@filter.on_llm_request()    # Before LLM: modify req
@filter.on_llm_response()   # After LLM: inspect resp
@filter.on_decorating_result()  # Before sending to platform
```

## Calling LLM

```python
prov_id = await self.context.get_current_chat_provider_id(event.unified_msg_origin)
resp = await self.context.llm_generate(chat_provider_id=prov_id, prompt="Hello")

# Agent with tool loop
resp = await self.context.tool_loop_agent(
    event=event, chat_provider_id=prov_id,
    prompt="Search for X", tools=ToolSet([MyTool()]), max_steps=30,
)

# Register tool globally
self.context.add_llm_tools(MyTool())
```

## Storage

```python
await self.put_kv_data("key", value)
data = await self.get_kv_data("key", default)

# File storage: always use data/plugin_data/<plugin_name>/
from pathlib import Path
from astrbot.core.utils.astrbot_path import get_astrbot_data_path
path = Path(get_astrbot_data_path()) / "plugin_data" / self.name
```

## Debugging

- Plugins auto-load from `data/plugins/<name>/`
- WebUI → Plugins → `...` → "重载插件" for hot reload
- Use `from astrbot.api import logger` (not `print`)
