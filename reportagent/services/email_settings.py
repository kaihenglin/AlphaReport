"""Per-email subscription persistence — unified schedule + research directions."""

from __future__ import annotations

import json as _json
import hashlib
import threading
from datetime import datetime, timezone
from pathlib import Path

SUBSCRIPTIONS_PATH = (
    Path(__file__).resolve().parent.parent.parent / "data" / "subscriptions.json"
)
OLD_SETTINGS_PATH = (
    Path(__file__).resolve().parent.parent.parent / "data" / "email_settings.json"
)
OLD_PREFS_PATH = (
    Path(__file__).resolve().parent.parent.parent / "data" / "user_report_prefs.json"
)

_lock = threading.Lock()
_migrated = False


def _default_state() -> dict:
    return {"subscriptions": {}, "_version": 3}


def _default_user_id(email: str) -> str:
    """Stable fallback user id for deployments that have not wired auth yet."""
    email = email.strip().lower()
    digest = hashlib.sha256(email.encode("utf-8")).hexdigest()[:16]
    return f"email:{digest}"


def _load() -> dict:
    SUBSCRIPTIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SUBSCRIPTIONS_PATH.exists():
        data = _json.loads(SUBSCRIPTIONS_PATH.read_text(encoding="utf-8"))
        changed = False
        for email, sub in data.get("subscriptions", {}).items():
            if "user_id" not in sub:
                sub["user_id"] = _default_user_id(sub.get("email") or email)
                changed = True
        if data.get("_version", 0) < 3:
            data["_version"] = 3
            changed = True
        if changed:
            _save(data)
        return data
    return _default_state()


def _save(data: dict) -> None:
    SUBSCRIPTIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUBSCRIPTIONS_PATH.write_text(
        _json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _migrate_if_needed() -> bool:
    """Migrate old flat files to unified subscriptions format. Returns True if migrated."""
    global _migrated
    if _migrated:
        return False
    _migrated = True

    if SUBSCRIPTIONS_PATH.exists():
        return False

    old_settings = None
    old_prefs = None

    if OLD_SETTINGS_PATH.exists():
        try:
            old_settings = _json.loads(OLD_SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass

    if OLD_PREFS_PATH.exists():
        try:
            old_prefs = _json.loads(OLD_PREFS_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass

    if not old_settings and not old_prefs:
        return False

    recipients = old_settings.get("recipients", []) if old_settings else []
    schedule_enabled = old_settings.get("schedule_enabled", False) if old_settings else False
    schedule_time = old_settings.get("schedule_time", "08:00") if old_settings else "08:00"
    schedule_weekdays = old_settings.get("schedule_weekdays", "mon-fri") if old_settings else "mon-fri"

    # old_prefs is keyed by direction name: {"A股多因子": {topics, keywords, ...}}
    directions = {}
    if old_prefs:
        for name, d in old_prefs.items():
            if isinstance(d, dict):
                directions[name] = {
                    "topics": d.get("topics", []),
                    "keywords": d.get("keywords", []),
                    "asset_classes": d.get("asset_classes", []),
                    "markets": d.get("markets", ["china"]),
                    "updated_at": d.get("updated_at", datetime.now(timezone.utc).isoformat()),
                }

    now = datetime.now(timezone.utc).isoformat()
    subscriptions = {}
    for email in recipients:
        email = email.strip().lower()
        subscriptions[email] = {
            "user_id": _default_user_id(email),
            "email": email,
            "schedule_enabled": schedule_enabled,
            "schedule_time": schedule_time,
            "schedule_weekdays": schedule_weekdays,
            "directions": {
                k: dict(v) for k, v in directions.items()
            } if directions else {},
            "created_at": now,
            "updated_at": now,
        }

    data = {"subscriptions": subscriptions, "_version": 2}
    _save(data)
    print(f"[email_settings] Migrated {len(subscriptions)} subscriptions from legacy files")
    return True


# ── Subscription CRUD ──


def get_all_subscriptions() -> dict[str, dict]:
    """Return {email: sub_obj} for all subscriptions."""
    _migrate_if_needed()
    with _lock:
        return dict(_load().get("subscriptions", {}))


def get_subscriptions_by_user_id(user_id: str) -> dict[str, dict]:
    """Return {email: sub_obj} for all subscriptions belonging to user_id."""
    if not user_id:
        return {}
    all_subs = get_all_subscriptions()
    return {
        email: sub
        for email, sub in all_subs.items()
        if sub.get("user_id") == user_id
    }


def get_subscription(email: str) -> dict | None:
    """Return single subscription or None."""
    _migrate_if_needed()
    email = email.strip().lower()
    with _lock:
        return _load().get("subscriptions", {}).get(email)


def get_subscription_by_user_id(user_id: str) -> dict | None:
    """Return the first subscription for an authenticated user id."""
    _migrate_if_needed()
    user_id = user_id.strip()
    if not user_id:
        return None
    with _lock:
        for sub in _load().get("subscriptions", {}).values():
            if sub.get("user_id") == user_id:
                return dict(sub)
    return None


def create_subscription(
    email: str,
    schedule_time: str = "08:00",
    schedule_weekdays: str = "mon-fri",
    schedule_enabled: bool = True,
    user_id: str | None = None,
) -> dict:
    """Create a new subscription. Raises ValueError if email already exists."""
    _migrate_if_needed()
    email = email.strip().lower()
    if not email or "@" not in email:
        raise ValueError("Invalid email address")

    with _lock:
        data = _load()
        if email in data.get("subscriptions", {}):
            raise ValueError(f"Subscription for {email} already exists")

        now = datetime.now(timezone.utc).isoformat()
        sub = {
            "user_id": user_id.strip() if user_id else _default_user_id(email),
            "email": email,
            "schedule_enabled": schedule_enabled,
            "schedule_time": schedule_time,
            "schedule_weekdays": schedule_weekdays,
            "directions": {},
            "created_at": now,
            "updated_at": now,
        }
        data.setdefault("subscriptions", {})[email] = sub
        _save(data)
        return dict(sub)


def delete_subscription(email: str) -> bool:
    """Remove a subscription entirely. Returns True if it existed."""
    _migrate_if_needed()
    email = email.strip().lower()
    with _lock:
        data = _load()
        if email not in data.get("subscriptions", {}):
            return False
        del data["subscriptions"][email]
        _save(data)
        return True


def update_subscription_schedule(
    email: str,
    *,
    enabled: bool | None = None,
    time_str: str | None = None,
    weekdays: str | None = None,
) -> dict:
    """Partial update of schedule fields. Returns updated subscription."""
    _migrate_if_needed()
    email = email.strip().lower()
    with _lock:
        data = _load()
        sub = data.get("subscriptions", {}).get(email)
        if not sub:
            raise ValueError(f"Subscription not found: {email}")

        if enabled is not None:
            sub["schedule_enabled"] = enabled
        if time_str is not None:
            sub["schedule_time"] = time_str
        if weekdays is not None:
            sub["schedule_weekdays"] = weekdays
        sub["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save(data)
        return dict(sub)


# ── Directions (scoped to a subscription) ──


def get_directions(email: str) -> dict:
    """Return all directions for a subscription."""
    sub = get_subscription(email)
    if not sub:
        return {}
    return dict(sub.get("directions", {}))


def save_direction(
    email: str,
    name: str,
    *,
    user_id: str | None = None,
    topics: list[str] | None = None,
    keywords: list[str] | None = None,
    asset_classes: list[str] | None = None,
    markets: list[str] | None = None,
) -> dict:
    """Save/update a research direction for the given email. Returns the direction dict."""
    _migrate_if_needed()
    email = email.strip().lower()
    user_id = user_id.strip() if user_id else None
    name = name.strip()
    with _lock:
        data = _load()
        sub = data.get("subscriptions", {}).get(email) if email else None
        if not sub and user_id:
            for candidate in data.get("subscriptions", {}).values():
                if candidate.get("user_id") == user_id:
                    sub = candidate
                    email = candidate.get("email", "")
                    break
        if not sub:
            raise ValueError(f"Subscription not found: {email or user_id}")
        if user_id and not sub.get("user_id"):
            sub["user_id"] = user_id

        direction = sub.setdefault("directions", {}).setdefault(name, {})
        if topics is not None:
            direction["topics"] = topics
        if keywords is not None:
            direction["keywords"] = keywords
        if asset_classes is not None:
            direction["asset_classes"] = asset_classes
        if markets is not None:
            direction["markets"] = markets
        direction.setdefault("markets", ["china"])
        direction["updated_at"] = datetime.now(timezone.utc).isoformat()
        sub["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save(data)
        return dict(direction)


def delete_direction(email: str, name: str) -> bool:
    """Remove one direction from a subscription."""
    _migrate_if_needed()
    email = email.strip().lower()
    name = name.strip()
    with _lock:
        data = _load()
        sub = data.get("subscriptions", {}).get(email)
        if not sub:
            return False
        if name not in sub.get("directions", {}):
            return False
        del sub["directions"][name]
        sub["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save(data)
        return True


# ── Legacy compat wrappers ──


def get_recipients() -> list[str]:
    """Return flat list of all subscribed emails (for scheduler/dispatcher compat)."""
    return list(get_all_subscriptions().keys())


def get_all_settings() -> dict:
    """Return entire subscriptions.json content (for API compat)."""
    _migrate_if_needed()
    with _lock:
        return _load()
