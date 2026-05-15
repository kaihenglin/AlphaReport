from __future__ import annotations

import asyncio
import logging
from pathlib import Path
import re

from reportagent.models.schemas import UserCriteria, SearchResult, SourceType
from reportagent.processors.pdf_extractor import PDFExtractor
from reportagent.processors.metadata_extractor import MetadataExtractor
from reportagent.sources.base import BaseSource

logger = logging.getLogger(__name__)

_mineru_parser = None
_docling_parser = None


def _get_mineru_parser():
    global _mineru_parser
    if _mineru_parser is None:
        try:
            from reportagent.processors.mineru_parser import MinerUParser
            _mineru_parser = MinerUParser()
            logger.info("MinerU parser loaded")
        except Exception as e:
            logger.info("MinerU not available (%s), using PyMuPDF", e)
    return _mineru_parser


def _get_docling_parser():
    global _docling_parser
    if _docling_parser is None:
        try:
            from reportagent.processors.docling_parser import DoclingParser
            _docling_parser = DoclingParser()
            logger.info("Docling parser loaded")
        except Exception as e:
            logger.info("Docling not available (%s)", e)
    return _docling_parser


class LocalPDFSource(BaseSource):
    def __init__(self, pdf_library_path: str):
        self.pdf_library_path = Path(pdf_library_path)
        self.extractor = PDFExtractor()
        self.meta_extractor = MetadataExtractor()

    @property
    def source_type(self) -> SourceType:
        return SourceType.LOCAL_PDF

    def is_available(self) -> bool:
        return self.pdf_library_path.exists()

    async def search(self, criteria: UserCriteria) -> list[SearchResult]:
        override_path = criteria.local_pdf_path
        scan_dir = Path(override_path) if override_path else self.pdf_library_path

        if not scan_dir.exists():
            return []

        results = []
        pdf_files = sorted(scan_dir.rglob("*.pdf"))

        for pdf_file in pdf_files:
            try:
                result = await asyncio.to_thread(self._process_pdf, pdf_file, criteria)
                if result:
                    results.append(result)
            except Exception:
                continue

            if len(results) >= criteria.max_results_per_source:
                break

        return results

    def _title_from_filename(self, stem: str) -> str:
        """Extract a readable title from a filename like '20250417-开源证券-xxx（12）：标题'."""
        # Remove leading date (8 digits)
        cleaned = re.sub(r'^\d{8}[-_\s]*', '', stem)
        # Remove broker/org prefix before the report number pattern like （数字）
        cleaned = re.sub(r'^.+?[（(]\d+[）)][-：:\s]*', '', cleaned)
        # If nothing left after cleanup, return original
        return cleaned.strip() or stem

    def _process_pdf(self, pdf_path: Path, criteria: UserCriteria) -> SearchResult | None:
        import json

        mineru = _get_mineru_parser()
        docling = _get_docling_parser()

        tables_json_str = None
        equations_json_str = None
        text = ""

        # ---- Primary parse: MinerU (best LaTeX for formulas) ----
        if mineru:
            try:
                parsed = mineru.parse(pdf_path)
                text = parsed.full_text_with_tables
                meta = self.meta_extractor.extract(
                    type("C", (), {"text": text, "metadata": {}})()
                )
                if parsed.tables:
                    tables_json_str = json.dumps(parsed.tables, ensure_ascii=False)
                if parsed.equations:
                    equations_json_str = json.dumps(parsed.equations, ensure_ascii=False)
            except Exception:
                content = self.extractor.extract(pdf_path)
                text = content.text
                meta = self.meta_extractor.extract(content)
        else:
            content = self.extractor.extract(pdf_path)
            text = content.text
            meta = self.meta_extractor.extract(content)

        # ---- Secondary parse: Docling (better tables & structured text) ----
        if docling:
            try:
                dparsed = docling.parse(pdf_path)
                # Use Docling's markdown text if it's richer than MinerU's
                if dparsed.text and len(dparsed.text) > len(text) * 0.5:
                    text = dparsed.text
                # Merge tables: Docling tables are usually better structured
                if dparsed.tables and (not tables_json_str or len(dparsed.tables) >= len(parsed.tables if mineru else [])):
                    tables_json_str = json.dumps(dparsed.tables, ensure_ascii=False)
                # Keep MinerU equations (better LaTeX); fall back to Docling if MinerU has none
                if dparsed.equations and not equations_json_str:
                    equations_json_str = json.dumps(dparsed.equations, ensure_ascii=False)
            except Exception as e:
                logger.warning("Docling secondary parse failed for '%s': %s", pdf_path.name, e)

        # Normalize PDF extraction artifacts in formulas
        if equations_json_str:
            try:
                from reportagent.processors.formula_normalizer import normalize_formulas
                eqs = json.loads(equations_json_str)
                eqs = normalize_formulas(eqs)
                equations_json_str = json.dumps(eqs, ensure_ascii=False)
            except Exception:
                pass

        search_text = (
            (meta.get("title", "") + " " + text[:3000]).lower()
        )

        # Only filter if the user provided explicit keywords; topics alone
        # are English enum values that won't match Chinese PDF content.
        if criteria.keywords:
            matched = any(kw.lower() in search_text for kw in criteria.keywords)
            if not matched:
                return None

        title = meta.get("title", "") or pdf_path.stem

        # Fallback: if title is just a date or too short, use filename
        if not title or re.match(r'^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?\s*$', title.strip()):
            title = self._title_from_filename(pdf_path.stem)
        abstract_end = min(len(text), 2000)
        abstract = text[:abstract_end].strip() if text else None

        return SearchResult(
            title=title,
            authors=meta.get("authors", []),
            abstract=abstract,
            full_text=text,
            abstract_only=False,
            source=SourceType.LOCAL_PDF,
            doi=meta.get("doi"),
            arxiv_id=meta.get("arxiv_id"),
            published_date=meta.get("date"),
            pdf_path=str(pdf_path),
            tables_json=tables_json_str,
            equations_json=equations_json_str,
        )
