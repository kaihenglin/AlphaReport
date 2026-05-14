import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getReport, deleteReport, deepParseReport, analyzeReportStream } from "../services/api";
import type { ReportDetail, ReportTable, ReportEquation, AnalysisResult } from "../types";
import {
  SOURCE_LABELS,
  MARKET_LABELS,
  ASSET_LABELS,
  FREQUENCY_LABELS,
  TOPIC_LABELS,
  BIAS_RISK_LABELS,
  METHOD_CATEGORY_LABELS,
} from "../types";
import katex from "katex";
import "katex/dist/katex.min.css";

function renderLatex(text: string): string {
  return text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, latex) => {
    try {
      return katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<code>${latex.trim()}</code>`;
    }
  }).replace(/(?<!\$)\$(?!\$)(.*?)\$/g, (_match, latex) => {
    try {
      return katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<code>${latex.trim()}</code>`;
    }
  });
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullText, setShowFullText] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState("");
  const [activeTab, setActiveTab] = useState<"summary" | "analysis" | "equations" | "tables" | "fulltext" | "pdf">("summary");
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleDelete = async () => {
    if (!report) return;
    if (!confirm(`确定删除「${report.title.slice(0, 40)}...」？此操作不可撤销。`)) return;
    await deleteReport(report.id);
    navigate("/library");
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getReport(Number(id)).then((res) => {
      if (res.success && res.data) {
        const r = res.data;
        setReport(r);
        if (r.summary) setSummaryText(r.summary);
        if (r.analysis) {
          setAnalysisResult(r.analysis);
        }
      }
      setLoading(false);
    });
  }, [id]);

  // Load PDF as blob URL when the pdf tab becomes active, so the browser
  // renders it inline without relying on Content-Disposition headers.
  const pdfBlobRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTab !== "pdf" || !report?.id) return;
    const ctrl = new AbortController();
    // Revoke previous blob URL if any
    if (pdfBlobRef.current) {
      URL.revokeObjectURL(pdfBlobRef.current);
      pdfBlobRef.current = null;
    }
    setPdfBlobUrl(null);
    fetch(`/api/v1/reports/${report.id}/pdf`, { signal: ctrl.signal })
      .then((res) => res.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        pdfBlobRef.current = url;
        setPdfBlobUrl(url);
      })
      .catch((err) => {
        if (err.name !== "AbortError") console.error("PDF load failed:", err);
      });
    return () => {
      ctrl.abort();
    };
  }, [activeTab, report?.id]);

  const handleSummarize = useCallback(async () => {
    if (!report || summarizing) return;
    setSummarizing(true);
    setSummaryText("");
    setActiveTab("summary");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`/api/v1/reports/${report.id}/summarize`, {
        method: "POST",
        signal: ctrl.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "token") {
              setSummaryText((prev) => prev + data.content);
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setSummaryText("总结生成失败，请重试。");
      }
    } finally {
      setSummarizing(false);
      abortRef.current = null;
    }
  }, [report, summarizing]);

  const handleDeepParse = useCallback(async () => {
    if (!report || parsing) return;
    setParsing(true);
    setParseResult(null);

    try {
      const res = await deepParseReport(report.id);
      if (res.success && res.data) {
        setParseResult(
          `解析完成：${res.data.tables_count} 个表格，${res.data.equations_count} 个公式`
        );
        const updated = await getReport(report.id);
        if (updated.success && updated.data) {
          setReport(updated.data);
          if (res.data.equations_count > 0) setActiveTab("equations");
        }
      } else {
        setParseResult("解析失败：" + (res.error || "未知错误"));
      }
    } catch {
      setParseResult("解析请求失败，请重试。");
    } finally {
      setParsing(false);
    }
  }, [report, parsing]);

  const handleAnalyze = useCallback(async (depth: string = "standard") => {
    if (!report || analyzing) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    setAnalysisPhase("正在启动分析...");
    setActiveTab("analysis");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const { url, method } = analyzeReportStream(report.id, depth);
      const res = await fetch(url, { method, signal: ctrl.signal });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "start") {
              setAnalysisPhase("提取元数据...");
            } else if (data.type === "done") {
              setAnalysisResult(data.result as AnalysisResult);
              setAnalysisPhase("");
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setAnalysisPhase("分析失败，请重试。");
      }
    } finally {
      setAnalyzing(false);
      abortRef.current = null;
    }
  }, [report, analyzing]);

  const parsedTables: ReportTable[] = useMemo(() => {
    if (!report?.tables_json) return [];
    try { return JSON.parse(report.tables_json); } catch { return []; }
  }, [report?.tables_json]);

  const parsedEquations: ReportEquation[] = useMemo(() => {
    if (!report?.equations_json) return [];
    try { return JSON.parse(report.equations_json); } catch { return []; }
  }, [report?.equations_json]);

  const renderedSummary = useMemo(() => {
    if (!summaryText) return "";
    return renderLatex(summaryText);
  }, [summaryText]);

  if (loading) {
    return <div className="text-center py-12 text-gray-400">加载中...</div>;
  }

  if (!report) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">研报不存在</p>
        <Link to="/library" className="text-indigo-600 text-sm mt-2 inline-block">
          返回研报库
        </Link>
      </div>
    );
  }

  const allTags: { label: string; value: string }[] = [
    ...report.markets.map((m) => ({
      label: "市场",
      value: MARKET_LABELS[m as keyof typeof MARKET_LABELS] || m,
    })),
    ...report.asset_classes.map((a) => ({
      label: "资产",
      value: ASSET_LABELS[a as keyof typeof ASSET_LABELS] || a,
    })),
    ...report.frequencies.map((f) => ({
      label: "频率",
      value: FREQUENCY_LABELS[f as keyof typeof FREQUENCY_LABELS] || f,
    })),
    ...report.topics.map((t) => ({
      label: "主题",
      value: TOPIC_LABELS[t as keyof typeof TOPIC_LABELS] || t,
    })),
    ...report.custom_tags.map((t) => ({
      label: "标签",
      value: t,
    })),
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        to="/library"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        &larr; 返回研报库
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="text-xl font-bold text-gray-900 leading-snug">
            {report.title}
          </h1>
          <div className="shrink-0 flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-xs">
              {SOURCE_LABELS[report.source] || report.source}
            </span>
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            >
              删除
            </button>
          </div>
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {report.authors.length > 0 && (
            <MetaItem label="作者" value={report.authors.join(", ")} />
          )}
          {report.published_date && (
            <MetaItem label="发布日期" value={report.published_date.slice(0, 10)} />
          )}
          {report.doi && <MetaItem label="DOI" value={report.doi} />}
          {report.source_url && (
            <MetaItem
              label="来源链接"
              value={
                <a
                  href={report.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 hover:underline truncate block"
                >
                  查看原文
                </a>
              }
            />
          )}
        </div>

        {/* Tags */}
        {allTags.length > 0 && (
          <div className="mb-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase mb-2">
              分类标签
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((t, i) => (
                <span
                  key={i}
                  className={`px-2.5 py-1 rounded-full text-xs ${
                    t.label === "标签"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-indigo-50 text-indigo-700"
                  }`}
                >
                  <span className={`mr-1 ${
                    t.label === "标签" ? "text-emerald-400" : "text-indigo-400"
                  }`}>{t.label}:</span>
                  {t.value}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Abstract */}
        {report.abstract && (
          <div className="mb-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase mb-2">
              摘要
            </h2>
            <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
              {report.abstract}
            </p>
          </div>
        )}

        {/* Action Bar */}
        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-200">
          <button
            onClick={handleDeepParse}
            disabled={parsing}
            className="px-4 py-2 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:bg-gray-100 disabled:text-gray-400 transition-colors"
          >
            {parsing ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />
                深度解析中...
              </span>
            ) : (
              "深度解析（提取公式/表格）"
            )}
          </button>
          <button
            onClick={() => handleAnalyze("standard")}
            disabled={analyzing || !(report.has_full_text || report.abstract)}
            className="px-4 py-2 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:bg-gray-100 disabled:text-gray-400 transition-colors"
          >
            {analyzing ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                AI 分析中...
              </span>
            ) : analysisResult ? (
              "重新 AI 分析"
            ) : (
              "AI 深度分析（多阶段）"
            )}
          </button>
          {parseResult && (
            <span className="text-xs text-gray-500">{parseResult}</span>
          )}
        </div>

        {/* Tabs */}
        <div className="border-gray-200">
          <div className="flex items-center gap-1 mb-4">
            <TabButton active={activeTab === "summary"} onClick={() => setActiveTab("summary")}>
              研报总结
            </TabButton>
            {(analysisResult || analyzing) && (
              <TabButton active={activeTab === "analysis"} onClick={() => setActiveTab("analysis")}>
                深度分析
              </TabButton>
            )}
            {parsedEquations.length > 0 && (
              <TabButton active={activeTab === "equations"} onClick={() => setActiveTab("equations")}>
                公式 ({parsedEquations.length})
              </TabButton>
            )}
            {parsedTables.length > 0 && (
              <TabButton active={activeTab === "tables"} onClick={() => setActiveTab("tables")}>
                表格 ({parsedTables.length})
              </TabButton>
            )}
            {report.full_text && (
              <TabButton active={activeTab === "fulltext"} onClick={() => setActiveTab("fulltext")}>
                全文
              </TabButton>
            )}
            {(report.pdf_path || report.source === "arxiv") && (
              <TabButton active={activeTab === "pdf"} onClick={() => setActiveTab("pdf")}>
                原文PDF
              </TabButton>
            )}
          </div>

          {/* Summary Tab */}
          {activeTab === "summary" && (
            <div>
              {summaryText ? (
                <div className="bg-gradient-to-br from-indigo-50/50 to-white rounded-lg p-5 border border-indigo-100">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-indigo-900">AI 总结</h3>
                    <button
                      onClick={handleSummarize}
                      disabled={summarizing}
                      className="text-xs text-indigo-600 hover:text-indigo-800 disabled:text-gray-400"
                    >
                      {summarizing ? "生成中..." : "重新生成"}
                    </button>
                  </div>
                  <div
                    className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none
                      [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto
                      [&_.katex]:text-[0.95em]"
                    dangerouslySetInnerHTML={{ __html: renderLatex(
                      summaryText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\n/g, '<br/>')
                    ) }}
                  />
                  {summarizing && (
                    <span className="inline-block w-1.5 h-4 bg-indigo-500 animate-pulse ml-0.5 align-text-bottom" />
                  )}
                </div>
              ) : (
                <div className="text-center py-10">
                  <p className="text-gray-400 text-sm mb-4">
                    {report.has_full_text || report.abstract
                      ? "尚未生成研报总结"
                      : "无可分析的内容"}
                  </p>
                  {(report.has_full_text || report.abstract) && (
                    <button
                      onClick={handleSummarize}
                      disabled={summarizing}
                      className="px-5 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 transition-colors"
                    >
                      {summarizing ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          正在生成总结...
                        </span>
                      ) : (
                        "生成 AI 总结（含关键公式）"
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Analysis Tab */}
          {activeTab === "analysis" && (
            <div>
              {analyzing && !analysisResult && (
                <div className="text-center py-12">
                  <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-gray-500">{analysisPhase || "分析进行中..."}</p>
                  <p className="text-xs text-gray-400 mt-1">四阶段深度分析通常需要 15-30 秒</p>
                </div>
              )}
              {analysisResult && (
                <div className="space-y-5">
                  {/* Overview Card */}
                  <section className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-lg p-5 border border-indigo-100">
                    <h3 className="text-sm font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                      <span className="w-1.5 h-5 bg-indigo-500 rounded-full" />
                      研究概览
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="研究问题" value={analysisResult.research_question} />
                      <Field label="核心贡献" value={analysisResult.core_contribution} />
                      <Field
                        label="方法类别"
                        value={METHOD_CATEGORY_LABELS[analysisResult.method_category] || analysisResult.method_category}
                      />
                      <Field label="样本期" value={analysisResult.data_used.sample_period} />
                      <Field label="市场" value={analysisResult.data_used.market === "china_a" ? "A股" : analysisResult.data_used.market} />
                      <Field label="频率" value={analysisResult.data_used.frequency} />
                      <Field label="股票池" value={analysisResult.data_used.universe} />
                      <Field label="资产类别" value={analysisResult.data_used.instruments.join(", ")} />
                    </div>
                    {analysisResult.benchmark_models.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-indigo-100">
                        <span className="text-xs text-gray-500">基准模型：</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {analysisResult.benchmark_models.map((m, i) => (
                            <span key={i} className="px-2 py-0.5 bg-white text-xs rounded border border-gray-200 text-gray-600">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Methodology */}
                  {analysisResult.methodology && (
                    <section className="bg-white rounded-lg p-5 border border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <span className="w-1.5 h-5 bg-emerald-500 rounded-full" />
                        方法论
                      </h3>

                      {analysisResult.methodology.analysis_points.length > 0 && (
                        <div className="mb-4">
                          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">核心数学洞察</h4>
                          <div className="relative pl-6 border-l-2 border-emerald-200 space-y-3">
                            {analysisResult.methodology.analysis_points.map((point, i) => (
                              <div key={i} className="relative">
                                <div className="absolute -left-[25px] top-1 w-4 h-4 rounded-full bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center">
                                  <span className="text-[9px] font-bold text-emerald-700">{i + 1}</span>
                                </div>
                                <div>
                                  <p
                                    className="text-sm font-medium text-gray-800 [&_.katex]:text-[0.95em]"
                                    dangerouslySetInnerHTML={{ __html: renderLatex(point.title as string) }}
                                  />
                                  <div
                                    className="text-xs text-gray-500 mt-0.5 leading-relaxed [&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex]:text-[0.95em]"
                                    dangerouslySetInnerHTML={{ __html: renderLatex(point.analysis as string) }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {analysisResult.methodology.factor_list.length > 0 && (
                        <div className="mb-4">
                          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                            因子列表（{analysisResult.methodology.factor_list.length} 个）
                          </h4>
                          <div className="space-y-2">
                            {analysisResult.methodology.factor_list.map((f, i) => (
                              <div key={i} className="bg-gray-50 rounded p-3 border border-gray-100">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-medium text-gray-800">{f.name}</span>
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-600">
                                    {f.type}
                                  </span>
                                  {f.raw_or_neutralized && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-600">
                                      {f.raw_or_neutralized}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-600">{f.construction}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {analysisResult.methodology.model_architecture && (
                        <div className="mb-4">
                          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">模型架构</h4>
                          <div className="bg-gray-50 rounded p-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                            <MiniField label="类型" value={analysisResult.methodology.model_architecture.type} />
                            <MiniField label="损失函数" value={analysisResult.methodology.model_architecture.loss_function} />
                            <MiniField label="正则化" value={analysisResult.methodology.model_architecture.regularization} />
                            <MiniField label="训练方案" value={analysisResult.methodology.model_architecture.training_scheme} />
                          </div>
                          {analysisResult.methodology.model_architecture.layers_or_structure && (
                            <p className="text-xs text-gray-600 mt-2 p-2 bg-gray-50 rounded">
                              {analysisResult.methodology.model_architecture.layers_or_structure}
                            </p>
                          )}
                        </div>
                      )}

                      {analysisResult.methodology.portfolio_construction && (
                        <div>
                          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">组合构建</h4>
                          <div className="bg-gray-50 rounded p-3 grid grid-cols-2 gap-2 text-xs">
                            <MiniField label="加权方式" value={analysisResult.methodology.portfolio_construction.weighting} />
                            <MiniField label="调仓频率" value={analysisResult.methodology.portfolio_construction.rebalance_frequency} />
                            <MiniField label="约束条件" value={analysisResult.methodology.portfolio_construction.constraints} />
                            <MiniField label="交易成本" value={analysisResult.methodology.portfolio_construction.transaction_cost_model || "未提及"} />
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  {/* Equations */}
                  {analysisResult.equations.length > 0 && (
                    <section className="bg-white rounded-lg p-5 border border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <span className="w-1.5 h-5 bg-purple-500 rounded-full" />
                        公式解读（{analysisResult.equations.length} 个）
                      </h3>
                      <div className="space-y-3">
                        {analysisResult.equations.map((eq) => (
                          <div key={eq.index} className={`rounded-lg p-4 border ${eq.is_key_formula ? "bg-purple-50/30 border-purple-200" : "bg-gray-50 border-gray-200"}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-medium text-gray-500">
                                公式 {eq.index + 1}
                                {eq.is_key_formula && (
                                  <span className="ml-2 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px]">关键公式</span>
                                )}
                              </span>
                            </div>
                            <div
                              className="overflow-x-auto py-2 [&_.katex-display]:my-1"
                              dangerouslySetInnerHTML={{
                                __html: (() => {
                                  try {
                                    return katex.renderToString(eq.latex, { displayMode: true, throwOnError: false });
                                  } catch {
                                    return `<code>${eq.latex}</code>`;
                                  }
                                })(),
                              }}
                            />
                            <p className="text-sm text-gray-700 mt-2"><strong>含义：</strong>{eq.meaning}</p>
                            <p className="text-xs text-gray-500 mt-1"><strong>作用：</strong>{eq.role_in_paper}</p>
                            {Object.keys(eq.symbols).length > 0 && (
                              <div className="mt-2 border-t border-gray-200 pt-2">
                                <span className="text-[10px] text-gray-400 uppercase">符号说明</span>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1">
                                  {Object.entries(eq.symbols).map(([sym, desc]) => (
                                    <div key={sym} className="text-xs">
                                      <code className="text-[11px] bg-gray-100 px-1 rounded">{sym}</code>
                                      <span className="text-gray-500 ml-1">{desc}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Assessment */}
                  {analysisResult.assessment && (
                    <section className="bg-white rounded-lg p-5 border border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <span className="w-1.5 h-5 bg-rose-500 rounded-full" />
                        综合评估
                      </h3>

                      {/* Quality Score */}
                      <div className="flex items-center gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                        <div className="text-center">
                          <div className="text-3xl font-bold text-indigo-600">
                            {(analysisResult.assessment.overall_quality_score * 100).toFixed(0)}
                          </div>
                          <div className="text-[10px] text-gray-400">质量评分</div>
                        </div>
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <ScoreBar label="可复现性" level={analysisResult.assessment.reproducibility.level} />
                          <ScoreBar label="前视偏差" level={analysisResult.assessment.bias_risks.look_ahead_bias} invert />
                          <ScoreBar label="幸存者偏差" level={analysisResult.assessment.bias_risks.survivorship_bias} invert />
                          <ScoreBar label="数据挖掘" level={analysisResult.assessment.bias_risks.data_snooping} invert />
                        </div>
                      </div>

                      {/* Strengths & Weaknesses */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <h4 className="text-xs font-medium text-emerald-600 uppercase mb-2">优势</h4>
                          <ul className="space-y-1">
                            {analysisResult.assessment.strengths.map((s, i) => (
                              <li key={i} className="text-xs text-gray-700 flex gap-2">
                                <span className="text-emerald-400 shrink-0">+</span>
                                <span dangerouslySetInnerHTML={{ __html: renderLatex(s) }} />
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 className="text-xs font-medium text-rose-600 uppercase mb-2">不足</h4>
                          <ul className="space-y-1">
                            {analysisResult.assessment.weaknesses.map((w, i) => (
                              <li key={i} className="text-xs text-gray-700 flex gap-2">
                                <span className="text-rose-400 shrink-0">-</span>
                                <span dangerouslySetInnerHTML={{ __html: renderLatex(w) }} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {/* Reproducibility */}
                      <div className="mb-4 p-3 bg-gray-50 rounded">
                        <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">可复现性</h4>
                        <div className="flex items-center gap-4 text-xs">
                          <Badge label="数据来源" ok={analysisResult.assessment.reproducibility.has_data_source} />
                          <Badge label="代码开源" ok={analysisResult.assessment.reproducibility.has_code_available} />
                          <span className="text-gray-400">|</span>
                          <span className="text-gray-600">
                            评级：<span className="font-medium">{analysisResult.assessment.reproducibility.level}</span>
                          </span>
                        </div>
                        {analysisResult.assessment.reproducibility.missing_details.length > 0 && (
                          <div className="mt-2">
                            <span className="text-[10px] text-rose-500">缺失信息：</span>
                            {analysisResult.assessment.reproducibility.missing_details.map((d, i) => (
                              <span key={i} className="ml-1 text-xs text-gray-500">{d}{i < analysisResult.assessment!.reproducibility.missing_details.length - 1 ? "、": ""}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Overfitting */}
                      {analysisResult.assessment.bias_risks.overfitting_concern && analysisResult.assessment.bias_risks.overfitting_concern !== "none" && (
                        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                          <span className="font-medium">过拟合风险：</span>
                          {analysisResult.assessment.bias_risks.overfitting_concern}
                        </div>
                      )}

                      {/* A-Share */}
                      {analysisResult.assessment.a_share_applicability && (
                        <div className="mb-4 p-3 bg-blue-50 rounded">
                          <h4 className="text-xs font-medium text-blue-600 uppercase mb-2">A股适用性</h4>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge label="直接适用" ok={analysisResult.assessment.a_share_applicability.directly_applicable} />
                          </div>
                          {analysisResult.assessment.a_share_applicability.adaptations_needed.length > 0 && (
                            <div className="text-xs text-gray-600 mt-1">
                              <span className="font-medium">需调整：</span>
                              {analysisResult.assessment.a_share_applicability.adaptations_needed.join("、")}
                            </div>
                          )}
                          {analysisResult.assessment.a_share_applicability.key_constraints.length > 0 && (
                            <div className="text-xs text-gray-600 mt-1">
                              <span className="font-medium">关键限制：</span>
                              {analysisResult.assessment.a_share_applicability.key_constraints.join("、")}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Key Contributions */}
                      {analysisResult.assessment.key_contributions.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">关键贡献</h4>
                          <ul className="space-y-1">
                            {analysisResult.assessment.key_contributions.map((c, i) => (
                              <li key={i} className="text-xs text-gray-700 flex gap-2">
                                <span className="text-indigo-400 shrink-0 font-bold">{i + 1}.</span>
                                <span dangerouslySetInnerHTML={{ __html: renderLatex(c) }} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Equations Tab */}
          {activeTab === "equations" && (
            <div className="space-y-3">
              {parsedEquations.map((eq, i) => (
                <div key={i} className={`rounded-lg p-4 border ${eq.is_key_formula ? "bg-purple-50/30 border-purple-200" : "bg-gray-50 border-gray-200"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500">公式 {i + 1}</span>
                      {eq.is_key_formula && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-700 font-medium">关键公式</span>
                      )}
                    </span>
                    {eq.page_idx !== undefined && (
                      <span className="text-xs text-gray-400">第 {eq.page_idx + 1} 页</span>
                    )}
                  </div>
                  <div
                    className="overflow-x-auto py-2 [&_.katex-display]:my-1"
                    dangerouslySetInnerHTML={{
                      __html: (() => {
                        try {
                          return katex.renderToString(eq.latex, {
                            displayMode: true,
                            throwOnError: false,
                          });
                        } catch {
                          return `<code>${eq.latex}</code>`;
                        }
                      })(),
                    }}
                  />
                  {eq.meaning && (
                    <p className="text-sm text-gray-700 mt-3 bg-white rounded p-2 border border-gray-100">
                      <strong>含义：</strong>{eq.meaning}
                    </p>
                  )}
                  {eq.role_in_paper && (
                    <p className="text-xs text-gray-500 mt-1"><strong>作用：</strong>{eq.role_in_paper}</p>
                  )}
                  {eq.symbols && Object.keys(eq.symbols).length > 0 && (
                    <div className="mt-2 border-t border-gray-200 pt-2">
                      <span className="text-[10px] text-gray-400 uppercase">符号说明</span>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1">
                        {Object.entries(eq.symbols).map(([sym, desc]) => (
                          <div key={sym} className="text-xs">
                            <code className="text-[11px] bg-gray-100 px-1 rounded">{sym}</code>
                            <span className="text-gray-500 ml-1">{desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {eq.text && !eq.meaning && (
                    <p className="text-xs text-gray-500 mt-2 border-t border-gray-200 pt-2">
                      {eq.text}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Tables Tab */}
          {activeTab === "tables" && (
            <div className="space-y-4">
              {parsedTables.map((table, i) => {
                const caption = table.table_caption?.join(", ");
                return (
                  <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600 flex items-center justify-between">
                      <span>
                        表 {i + 1}{caption ? `：${caption}` : ""}
                      </span>
                      {table.page_idx !== undefined && (
                        <span className="text-gray-400">第 {table.page_idx + 1} 页</span>
                      )}
                    </div>
                    <div
                      className="p-3 overflow-x-auto text-xs [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-gray-200 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-gray-50 [&_th]:font-medium [&_tr]:hover:bg-gray-50/50 [&_.katex-display]:my-1 [&_.katex]:text-[0.95em]"
                      dangerouslySetInnerHTML={{ __html: renderLatex(table.table_body) }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Full Text Tab */}
          {activeTab === "fulltext" && report.full_text && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">
                  共 {report.full_text.length.toLocaleString()} 字
                </span>
                <button
                  onClick={() => setShowFullText(!showFullText)}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  {showFullText ? "收起" : "展开全文"}
                </button>
              </div>
              {showFullText ? (
                <div className="bg-gray-50 rounded-lg p-4 max-h-[600px] overflow-y-auto">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">
                    {report.full_text}
                  </pre>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">
                    {report.full_text.slice(0, 1000)}...
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* PDF Tab */}
          {activeTab === "pdf" && (
            <div className="rounded-lg border border-gray-200 overflow-hidden" style={{ height: "80vh" }}>
              {pdfBlobUrl ? (
                <iframe
                  src={pdfBlobUrl}
                  className="w-full h-full"
                  title="PDF Viewer"
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="w-5 h-5 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin mr-2" />
                  <span className="text-gray-400 text-sm">加载 PDF...</span>
                </div>
              )}
            </div>
          )}
        </div>
        {!report.abstract && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
            暂无文本内容
            {report.source_url && " — 可点击来源链接查看原文"}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] text-gray-400 uppercase">{label}</div>
      <div className="text-sm text-gray-700 mt-0.5 truncate">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] text-gray-400 uppercase">{label}</dt>
      <dd className="text-sm text-gray-700 mt-0.5">{value}</dd>
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-[10px] text-gray-400">{label}：</span>
      <span className="text-xs text-gray-700">{value}</span>
    </div>
  );
}

function ScoreBar({ label, level, invert }: { label: string; level: string; invert?: boolean }) {
  const riskLevels: Record<string, number> = {
    none: 0, low: 1, medium: 2, high: 3, unknown: -1,
  };
  const reproLevels: Record<string, number> = {
    high: 3, medium: 2, low: 1, unknown: -1,
  };
  const levels = invert ? riskLevels : reproLevels;
  const val = levels[level] ?? -1;
  const max = 3;
  const colors = invert
    ? ["bg-emerald-400", "bg-emerald-400", "bg-amber-400", "bg-red-400"]
    : ["bg-red-400", "bg-amber-400", "bg-emerald-400", "bg-emerald-400"];

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-gray-400">{label}</span>
        <span className="text-[10px] text-gray-500">{level}</span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded ${val >= 0 && i < val ? colors[i] : "bg-gray-200"}`}
          />
        ))}
      </div>
    </div>
  );
}

function Badge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] ${ok ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm rounded-lg transition-colors ${
        active
          ? "bg-indigo-100 text-indigo-700 font-medium"
          : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}
