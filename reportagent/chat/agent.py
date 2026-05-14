from __future__ import annotations

import logging
from pathlib import Path
from typing import AsyncGenerator

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from reportagent.chat.skills import load_all_skills, format_skills_context
from reportagent.chat.tools import ALL_TOOLS
from reportagent.utils.config import (
    PROJECT_ROOT,
    get_config,
    get_llm_api_key,
    get_llm_base_url,
    get_llm_model,
)

logger = logging.getLogger(__name__)


def _load_system_prompt() -> str:
    rel = get_config("chat", "system_prompt_path", default="configs/prompts/chat_system.txt")
    path = PROJECT_ROOT / rel
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return "你是 ResearchAgent 智能助手，专注于量化金融研报的收集和分析。"


def _build_llm() -> ChatOpenAI:
    kwargs = {
        "model": get_llm_model(),
        "api_key": get_llm_api_key(),
        "streaming": True,
        "temperature": 0.3,
        "max_tokens": 4000,
    }
    base_url = get_llm_base_url()
    if base_url:
        kwargs["base_url"] = base_url
    return ChatOpenAI(**kwargs)


def build_chat_agent():
    llm = _build_llm()
    skills = load_all_skills()
    skills_ctx = format_skills_context(skills)
    system_prompt = _load_system_prompt() + skills_ctx

    return create_react_agent(
        llm,
        ALL_TOOLS,
        prompt=system_prompt,
    )
