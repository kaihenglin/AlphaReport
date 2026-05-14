from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from sqlalchemy import or_, desc, asc
from sqlalchemy.orm import Session

from reportagent.models.database import Report, Tag, SearchHistory, UserCriteriaPreset, report_tags
from reportagent.models.schemas import (
    ClassifiedReport,
    ReportSummary,
    StorageResult,
    ReportListParams,
)
from reportagent.utils.hashing import content_hash


class ReportRepository:
    def __init__(self, session: Session):
        self.session = session

    def upsert_report(self, report: ClassifiedReport) -> tuple[str, int]:
        sr = report.search_result
        cl = report.classification

        c_hash = content_hash(sr.title, sr.authors)
        existing = self.session.query(Report).filter(Report.content_hash == c_hash).first()

        markets_str = ",".join(m.value for m in cl.markets)
        asset_classes_str = ",".join(a.value for a in cl.asset_classes)
        frequencies_str = ",".join(f.value for f in cl.frequencies)
        topics_str = ",".join(t.value for t in cl.topics)

        if existing:
            if sr.full_text and not existing.has_full_text:
                existing.full_text = sr.full_text
                existing.has_full_text = True
            if sr.abstract and not existing.abstract:
                existing.abstract = sr.abstract
            if sr.tables_json and not existing.tables_json:
                existing.tables_json = sr.tables_json
            if sr.equations_json and not existing.equations_json:
                existing.equations_json = sr.equations_json
            if sr.pdf_path and not existing.pdf_path:
                existing.pdf_path = sr.pdf_path
            if markets_str:
                existing.markets = markets_str
            if asset_classes_str:
                existing.asset_classes = asset_classes_str
            if frequencies_str:
                existing.frequencies = frequencies_str
            if topics_str:
                existing.topics = topics_str
            existing.classification_confidence = cl.confidence
            existing.classification_method = cl.method
            self.session.commit()
            return "updated", existing.id

        db_report = Report(
            title=sr.title,
            authors=json.dumps(sr.authors),
            abstract=sr.abstract,
            full_text=sr.full_text,
            has_full_text=bool(sr.full_text),
            source=sr.source.value,
            source_url=sr.source_url,
            doi=sr.doi,
            arxiv_id=sr.arxiv_id,
            published_date=sr.published_date,
            pdf_path=sr.pdf_path,
            content_hash=c_hash,
            tables_json=sr.tables_json,
            equations_json=sr.equations_json,
            markets=markets_str,
            asset_classes=asset_classes_str,
            frequencies=frequencies_str,
            topics=topics_str,
            classification_confidence=cl.confidence,
            classification_method=cl.method,
        )
        self.session.add(db_report)
        self.session.commit()

        self._ensure_tags(db_report, cl)

        return "added", db_report.id

    def _ensure_tags(self, db_report: Report, cl) -> None:
        tag_pairs = []
        for m in cl.markets:
            tag_pairs.append(("market", m.value))
        for a in cl.asset_classes:
            tag_pairs.append(("asset_class", a.value))
        for f in cl.frequencies:
            tag_pairs.append(("frequency", f.value))
        for t in cl.topics:
            tag_pairs.append(("topic", t.value))
        for c in cl.custom_tags:
            tag_pairs.append(("custom", c))

        for dimension, value in tag_pairs:
            tag = self.session.query(Tag).filter(
                Tag.dimension == dimension, Tag.value == value
            ).first()
            if not tag:
                tag = Tag(dimension=dimension, value=value)
                self.session.add(tag)
                self.session.flush()
            if tag not in db_report.tags:
                db_report.tags.append(tag)

        self.session.commit()

    def batch_upsert(self, reports: list[ClassifiedReport]) -> StorageResult:
        result = StorageResult(total_processed=len(reports))
        for r in reports:
            try:
                action, _ = self.upsert_report(r)
                if action == "added":
                    result.newly_added += 1
                else:
                    result.updated += 1
            except Exception as e:
                result.errors.append(f"{r.search_result.title}: {e}")
        result.duplicate_skipped = result.total_processed - result.newly_added - result.updated - len(result.errors)
        return result

    def list_reports(self, params: ReportListParams) -> tuple[list[Report], int]:
        q = self.session.query(Report)

        if params.search:
            term = f"%{params.search}%"
            q = q.filter(or_(Report.title.ilike(term), Report.abstract.ilike(term)))
        if params.market:
            q = q.filter(Report.markets.contains(params.market))
        if params.asset_class:
            q = q.filter(Report.asset_classes.contains(params.asset_class))
        if params.frequency:
            q = q.filter(Report.frequencies.contains(params.frequency))
        if params.topic:
            q = q.filter(Report.topics.contains(params.topic))
        if params.source:
            q = q.filter(Report.source == params.source)
        if params.has_full_text is not None:
            q = q.filter(Report.has_full_text == params.has_full_text)
        if params.date_from:
            q = q.filter(Report.published_date >= params.date_from)
        if params.date_to:
            q = q.filter(Report.published_date <= params.date_to)

        total = q.count()

        sort_col = getattr(Report, params.sort_by, Report.created_at)
        if params.sort_by in ("created_at", "published_date"):
            q = q.order_by(desc(sort_col))
        else:
            q = q.order_by(asc(sort_col))

        reports = q.offset(params.offset).limit(params.limit).all()
        return reports, total

    def get_report(self, report_id: int) -> Optional[Report]:
        return self.session.query(Report).filter(Report.id == report_id).first()

    def delete_report(self, report_id: int) -> bool:
        report = self.get_report(report_id)
        if not report:
            return False
        self.session.delete(report)
        self.session.commit()
        return True

    def update_analysis(self, report_id: int, analysis_json: str) -> bool:
        report = self.get_report(report_id)
        if not report:
            return False
        report.analysis_json = analysis_json
        self.session.commit()
        return True

    def update_summary(self, report_id: int, summary: str) -> bool:
        report = self.get_report(report_id)
        if not report:
            return False
        report.summary = summary
        self.session.commit()
        return True

    def get_stats(self) -> dict:
        total = self.session.query(Report).count()
        with_text = self.session.query(Report).filter(Report.has_full_text == True).count()
        return {
            "total_reports": total,
            "with_full_text": with_text,
            "without_full_text": total - with_text,
        }


class SearchHistoryRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(self, task_id: str, criteria_json: str) -> SearchHistory:
        record = SearchHistory(task_id=task_id, criteria_json=criteria_json)
        self.session.add(record)
        self.session.commit()
        return record

    def update_status(self, task_id: str, status: str, results_count: int = 0, newly_added: int = 0, errors: list[str] | None = None):
        record = self.session.query(SearchHistory).filter(SearchHistory.task_id == task_id).first()
        if record:
            record.status = status
            record.results_count = results_count
            record.newly_added = newly_added
            if errors:
                record.errors_json = json.dumps(errors)
            if status in ("completed", "failed"):
                record.completed_at = datetime.utcnow()
            self.session.commit()

    def get(self, task_id: str) -> Optional[SearchHistory]:
        return self.session.query(SearchHistory).filter(SearchHistory.task_id == task_id).first()

    def list_recent(self, limit: int = 20) -> list[SearchHistory]:
        return (
            self.session.query(SearchHistory)
            .order_by(desc(SearchHistory.created_at))
            .limit(limit)
            .all()
        )
