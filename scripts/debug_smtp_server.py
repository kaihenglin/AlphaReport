"""Local debug SMTP server — captures all emails and saves them as HTML files.

Usage: python scripts/debug_smtp_server.py
Listens on localhost:1025, prints emails to stdout and saves to scripts/test_emails/
"""

import os
import sys
import asyncio
from datetime import datetime
from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "test_emails")


class DebugHandler:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        envelope.rcpt_tos.append(address)
        return "250 OK"

    async def handle_DATA(self, server, session, envelope):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        subject = "unknown"
        for line in envelope.content.decode("utf-8", errors="replace").split("\n"):
            if line.lower().startswith("subject:"):
                subject = line[8:].strip().replace(" ", "_")[:60]
                break

        filename = f"{timestamp}_{subject}.html"
        filepath = os.path.join(OUTPUT_DIR, filename)

        content = envelope.content.decode("utf-8", errors="replace")
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)

        print(f"\n{'='*60}")
        print(f"MAIL FROM: {envelope.mail_from}")
        print(f"RCPT TO:   {', '.join(envelope.rcpt_tos)}")
        print(f"SUBJECT:   {subject}")
        print(f"SAVED TO:  {filepath}")
        print(f"{'='*60}\n")
        return "250 OK"


def main():
    controller = Controller(DebugHandler(), hostname="localhost", port=1025)
    controller.start()
    print(f"Debug SMTP server running on localhost:1025")
    print(f"Emails will be saved to: {OUTPUT_DIR}")
    print("Press Ctrl+C to stop.")
    try:
        while True:
            import time
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down...")
        controller.stop()


if __name__ == "__main__":
    main()
