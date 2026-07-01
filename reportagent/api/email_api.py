"""Email settings API — manage per-email subscriptions, schedule, and test SMTP."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from reportagent.api.deps import get_or_create_user
from reportagent.services.email_settings import (
    get_all_subscriptions,
    get_subscription,
    create_subscription,
    delete_subscription,
    update_subscription_schedule,
)
from reportagent.services.email_service import send_test_email
from reportagent.services.scheduler import get_schedule_status, resync_scheduler
from reportagent.utils.config import get_config

router = APIRouter(prefix="/api/v1", tags=["email"])


# ── Pydantic models ──

class CreateSubscriptionRequest(BaseModel):
    email: str
    user_id: str | None = None
    schedule_time: str = "08:00"
    schedule_weekdays: str = "mon-fri"
    schedule_enabled: bool = True


class UpdateScheduleRequest(BaseModel):
    enabled: bool | None = None
    schedule_time: str | None = None
    schedule_weekdays: str | None = None


class TestEmailRequest(BaseModel):
    email: str


# ── Subscriptions ──

@router.get("/subscriptions")
async def list_subscriptions(user: dict = Depends(get_or_create_user)):
    """List subscriptions for the current user."""
    subs = get_all_subscriptions()
    uid = str(user["id"]) if user["id"] else ""
    filtered = [s for s in subs.values() if not uid or s.get("user_id") == uid]
    return {"success": True, "data": filtered}


@router.get("/subscriptions/{email}")
async def get_subscription_endpoint(email: str):
    """Get one subscription by email."""
    sub = get_subscription(email)
    if not sub:
        raise HTTPException(status_code=404, detail="订阅不存在")
    return {"success": True, "data": sub}


@router.post("/subscriptions")
async def create_subscription_endpoint(
    req: CreateSubscriptionRequest,
    user: dict = Depends(get_or_create_user),
):
    """Create a new subscription for the current user."""
    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="无效的邮箱地址")
    # Use authenticated user_id, fall back to request
    user_id = str(user["id"]) if user["id"] else req.user_id
    try:
        sub = create_subscription(
            email,
            schedule_time=req.schedule_time,
            schedule_weekdays=req.schedule_weekdays,
            schedule_enabled=req.schedule_enabled,
            user_id=user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # Resync scheduler to add new job if enabled
    if req.schedule_enabled:
        try:
            resync_scheduler()
        except Exception:
            pass

    return {"success": True, "data": sub, "message": f"已创建 {email} 的订阅"}


@router.delete("/subscriptions/{email}")
async def delete_subscription_endpoint(email: str):
    """Delete a subscription."""
    ok = delete_subscription(email)
    if not ok:
        raise HTTPException(status_code=404, detail="订阅不存在")

    try:
        resync_scheduler()
    except Exception:
        pass

    return {"success": True, "message": f"已移除 {email} 的订阅"}


@router.put("/subscriptions/{email}/schedule")
async def update_schedule_endpoint(email: str, req: UpdateScheduleRequest):
    """Update schedule for one subscription."""
    try:
        sub = update_subscription_schedule(
            email,
            enabled=req.enabled,
            time_str=req.schedule_time,
            weekdays=req.schedule_weekdays,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        resync_scheduler()
    except Exception:
        pass

    return {"success": True, "data": sub, "message": f"已更新 {email} 的推送时间"}


# ── Test email ──

@router.post("/subscriptions/{email}/test")
async def test_subscription_email(email: str):
    """Send a test email to a subscriber."""
    sub = get_subscription(email)
    if not sub:
        raise HTTPException(status_code=404, detail="订阅不存在")
    ok, msg = send_test_email(email)
    return {"success": ok, "message": msg}


# ── Schedule status ──

@router.get("/schedule")
async def get_schedule():
    """Get overall scheduler status with per-subscription info."""
    status = get_schedule_status()
    return {"success": True, "data": status}


# ── SMTP Config (read-only) ──

@router.get("/email/config")
async def get_email_config():
    """Get SMTP configuration info."""
    cfg = get_config("email", default={})
    subs = get_all_subscriptions()
    return {
        "success": True,
        "data": {
            "enabled": cfg.get("enabled", False),
            "smtp_host": cfg.get("smtp_host", ""),
            "smtp_port": cfg.get("smtp_port", 587),
            "from_addr": cfg.get("from_addr", ""),
            "subscription_count": len(subs),
        },
    }
