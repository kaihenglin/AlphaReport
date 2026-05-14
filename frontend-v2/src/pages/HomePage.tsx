import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { startCollection } from "../services/api";
import type { UserCriteria, SourceType } from "../types";
import { SOURCE_LABELS } from "../types";

const QUICK_TOPICS = [
  "量化策略", "因子模型", "高频交易", "风险模型", "AI/机器学习",
  "执行算法", "组合优化", "统计套利", "波动率", "另类数据",
  "market microstructure", "factor investing", "portfolio optimization",
];

const AVAILABLE_SOURCES: SourceType[] = ["local_pdf", "arxiv", "eastmoney", "bigquant"];

export default function HomePage() {
  const navigate = useNavigate();
  const [topics, setTopics] = useState<string[]>([]);
  const [customTopic, setCustomTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [sources, setSources] = useState<SourceType[]>(["arxiv", "eastmoney", "bigquant"]);
  const [maxResults, setMaxResults] = useState(20);
  const [dateFrom, setDateFrom] = useState("2026-01-01");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleTopic = (t: string) => {
    setTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const addCustomTopic = () => {
    const trimmed = customTopic.trim();
    if (trimmed && !topics.includes(trimmed)) {
      setTopics((prev) => [...prev, trimmed]);
      setCustomTopic("");
    }
  };

  const toggleSource = (s: SourceType) => {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const handleSubmit = async () => {
    if (topics.length === 0) {
      setError("请至少选择一个研究主题");
      return;
    }
    if (sources.length === 0) {
      setError("请至少选择一个数据源");
      return;
    }

    setError("");
    setLoading(true);

    const criteria: UserCriteria = {
      topics,
      sources,
      keywords: keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      max_results_per_source: maxResults,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      journals: [],
      brokers: [],
    };

    try {
      const res = await startCollection(criteria);
      if (res.success && res.data) {
        navigate(`/tasks?active=${res.data.task_id}`);
      } else {
        setError(res.error || "启动失败");
      }
    } catch (e) {
      setError("网络错误，请检查后端服务是否启动");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">收集研报</h1>
        <p className="text-gray-500 mt-1">
          定义搜索标准，Agent 将自动从多个来源收集并分类研报
        </p>
      </div>

      {/* Topics */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">研究主题</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_TOPICS.map((t) => (
            <button
              key={t}
              onClick={() => toggleTopic(t)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                topics.includes(t)
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={customTopic}
            onChange={(e) => setCustomTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomTopic()}
            placeholder="自定义主题..."
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <button
            onClick={addCustomTopic}
            className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            添加
          </button>
        </div>
        {topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs"
              >
                {t}
                <button onClick={() => toggleTopic(t)} className="hover:text-indigo-900">
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Sources */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">数据源</h2>
        <div className="flex flex-wrap gap-3">
          {AVAILABLE_SOURCES.map((s) => (
            <label
              key={s}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                sources.includes(s)
                  ? "bg-indigo-50 border-indigo-300"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="checkbox"
                checked={sources.includes(s)}
                onChange={() => toggleSource(s)}
                className="rounded text-indigo-600"
              />
              <span className="text-sm">{SOURCE_LABELS[s]}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Keywords & Settings */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">高级选项</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">附加关键词 (逗号分隔)</label>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="如: Barra, momentum, 动量..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              每个数据源最大结果数
            </label>
            <input
              type="number"
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              min={1}
              max={100}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">开始日期</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">结束日期</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="默认至今"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "启动中..." : "开始收集"}
      </button>
    </div>
  );
}
