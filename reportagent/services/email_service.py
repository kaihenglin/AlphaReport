"""Email sending service for daily report push."""

from __future__ import annotations

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from reportagent.utils.config import get_config


def _get_email_config() -> dict:
    return get_config("email", default={})


def send_daily_report_email(html_body: str, subject: str, to_email: str) -> bool:
    """Send the daily report as an HTML email to a single recipient. Returns True on success."""
    cfg = _get_email_config()
    if not cfg.get("enabled"):
        return False

    username = os.getenv(cfg.get("username_env", ""), "")
    password = os.getenv(cfg.get("password_env", ""), "")
    from_addr = cfg.get("from_addr", username)

    if not username or not password or not from_addr:
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        server = smtplib.SMTP(cfg["smtp_host"], cfg.get("smtp_port", 587), timeout=15)
        server.starttls()
        server.login(username, password)
        server.sendmail(from_addr, [to_email], msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"[email] Failed to send to {to_email}: {e}")
        return False


def send_test_email(to_addr: str) -> tuple[bool, str]:
    """Send a test email to verify SMTP configuration."""
    cfg = _get_email_config()

    username = os.getenv(cfg.get("username_env", ""), "")
    password = os.getenv(cfg.get("password_env", ""), "")
    from_addr = cfg.get("from_addr", username)

    if not username or not password:
        return False, "SMTP 用户名或密码未配置。请设置环境变量。"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "AlphaReport — 邮件配置测试"
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(
        '<div style="font-family:sans-serif;padding:20px">'
        '<h2>AlphaReport 邮件服务测试成功</h2>'
        '<p>如果你收到这封邮件，说明 SMTP 配置正确，每日研报推送功能已就绪。</p>'
        '</div>',
        "html", "utf-8",
    ))

    try:
        server = smtplib.SMTP(cfg["smtp_host"], cfg.get("smtp_port", 587), timeout=15)
        server.starttls()
        server.login(username, password)
        server.sendmail(from_addr, [to_addr], msg.as_string())
        server.quit()
        return True, f"测试邮件已发送至 {to_addr}"
    except Exception as e:
        return False, f"邮件发送失败: {e}"
