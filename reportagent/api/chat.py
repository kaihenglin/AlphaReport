from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from reportagent.chat.agent import build_chat_agent
from reportagent.utils.config import get_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


class Conversation:
    def __init__(self, conversation_id: str):
        self.id = conversation_id
        self.title = ""
        self.messages: list[dict[str, str]] = []
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = self.created_at


_conversations: dict[str, Conversation] = {}


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(..., min_length=1)


def _sse(event_type: str, data: Any) -> str:
    payload = json.dumps({"type": event_type, **(data if isinstance(data, dict) else {"content": data})}, ensure_ascii=False)
    return f"data: {payload}\n\n"


async def _stream_response(conversation_id: str, user_message: str):
    conv = _conversations.get(conversation_id)
    if not conv:
        conv = Conversation(conversation_id)
        _conversations[conversation_id] = conv

    if not conv.title:
        conv.title = user_message[:50]

    conv.messages.append({"role": "user", "content": user_message})
    conv.updated_at = datetime.now(timezone.utc).isoformat()

    lc_messages = []
    max_hist = get_config("chat", "max_history_messages", default=50)
    recent = conv.messages[-max_hist:]
    for m in recent:
        if m["role"] == "user":
            lc_messages.append(HumanMessage(content=m["content"]))
        elif m["role"] == "assistant":
            lc_messages.append(AIMessage(content=m["content"]))

    try:
        yield _sse("status", {"content": "thinking"})

        agent = build_chat_agent()
        full_response = ""

        async for event in agent.astream_events(
            {"messages": lc_messages},
            version="v2",
        ):
            kind = event.get("event", "")
            data = event.get("data", {})

            if kind == "on_chat_model_stream":
                chunk = data.get("chunk")
                if chunk and hasattr(chunk, "content") and chunk.content:
                    content = chunk.content
                    if isinstance(content, str) and content:
                        full_response += content
                        yield _sse("token", content)
                if chunk and hasattr(chunk, "additional_kwargs"):
                    reasoning = chunk.additional_kwargs.get("reasoning_content", "")
                    if reasoning:
                        yield _sse("thinking", reasoning)

            elif kind == "on_tool_start":
                tool_name = event.get("name", "")
                tool_input = data.get("input", {})
                yield _sse("tool_call", {
                    "name": tool_name,
                    "args": tool_input if isinstance(tool_input, dict) else {"input": str(tool_input)},
                })

            elif kind == "on_tool_end":
                tool_name = event.get("name", "")
                output = data.get("output", "")
                output_str = str(output.content) if hasattr(output, "content") else str(output)
                yield _sse("tool_result", {
                    "name": tool_name,
                    "result": output_str[:2000],
                })

        if full_response:
            conv.messages.append({"role": "assistant", "content": full_response})

        yield _sse("done", {"conversation_id": conversation_id})

    except Exception as e:
        logger.exception("Chat stream error")
        yield _sse("error", str(e))


@router.post("/stream")
async def chat_stream(req: ChatRequest):
    conversation_id = req.conversation_id or str(uuid.uuid4())
    return StreamingResponse(
        _stream_response(conversation_id, req.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/conversations")
async def list_conversations():
    items = sorted(
        _conversations.values(),
        key=lambda c: c.updated_at,
        reverse=True,
    )
    return {
        "success": True,
        "data": {
            "conversations": [
                {
                    "id": c.id,
                    "title": c.title,
                    "message_count": len(c.messages),
                    "created_at": c.created_at,
                    "updated_at": c.updated_at,
                }
                for c in items[:50]
            ]
        },
    }


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    conv = _conversations.get(conversation_id)
    if not conv:
        return {"success": False, "error": "Conversation not found"}
    return {
        "success": True,
        "data": {
            "id": conv.id,
            "title": conv.title,
            "messages": conv.messages,
            "created_at": conv.created_at,
            "updated_at": conv.updated_at,
        },
    }


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    if conversation_id in _conversations:
        del _conversations[conversation_id]
        return {"success": True, "message": "Conversation deleted"}
    return {"success": False, "error": "Conversation not found"}
