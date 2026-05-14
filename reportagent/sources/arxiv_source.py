from __future__ import annotations

import asyncio
import logging
from datetime import datetime

import arxiv

from reportagent.models.schemas import UserCriteria, SearchResult, SourceType
from reportagent.sources.base import BaseSource
from reportagent.utils.topic_expansion import expand_topics

logger = logging.getLogger(__name__)


class ArxivSource(BaseSource):
    CATEGORY_MAP = {
        "risk model": ["q-fin.RM"],
        "risk management": ["q-fin.RM"],
        "risk parity": ["q-fin.RM", "q-fin.PM"],
        "value at risk": ["q-fin.RM"],
        "risk": ["q-fin.RM"],
        "portfolio optimization": ["q-fin.PM"],
        "asset allocation": ["q-fin.PM"],
        "mean-variance": ["q-fin.PM"],
        "markowitz": ["q-fin.PM"],
        "efficient frontier": ["q-fin.PM"],
        "rebalancing": ["q-fin.PM"],
        "portfolio": ["q-fin.PM"],
        "execution algorithm": ["q-fin.TR"],
        "algorithmic trading": ["q-fin.TR"],
        "optimal execution": ["q-fin.TR"],
        "transaction cost": ["q-fin.TR"],
        "twap": ["q-fin.TR"],
        "vwap": ["q-fin.TR"],
        "execution": ["q-fin.TR"],
        "high frequency trading": ["q-fin.TR", "q-fin.MF"],
        "hft": ["q-fin.TR", "q-fin.MF"],
        "market making": ["q-fin.TR", "q-fin.MF"],
        "low latency": ["q-fin.TR"],
        "machine learning": ["q-fin.ST", "stat.ML", "cs.LG"],
        "deep learning": ["q-fin.ST", "cs.LG"],
        "neural network": ["q-fin.ST", "cs.LG"],
        "reinforcement learning": ["q-fin.ST", "cs.LG"],
        "lstm": ["q-fin.ST", "cs.LG"],
        "transformer": ["q-fin.ST", "cs.LG"],
        "random forest": ["q-fin.ST", "stat.ML"],
        "xgboost": ["q-fin.ST", "stat.ML"],
        "factor model": ["q-fin.ST", "q-fin.PM"],
        "multi-factor": ["q-fin.ST", "q-fin.PM"],
        "factor investing": ["q-fin.ST", "q-fin.PM"],
        "smart beta": ["q-fin.ST", "q-fin.PM"],
        "fama-french": ["q-fin.ST", "q-fin.PM"],
        "factor": ["q-fin.ST", "q-fin.PM"],
        "volatility": ["q-fin.ST", "q-fin.MF"],
        "implied volatility": ["q-fin.PR", "q-fin.MF"],
        "stochastic volatility": ["q-fin.MF", "q-fin.PR"],
        "garch": ["q-fin.ST", "q-fin.MF"],
        "option pricing": ["q-fin.PR", "q-fin.CP"],
        "market microstructure": ["q-fin.TR", "q-fin.MF"],
        "order book": ["q-fin.TR", "q-fin.MF"],
        "limit order book": ["q-fin.TR", "q-fin.MF"],
        "price discovery": ["q-fin.TR", "q-fin.MF"],
        "statistical arbitrage": ["q-fin.ST", "q-fin.TR"],
        "pairs trading": ["q-fin.ST", "q-fin.TR"],
        "market neutral": ["q-fin.ST", "q-fin.TR"],
        "mean reversion": ["q-fin.ST"],
        "cointegration": ["q-fin.ST"],
        "option": ["q-fin.PR", "q-fin.CP"],
        "derivatives": ["q-fin.PR", "q-fin.CP"],
        "alternative data": ["q-fin.ST"],
        "sentiment analysis": ["q-fin.ST", "cs.CL"],
        "nlp finance": ["q-fin.ST", "cs.CL"],
        "text mining": ["q-fin.ST", "cs.CL"],
    }

    def __init__(self, rate_limit_seconds: float = 3.0, download_pdfs: bool = True):
        self.rate_limit_seconds = rate_limit_seconds
        self.download_pdfs = download_pdfs

    @property
    def source_type(self) -> SourceType:
        return SourceType.ARXIV

    def is_available(self) -> bool:
        return True

    async def search(self, criteria: UserCriteria) -> list[SearchResult]:
        query = self._build_query(criteria)
        if not query:
            return []

        try:
            fetch_count = criteria.max_results_per_source
            if criteria.date_from or criteria.date_to:
                fetch_count = fetch_count * 5
            has_date_filter = bool(criteria.date_from or criteria.date_to)
            results = await asyncio.wait_for(
                asyncio.to_thread(
                    self._execute_search, query, fetch_count, sort_by_date=has_date_filter
                ),
                timeout=120,
            )
        except asyncio.TimeoutError:
            logger.warning("ArxivSource search timed out after 120s")
            return []

        if criteria.date_from or criteria.date_to:
            results = self._filter_by_date(results, criteria.date_from, criteria.date_to)
            results = results[:criteria.max_results_per_source]

        if self.download_pdfs and results:
            results = await self._download_and_parse_pdfs(results)

        return results

    async def _download_and_parse_pdfs(self, results: list[SearchResult]) -> list[SearchResult]:
        import httpx

        updated = []
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            for r in results:
                pdf_url = r.raw_metadata.get("pdf_url")
                if not pdf_url or not r.abstract_only:
                    updated.append(r)
                    continue

                try:
                    r = await asyncio.wait_for(
                        self._fetch_one_pdf(client, r, pdf_url), timeout=90
                    )
                except asyncio.TimeoutError:
                    logger.warning("PDF download/parse timed out for %s", r.title[:50])
                except Exception as e:
                    logger.warning("PDF failed for %s: %s", r.title[:50], e)

                updated.append(r)

        return updated

    async def _fetch_one_pdf(
        self, client, result: SearchResult, pdf_url: str
    ) -> SearchResult:
        resp = await client.get(pdf_url)
        resp.raise_for_status()
        pdf_bytes = resp.content

        saved_path = await asyncio.to_thread(self._save_pdf_bytes, pdf_bytes, result.arxiv_id)

        full_text = await asyncio.to_thread(self._parse_pdf_bytes, pdf_bytes)

        updates: dict = {}
        if saved_path:
            updates["pdf_path"] = saved_path
        if full_text and len(full_text.strip()) > 100:
            updates["full_text"] = full_text
            updates["abstract_only"] = False

        if updates:
            result = result.model_copy(update=updates)

        return result

    @staticmethod
    def _save_pdf_bytes(pdf_bytes: bytes, arxiv_id: str | None) -> str | None:
        if not arxiv_id:
            return None
        try:
            from reportagent.utils.config import PROJECT_ROOT
            pdf_dir = PROJECT_ROOT / "data" / "pdfs"
            pdf_dir.mkdir(parents=True, exist_ok=True)
            safe_name = arxiv_id.replace("/", "_").replace("\\", "_")
            pdf_path = pdf_dir / f"{safe_name}.pdf"
            pdf_path.write_bytes(pdf_bytes)
            return str(pdf_path)
        except Exception as e:
            logger.warning("Failed to save PDF for %s: %s", arxiv_id, e)
            return None

    @staticmethod
    def _parse_pdf_bytes(pdf_bytes: bytes) -> str | None:
        try:
            import fitz
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            try:
                text = "\n".join(page.get_text() for page in doc)
                if text and len(text.strip()) > 100:
                    return text
            finally:
                doc.close()
        except Exception as e:
            logger.debug("PyMuPDF parse failed: %s", e)
        return None

    def _filter_by_date(
        self, results: list[SearchResult], date_from, date_to
    ) -> list[SearchResult]:
        filtered = []
        for r in results:
            if not r.published_date:
                continue
            pub = r.published_date.replace(tzinfo=None)
            if date_from and pub < date_from.replace(tzinfo=None):
                continue
            if date_to and pub > date_to.replace(tzinfo=None):
                continue
            filtered.append(r)
        return filtered

    def _build_query(self, criteria: UserCriteria) -> str:
        en_terms = expand_topics(criteria.topics, criteria.keywords, lang="en")

        topic_parts = []
        categories: set[str] = set()
        for term in en_terms:
            topic_parts.append(f'all:"{term}"')
            term_lower = term.lower()
            for key, cats in self.CATEGORY_MAP.items():
                if key in term_lower or term_lower in key:
                    categories.update(cats)

        parts = []
        if topic_parts:
            parts.append("(" + " OR ".join(topic_parts) + ")")

        if categories:
            cat_parts = [f"cat:{c}" for c in sorted(categories)]
            parts.append("(" + " OR ".join(cat_parts) + ")")

        return " AND ".join(parts) if parts else ""

    def _execute_search(self, query: str, max_results: int, sort_by_date: bool = False) -> list[SearchResult]:
        client = arxiv.Client()
        search = arxiv.Search(
            query=query,
            max_results=max_results,
            sort_by=arxiv.SortCriterion.SubmittedDate if sort_by_date else arxiv.SortCriterion.Relevance,
        )

        results = []
        for paper in client.results(search):
            pub_date = paper.published
            if isinstance(pub_date, datetime):
                pass
            else:
                pub_date = None

            results.append(
                SearchResult(
                    title=paper.title,
                    authors=[a.name for a in paper.authors],
                    abstract=paper.summary,
                    full_text=None,
                    abstract_only=True,
                    source=SourceType.ARXIV,
                    source_url=paper.entry_id,
                    doi=paper.doi,
                    arxiv_id=paper.get_short_id(),
                    published_date=pub_date,
                    raw_metadata={
                        "categories": paper.categories,
                        "primary_category": paper.primary_category,
                        "pdf_url": paper.pdf_url,
                    },
                )
            )

        return results
