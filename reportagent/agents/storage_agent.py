from __future__ import annotations

import logging

from reportagent.agents.state import AgentState
from reportagent.db.engine import get_session_factory
from reportagent.db.repository import ReportRepository

logger = logging.getLogger(__name__)


class StorageAgent:
    async def run(self, state: AgentState) -> AgentState:
        state["storage_status"] = "storing"
        state["current_phase"] = "storing"
        state["messages"].append(
            f"Storing {len(state['classified_reports'])} reports..."
        )

        factory = get_session_factory()
        session = factory()
        try:
            repo = ReportRepository(session)
            result = repo.batch_upsert(state["classified_reports"])
            state["storage_result"] = result
            state["storage_status"] = "done"
            state["messages"].append(
                f"Storage complete: {result.newly_added} new, "
                f"{result.updated} updated, "
                f"{result.duplicate_skipped} duplicates skipped"
            )
            if result.errors:
                for err in result.errors:
                    logger.warning("Storage error: %s", err)
        except Exception as e:
            logger.error("Storage agent error: %s", e)
            state["storage_status"] = "error"
            state["messages"].append(f"Storage error: {e}")
        finally:
            session.close()

        state["current_phase"] = "complete"
        return state
