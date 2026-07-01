from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Positive indicators that a paper IS quantitative finance.
# Keywords are stems — matched case-insensitively against title + abstract.
QUANT_SIGNALS: dict[str, list[str]] = {
    "math_stat": [
        "regress", "optimiz", "stochastic", "algorithm",
        "model", "estimat", "infer", "predict", "forecast",
        "probabil", "distribut", "covariance", "correlat",
        "time series", "panel data", "cross-section", "bootstrap",
        "monte carlo", "bayesian", "maximum likelihood", "regulariz",
        "gradient", "converg", "loss function", "objective function",
        "sharpe", "sortino", "information ratio", "maximum drawdown",
        "coefficient", "variable", "parameter", "matrix", "vector",
        "likelihood", "momentum", "linear", "nonlinear", "quadratic",
        "norm", "constraint", "residual", "error term", "r-squared",
        "neural", "network", "layer", "activation", "backpropagat",
        "loss", "accuracy", "precision", "recall", "auc",
        "markov", "bellman", "q-learning", "policy gradient",
        "state space", "kalman", "particle filter",
        "hidden markov", "regime switch",
    ],
    "quant_method": [
        "factor model", "risk model", "machine learning", "deep learning",
        "neural network", "lstm", "transformer", "attention",
        "random forest", "xgboost", "gradient boost", "reinforcement learning",
        "garch", "arch", "stochastic volatility", "cointegrat",
        "principal component", "pca", "autoencoder", "gan",
        "natural language process", "nlp", "sentiment",
        "support vector", "k-means", "cluster", "classif",
        "tree", "ensemble", "bagging", "boosting",
        "graph neural", "diffusion model", "generative",
        "regime switch", "kalman filter", "markov model",
        "actor-critic", "ppo", "dqn", "mdp",
        "bert", "finbert", "roberta", "gpt", "llm",
        "large language model", "foundation model",
    ],
    "quant_finance": [
        "alpha", "beta", "factor", "signal", "portfolio",
        "asset pric", "return predict", "volatil", "risk premium",
        "backtest", "strategy", "trading", "execution", "market impact",
        "order book", "limit order", "market mak", "arbitrage",
        "hedg", "derivative", "option pric", "futures",
        "sharpe", "sortino", "drawdown", "var", "cvar",
        "expected return", "excess return", "risk-free",
        "stock select", "stock predict", "equity",
        "quant", "quantitative", "financial engineering",
        "a-share", "csi", "sse", "szse", "china market",
        "factor timing", "market timing", "economic indicator",
        "long-short", "long only", "top-minus-bottom",
        "ic", "rank ic", "icir", "information coeffic",
        "earnings", "transcript", "filing", "10-k", "10-q",
        "analyst", "news", "macroeconomic",
    ],
    "data_empirical": [
        "empiric", "dataset", "sample period", "out-of-sample",
        "backtest", "transaction cost", "turnover",
        "cross-section", "portfolio construct",
        "train set", "test set", "validat set",
        "implement", "benchmark", "baseline",
        "simulat", "annualized", "cumulative",
        "sharpe", "information ratio", "maximum drawdown",
        "daily return", "monthly return", "stock universe",
    ],
}


def _stem_matches(stem: str, text: str) -> bool:
    """Check if stem appears in text with word-boundary awareness.

    Stems with length <= 4 use regex \\b boundaries to avoid matching
    inside longer words (e.g., 'arch' matching 'research', 'ic' matching 'practice').
    Longer stems use substring matching which correctly finds word variants
    (e.g., 'predict' matches 'prediction', 'predicting').
    """
    if " " in stem:
        return stem in text

    if len(stem) <= 4:
        import re
        return bool(re.search(rf"\b{re.escape(stem)}", text))

    return stem in text


def compute_quant_score(title: str, abstract: str = "") -> tuple[float, dict[str, float]]:
    """Return (total_score, category_scores) for a paper's quant relevance.

    Uses stem-based matching: keyword stems like 'predict' match 'prediction',
    'predictive', 'predicting' etc.
    """
    text = f"{title} {abstract}"[:8000].lower()
    cat_scores: dict[str, float] = {}

    for cat, stems in QUANT_SIGNALS.items():
        hits = 0
        for stem in stems:
            if _stem_matches(stem, text):
                hits += 1
        cat_scores[cat] = hits / len(stems) if stems else 0.0

    # Weighted: quant_finance and math_stat are heavier signals
    weights = {
        "math_stat": 0.25,
        "quant_method": 0.15,
        "quant_finance": 0.35,
        "data_empirical": 0.25,
    }
    total = sum(cat_scores.get(c, 0) * weights.get(c, 0.1) for c in QUANT_SIGNALS)

    return round(total, 4), {k: round(v, 4) for k, v in cat_scores.items()}


def is_quant_finance(title: str, abstract: str = "", threshold: float = 0.015) -> bool:
    """Quick keyword-based quant relevance check.

    threshold=0.015 is calibrated on 150+ word real arXiv abstracts.
    With very short abstracts (<50 words), borderline papers may need
    the LLM fallback via is_quant_finance_llm().
    """
    score, _ = compute_quant_score(title, abstract)
    return score >= threshold


async def is_quant_finance_llm(
    title: str,
    abstract: str,
    threshold: float = 0.015,
) -> bool:
    """Two-tier quant relevance check: keyword first, LLM for borderline cases.

    Only invokes LLM when keyword score is in the gray zone.
    """
    kw_score, cat_scores = compute_quant_score(title, abstract)

    # Clear pass
    if kw_score >= threshold * 3:
        return True

    # Clear reject: near-zero signals across all categories
    if kw_score < threshold * 0.3:
        logger.debug("Quant filter REJECT (score=%.4f): %s", kw_score, title[:60])
        return False

    # Gray zone: ask LLM
    logger.debug("Quant filter gray zone (score=%.4f): %s", kw_score, title[:60])
    try:
        from reportagent.llm.client import LLMClient

        prompt = (
            "判断以下论文是否属于**量化金融**或**金融工程**领域。\n"
            "量化金融论文的特征：使用数学模型、统计方法、机器学习等定量工具分析金融问题。\n"
            "排除：纯定性分析、监管政策、法律法规、公司治理案例研究、纯宏观经济评论。\n\n"
            f"标题：{title}\n\n"
            f"摘要：{abstract[:1500]}\n\n"
            '返回 JSON: {{"is_quant": true/false, "reason": "一句话理由"}}'
        )
        client = LLMClient()
        resp = await client.chat_json(
            [{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=200,
        )
        result = resp.get("is_quant", False)
        logger.debug("Quant filter LLM: %s -> %s", title[:60], result)
        return result
    except Exception as e:
        logger.warning("Quant LLM check failed, falling back to keyword: %s", e)
        return kw_score >= threshold
