from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from reportagent.utils.config import PROJECT_ROOT, get_config

logger = logging.getLogger(__name__)


def _skills_dir() -> Path:
    rel = get_config("chat", "skills_dir", default="configs/skills")
    return PROJECT_ROOT / rel


def _user_skills_dir() -> Path:
    rel = get_config("chat", "user_skills_dir", default="data/user_skills")
    p = PROJECT_ROOT / rel
    p.mkdir(parents=True, exist_ok=True)
    return p


def _load_yaml(path: Path) -> dict[str, Any] | None:
    try:
        with open(path) as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        logger.warning("Failed to load skill %s: %s", path, e)
        return None


def load_all_skills() -> list[dict[str, Any]]:
    skills: list[dict[str, Any]] = []
    for d, source in [(_skills_dir(), "builtin"), (_user_skills_dir(), "user")]:
        if not d.exists():
            continue
        for p in sorted(d.glob("*.yaml")):
            data = _load_yaml(p)
            if data and "name" in data:
                data["_source"] = source
                data["_file"] = p.stem
                skills.append(data)
    return skills


def get_skill(name: str) -> dict[str, Any] | None:
    for skill in load_all_skills():
        if skill["name"] == name:
            return skill
    return None


def save_user_skill(
    name: str,
    description: str,
    prompt_template: str,
    default_params: dict[str, Any] | None = None,
) -> str:
    slug = name.replace(" ", "_").replace("/", "_")
    path = _user_skills_dir() / f"{slug}.yaml"
    data = {
        "name": name,
        "description": description,
        "prompt_template": prompt_template,
    }
    if default_params:
        data["default_params"] = default_params
    with open(path, "w") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
    return str(path)


def delete_user_skill(name: str) -> bool:
    for p in _user_skills_dir().glob("*.yaml"):
        data = _load_yaml(p)
        if data and data.get("name") == name:
            p.unlink()
            return True
    return False


def format_skills_context(skills: list[dict[str, Any]]) -> str:
    if not skills:
        return ""
    lines = ["\n## 可用 Skills（用户可通过名称调用）"]
    for s in skills:
        source_tag = "内置" if s.get("_source") == "builtin" else "自定义"
        lines.append(f"- **{s['name']}** [{source_tag}]: {s.get('description', '')}")
        if s.get("prompt_template"):
            lines.append(f"  模板: {s['prompt_template'].strip()[:120]}...")
    return "\n".join(lines)
