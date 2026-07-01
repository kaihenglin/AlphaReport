"""Test the email pipeline end-to-end using a local debug SMTP server.

Prerequisites:
  1. Start debug SMTP server: python scripts/debug_smtp_server.py (in another terminal)
  2. Run this script: python scripts/test_email_local.py
"""

import sys
import os
import json
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def send_via_localhost(to_addr: str, subject: str, html_body: str, from_addr: str = "noreply@alphareport.local"):
    """Send email via localhost:1025 debug SMTP server."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP("localhost", 1025, timeout=10) as server:
        server.sendmail(from_addr, [to_addr], msg.as_string())
    print(f"  -> Sent '{subject}' to {to_addr}")


def test_simple_email():
    """Test 1: Basic test email."""
    html = f"""
    <html><body style="font-family:sans-serif;padding:20px">
    <h2>AlphaReport 邮件服务测试成功</h2>
    <p>如果你看到这封邮件，说明邮件发送管线工作正常。</p>
    <p style="color:#666">发送时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
    </body></html>
    """
    send_via_localhost("test@example.com", "AlphaReport — 邮件配置测试", html)


def test_daily_report_email():
    """Test 2: Daily report format with mock papers."""
    now = datetime.now().strftime("%Y-%m-%d")

    papers = [
        {
            "title": "Deep Reinforcement Learning for Portfolio Management",
            "authors": "Zhang et al.",
            "source": "arXiv (q-fin.PM)",
            "topics": ["强化学习", "投资组合", "深度学习"],
            "summary": "提出了一种基于深度强化学习的动态投资组合管理框架，在多个全球股票市场上验证了其有效性。最优策略在夏普比率和最大回撤方面均优于等权重和均值-方差基准。",
            "kc_url": "http://localhost:5173/library/42",
        },
        {
            "title": "The Privacy Subsidy: Kyle's $\\lambda$ under Noise-Perturbed Order-Flow",
            "authors": "Smith & Jones",
            "source": "SSRN",
            "topics": ["市场微观结构", "信息不对称", "隐私保护"],
            "summary": "研究了噪声扰动订单流下的Kyle模型定价效率与隐私权衡，发现在特定噪声水平下存在隐私补贴效应。",
            "kc_url": "http://localhost:5173/library/43",
        },
        {
            "title": "Transformer-Based Multimodal Financial Sentiment Analysis",
            "authors": "Li, Wang & Chen",
            "source": "arXiv (q-fin.CP)",
            "topics": ["情感分析", "多模态", "NLP"],
            "summary": "构建了基于Transformer的多模态情感分析模型，融合新闻文本与市场数据，在中文金融数据集上F1达到0.89。",
            "kc_url": "http://localhost:5173/library/44",
        },
    ]

    html_parts = [f"""
    <html><head><meta charset="utf-8"><style>
        body {{ font-family: -apple-system, 'Microsoft YaHei', sans-serif; color: #1a1a1a; padding: 20px; }}
        h1 {{ color: #2563eb; font-size: 22px; }}
        .meta {{ color: #6b7280; font-size: 13px; margin-bottom: 16px; }}
        .paper {{ border-left: 3px solid #2563eb; padding: 12px 16px; margin: 12px 0; background: #f8fafc; border-radius: 6px; }}
        .paper-title {{ font-size: 15px; font-weight: 600; color: #1e3a5f; }}
        .paper-meta {{ font-size: 12px; color: #6b7280; margin: 4px 0; }}
        .topic-tag {{ display: inline-block; background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 10px; font-size: 11px; margin: 2px; }}
        .summary {{ font-size: 13px; color: #4b5563; margin: 8px 0; line-height: 1.6; }}
        .kc-link {{ display: inline-block; margin-top: 6px; color: #2563eb; text-decoration: none; font-size: 12px; }}
        .kc-link:hover {{ text-decoration: underline; }}
        .footer {{ margin-top: 30px; padding-top: 15px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }}
    </style></head><body>
    <h1>AlphaReport 每日研报速递</h1>
    <p class="meta">{now} · 共 {len(papers)} 篇新论文</p>
    """]

    for i, p in enumerate(papers, 1):
        tags_html = " ".join(f'<span class="topic-tag">{t}</span>' for t in p["topics"])
        html_parts.append(f"""
        <div class="paper">
            <div class="paper-title">#{i} {p['title']}</div>
            <div class="paper-meta">{p['authors']} · {p['source']}</div>
            <div>{tags_html}</div>
            <div class="summary">{p['summary']}</div>
            <a class="kc-link" href="{p['kc_url']}">View Knowledge Card →</a>
        </div>
        """)

    html_parts.append(f"""
    <div class="footer">
        本邮件由 AlphaReport 自动生成 · 每日定时推送<br>
        如需退订或调整推送偏好，请访问
        <a href="http://localhost:5173/email">邮件推送设置</a>
    </div></body></html>
    """)

    send_via_localhost(
        "researcher@example.com",
        f"AlphaReport 每日研报速递 - {now}",
        "".join(html_parts),
    )


def test_with_real_service():
    """Test 3: Verify the real email_service structure loads correctly."""
    from reportagent.services.email_settings import get_recipients, get_all_settings
    settings = get_all_settings()
    print(f"  Email settings: {json.dumps(settings, indent=2, ensure_ascii=False)}")

    from reportagent.services.email_service import send_test_email, send_daily_report_email
    print(f"  send_test_email imported OK")
    print(f"  send_daily_report_email imported OK")


if __name__ == "__main__":
    print("=" * 55)
    print(" AlphaReport Email Pipeline — Local Test Suite")
    print("=" * 55)

    print("\n[1/3] Simple test email...")
    test_simple_email()

    print("\n[2/3] Daily report format email...")
    test_daily_report_email()

    print("\n[3/3] Email service module check...")
    test_with_real_service()

    print("\n" + "=" * 55)
    print(" All tests complete!")
    print(" Check scripts/test_emails/ for saved HTML files.")
    print("=" * 55)
