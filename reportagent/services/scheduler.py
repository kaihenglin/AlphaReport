"""Background scheduler — arXiv daily collection + unified daily report."""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from reportagent.models.schemas import UserCriteria
from reportagent.services.email_settings import get_all_subscriptions
from reportagent.utils.config import get_config

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None
_DEFAULT_KEYWORDS = [
    "quantitative finance", "factor model", "machine learning", "deep learning",
    "portfolio optimization", "volatility", "market microstructure",
    "option pricing", "risk management", "asset pricing",
    "statistical arbitrage", "high frequency trading", "alternative data",
    "reinforcement learning", "financial econometrics",
]


def _parse_time(time_str: str) -> tuple[int, int]:
    try:
        parts = time_str.strip().split(":")
        return int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
    except (ValueError, IndexError):
        return 8, 0


# ── arXiv daily collection ──────────────────────────────

def _run_arxiv_collection_sync():
    """Collect yesterday's quant-fin papers from arXiv, classify & store."""
    yesterday = datetime.utcnow() - timedelta(days=3)
    yday_start = yesterday.replace(hour=0, minute=0, second=0, microsecond=0)

    task_id = f"arxiv-daily-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"

    logger.info("[arxiv-collect] Starting daily arXiv scan for %s ...", yesterday.strftime("%Y-%m-%d"))
    try:
        from reportagent.api.collection import _run_collection_pipeline, _tasks

        criteria = UserCriteria(
            topics=[],
            sources=["arxiv"],
            date_from=yday_start,
            max_results_per_source=20,
            keywords=_DEFAULT_KEYWORDS,
        )
        # Pre-register the task so _run_collection_pipeline can update its status
        _tasks[task_id] = {
            "task_id": task_id, "status": "pending", "phase": "collecting",
            "progress_message": "Scheduled arXiv daily scan",
            "results_count": 0, "storage_result": None,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        loop = asyncio.new_event_loop()
        loop.run_until_complete(_run_collection_pipeline(task_id, criteria))
        loop.close()
        logger.info("[arxiv-collect] Pipeline finished for %s — status=%s", task_id, _tasks.get(task_id, {}).get("status", "?"))
    except Exception:
        logger.exception("[arxiv-collect] Failed")


# ── Daily report ───────────────────────────────────────

async def _run_daily_report_all():
    subs = get_all_subscriptions()
    if not subs:
        logger.info("[scheduler] No subscribers, skipping daily report.")
        return

    for email, sub in subs.items():
        if not sub.get("schedule_enabled", False):
            continue
        logger.info("[scheduler] Generating daily report for %s ...", email)
        try:
            from reportagent.chat.tools import generate_daily_report
            uid = sub.get("user_id", "")
            # generate_daily_report is a @tool-decorated StructuredTool, use .ainvoke()
            result = await generate_daily_report.ainvoke({
                "email": email, "user_id": uid, "days": 1, "send_email": True,
            })
            logger.info("[scheduler] Report for %s: %s", email, result[:200])
        except Exception as e:
            logger.error("[scheduler] Report failed for %s: %s", email, e)


# ── Start / Stop ───────────────────────────────────────

def start_scheduler():
    global _scheduler

    cfg = get_config("daily_report", default={})
    if not cfg.get("enabled", False):
        logger.info("[scheduler] Disabled in config.")
        return

    if _scheduler and _scheduler.running:
        return

    _scheduler = AsyncIOScheduler(timezone=timezone.utc)

    # 1) arXiv daily collection — Mon-Fri
    arxiv_cfg = cfg.get("arxiv_collection", {})
    if arxiv_cfg.get("enabled", True):
        arxiv_hour, arxiv_min = _parse_time(arxiv_cfg.get("schedule_cron", "00:00"))
        async def _arxiv_job():
            print(f"[SCHEDULER] arXiv collection firing at {datetime.now(timezone.utc)}", flush=True)
            threading.Thread(target=_run_arxiv_collection_sync, daemon=True).start()
        _scheduler.add_job(
            _arxiv_job,
            trigger=CronTrigger(hour=arxiv_hour, minute=arxiv_min, day_of_week="mon-fri"),
            id="arxiv_daily_collect",
            name="arXiv Daily Collection",
            replace_existing=True,
            misfire_grace_time=None,
        )
        print(f"[SCHEDULER] arXiv job registered: {arxiv_hour:02d}:{arxiv_min:02d} UTC Mon-Fri", flush=True)

    # 2) Daily report generation — Mon-Fri
    report_hour, report_min = _parse_time(cfg.get("schedule_cron", "08:00"))
    _scheduler.add_job(
        _run_daily_report_all,
        trigger=CronTrigger(hour=report_hour, minute=report_min, day_of_week="mon-fri"),
        id="daily_report_all",
        name="Daily Report — All Subscribers",
        replace_existing=True,
        misfire_grace_time=None,
    )
    print(f"[SCHEDULER] Report job registered: {report_hour:02d}:{report_min:02d} UTC Mon-Fri", flush=True)

    _scheduler.start()
    logger.info("[scheduler] Started.")

    # Catch-up: if current time is past scheduled time (weekday), run immediately
    now = datetime.now(timezone.utc)
    if now.weekday() < 5:
        arxiv_cfg = cfg.get("arxiv_collection", {})
        if arxiv_cfg.get("enabled", True):
            arxiv_hour, arxiv_min = _parse_time(arxiv_cfg.get("schedule_cron", "00:00"))
            scheduled = now.replace(hour=arxiv_hour, minute=arxiv_min, second=0, microsecond=0)
            if now > scheduled + timedelta(minutes=30):
                print("[SCHEDULER] Catch-up: arXiv collection", flush=True)
                threading.Thread(target=_run_arxiv_collection_sync, daemon=True).start()
        report_hour, report_min = _parse_time(cfg.get("schedule_cron", "02:00"))
        scheduled_report = now.replace(hour=report_hour, minute=report_min, second=0, microsecond=0)
        if now > scheduled_report + timedelta(minutes=60):
            print("[SCHEDULER] Catch-up: daily report", flush=True)
            import asyncio as _asyncio
            try:
                loop = _asyncio.get_event_loop()
                loop.create_task(_run_daily_report_all())
            except RuntimeError:
                threading.Thread(
                    target=lambda: _asyncio.run(_run_daily_report_all()),
                    daemon=True,
                ).start()


def stop_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("[scheduler] Stopped.")


def resync_scheduler():
    pass


def get_schedule_status() -> dict:
    cfg = get_config("daily_report", default={})
    config_enabled = cfg.get("enabled", False)
    running = _scheduler is not None and _scheduler.running

    arxiv_job = None
    report_job = None
    if running:
        arxiv_job = _scheduler.get_job("arxiv_daily_collect")
        report_job = _scheduler.get_job("daily_report_all")

    subs = get_all_subscriptions()
    subscriptions_status = {}
    for email, sub in subs.items():
        next_run = report_job.next_run_time.isoformat() if report_job and report_job.next_run_time else None
        subscriptions_status[email] = {
            "user_id": sub.get("user_id", ""),
            "email": email,
            "schedule_enabled": sub.get("schedule_enabled", False),
            "schedule_time": cfg.get("schedule_cron", "08:00"),
            "schedule_weekdays": "mon-fri",
            "next_run": next_run,
            "direction_count": len(sub.get("directions", {})),
        }

    return {
        "running": running,
        "config_enabled": config_enabled,
        "arxiv_next_run": arxiv_job.next_run_time.isoformat() if arxiv_job and arxiv_job.next_run_time else None,
        "report_next_run": report_job.next_run_time.isoformat() if report_job and report_job.next_run_time else None,
        "subscriptions": subscriptions_status,
    }
