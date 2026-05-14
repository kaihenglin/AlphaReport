import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { getReports, getReportStats, deleteReport } from "../services/api";
import type { ReportSummary, ReportStats } from "../types";
import {
  SOURCE_LABELS,
  MARKET_LABELS,
  ASSET_LABELS,
  FREQUENCY_LABELS,
  TOPIC_LABELS,
} from "../types";

const FILTERS = [
  { key: "market", label: "市场", options: MARKET_LABELS },
  { key: "asset_class", label: "资产", options: ASSET_LABELS },
  { key: "frequency", label: "频率", options: FREQUENCY_LABELS },
  { key: "topic", label: "主题", options: TOPIC_LABELS },
] as const;

export default function ReportLibraryPage() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const limit = 20;

  const fetchReports = useCallback(async () => {
    setLoading(true);
    const res = await getReports({
      search: search || undefined,
      ...filters,
      limit,
      offset,
    });
    if (res.success && res.data) {
      setReports(res.data.reports);
      setTotal(res.data.total);
    }
    setLoading(false);
  }, [search, filters, offset]);

  const fetchStats = useCallback(async () => {
    const res = await getReportStats();
    if (res.success && res.data) setStats(res.data as ReportStats);
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === reports.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(reports.map((r) => r.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`确定删除选中的 ${selected.size} 篇研报？此操作不可撤销。`)) return;
    setDeleting(true);
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => deleteReport(id)));
    setSelected(new Set());
    setDeleting(false);
    fetchReports();
    fetchStats();
  };

  const handleSingleDelete = async (id: number, title: string) => {
    if (!confirm(`确定删除「${title.slice(0, 40)}...」？`)) return;
    await deleteReport(id);
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    fetchReports();
    fetchStats();
  };

  const setFilter = (key: string, val: string) => {
    setOffset(0);
    setFilters((prev) => {
      if (prev[key] === val) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: val };
    });
  };

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 hidden lg:block">
        {stats && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <div className="text-2xl font-bold text-gray-900">{stats.total_reports}</div>
            <div className="text-xs text-gray-500">总研报数</div>
            <div className="mt-2 flex gap-3 text-xs text-gray-500">
              <span>{stats.with_full_text} 全文</span>
              <span>{stats.without_full_text} 摘要</span>
            </div>
          </div>
        )}

        {FILTERS.map(({ key, label, options }) => (
          <div key={key} className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
              {label}
            </h3>
            <div className="space-y-1">
              {Object.entries(options).map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setFilter(key, val)}
                  className={`block w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                    filters[key] === val
                      ? "bg-indigo-50 text-indigo-700 font-medium"
                      : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-4">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            placeholder="搜索标题或摘要..."
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {Object.keys(filters).length > 0 && (
            <button
              onClick={() => setFilters({})}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              清除筛选
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {Object.keys(filters).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {Object.entries(filters).map(([k, v]) => {
              const dim = FILTERS.find((f) => f.key === k);
              const label = dim
                ? (dim.options as Record<string, string>)[v] || v
                : v;
              return (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs"
                >
                  {label}
                  <button onClick={() => setFilter(k, v)}>&times;</button>
                </span>
              );
            })}
          </div>
        )}

        {/* Batch actions bar */}
        {reports.length > 0 && (
          <div className="flex items-center gap-3 mb-3">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={reports.length > 0 && selected.size === reports.length}
                onChange={toggleSelectAll}
                className="rounded text-indigo-600"
              />
              全选
            </label>
            {selected.size > 0 && (
              <>
                <span className="text-xs text-gray-400">
                  已选 {selected.size} 篇
                </span>
                <button
                  onClick={handleBatchDelete}
                  disabled={deleting}
                  className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
                >
                  {deleting ? "删除中..." : "删除选中"}
                </button>
              </>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-400">加载中...</div>
        ) : reports.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">暂无研报</p>
            <p className="text-xs text-gray-300 mt-1">
              前往「收集研报」页面开始收集
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {reports.map((r) => (
                <ReportCard
                  key={r.id}
                  report={r}
                  selected={selected.has(r.id)}
                  onToggleSelect={() => toggleSelect(r.id)}
                  onDelete={() => handleSingleDelete(r.id, r.title)}
                />
              ))}
            </div>

            {total > limit && (
              <div className="flex items-center justify-between mt-4 text-sm">
                <span className="text-gray-500">
                  {offset + 1}-{Math.min(offset + limit, total)} / {total}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    disabled={offset + limit >= total}
                    onClick={() => setOffset(offset + limit)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ReportCard({
  report,
  selected,
  onToggleSelect,
  onDelete,
}: {
  report: ReportSummary;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
}) {
  const dimTags = [
    ...report.markets.map((m) => MARKET_LABELS[m as keyof typeof MARKET_LABELS] || m),
    ...report.asset_classes.map(
      (a) => ASSET_LABELS[a as keyof typeof ASSET_LABELS] || a
    ),
    ...report.frequencies.map(
      (f) => FREQUENCY_LABELS[f as keyof typeof FREQUENCY_LABELS] || f
    ),
    ...report.topics.map((t) => TOPIC_LABELS[t as keyof typeof TOPIC_LABELS] || t),
  ].filter(Boolean);

  const customTags = report.custom_tags.filter(Boolean);

  return (
    <div
      className={`bg-white rounded-xl border p-4 transition-all ${
        selected ? "border-indigo-300 bg-indigo-50/30" : "border-gray-200 hover:border-indigo-200 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className="mt-1 rounded text-indigo-600 shrink-0 cursor-pointer"
        />

        {/* Content - clickable to detail */}
        <Link to={`/library/${report.id}`} className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-gray-900 text-sm leading-snug line-clamp-2">
                {report.title}
              </h3>
              {report.authors.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {report.authors.join(", ")}
                </p>
              )}
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1">
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                {SOURCE_LABELS[report.source] || report.source}
              </span>
              {report.has_full_text && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600">
                  全文
                </span>
              )}
            </div>
          </div>

          {report.abstract && (
            <p className="text-xs text-gray-500 mt-2 line-clamp-2 whitespace-pre-line">
              {report.abstract}
            </p>
          )}

          {(dimTags.length > 0 || customTags.length > 0) && (
            <div className="flex flex-wrap gap-1 mt-2">
              {dimTags.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[10px]"
                >
                  {t}
                </span>
              ))}
              {customTags.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="text-[10px] text-gray-300 mt-2">
            {report.published_date?.slice(0, 10) || report.created_at?.slice(0, 10)}
          </div>
        </Link>

        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="删除此研报"
          className="shrink-0 mt-1 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
