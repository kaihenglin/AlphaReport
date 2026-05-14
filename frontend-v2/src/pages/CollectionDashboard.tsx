import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { getCollectionStatus, listCollectionTasks, cancelCollection } from "../services/api";
import type { CollectionTask } from "../types";

const PHASE_LABELS: Record<string, string> = {
  collecting: "收集中",
  classifying: "分类中",
  storing: "存储中",
  complete: "已完成",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-600",
};

export default function CollectionDashboard() {
  const [searchParams] = useSearchParams();
  const activeId = searchParams.get("active");

  const [tasks, setTasks] = useState<CollectionTask[]>([]);
  const [activeTask, setActiveTask] = useState<CollectionTask | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (!activeId) return;
    setCancelling(true);
    try {
      await cancelCollection(activeId);
      await fetchActive();
    } finally {
      setCancelling(false);
    }
  };

  const fetchTasks = useCallback(async () => {
    const res = await listCollectionTasks();
    if (res.success && res.data) {
      setTasks(res.data.tasks);
    }
  }, []);

  const fetchActive = useCallback(async () => {
    if (!activeId) return;
    const res = await getCollectionStatus(activeId);
    if (res.success && res.data) {
      setActiveTask(res.data as CollectionTask);
    }
  }, [activeId]);

  useEffect(() => {
    fetchTasks();
    fetchActive();
  }, [fetchTasks, fetchActive]);

  useEffect(() => {
    if (!activeId) return;
    if (activeTask?.status === "completed" || activeTask?.status === "failed") return;

    const interval = setInterval(fetchActive, 2000);
    return () => clearInterval(interval);
  }, [activeId, activeTask?.status, fetchActive]);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">任务监控</h1>

      {activeTask && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">当前任务</h2>
            <div className="flex items-center gap-2">
              {(activeTask.status === "running" || activeTask.status === "pending") && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  {cancelling ? "取消中..." : "取消任务"}
                </button>
              )}
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  STATUS_COLORS[activeTask.status] || ""
                }`}
              >
                {activeTask.status}
              </span>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-500 mb-1.5">
              <span>
                阶段: {PHASE_LABELS[activeTask.phase] || activeTask.phase}
              </span>
              <span>{activeTask.results_count} 篇研报</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5">
              <div
                className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500"
                style={{
                  width:
                    activeTask.phase === "complete"
                      ? "100%"
                      : activeTask.phase === "storing"
                      ? "75%"
                      : activeTask.phase === "classifying"
                      ? "50%"
                      : "25%",
                }}
              />
            </div>
          </div>

          <p className="text-sm text-gray-600">{activeTask.progress_message}</p>

          {activeTask.storage_result && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat
                label="新增"
                value={activeTask.storage_result.newly_added}
                color="text-green-600"
              />
              <Stat
                label="更新"
                value={activeTask.storage_result.updated}
                color="text-blue-600"
              />
              <Stat
                label="重复跳过"
                value={activeTask.storage_result.duplicate_skipped}
                color="text-gray-500"
              />
            </div>
          )}

          <div className="mt-3 text-xs text-gray-400">
            ID: {activeTask.task_id}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">历史任务</h2>
        </div>
        {tasks.length === 0 ? (
          <p className="p-6 text-center text-gray-400 text-sm">暂无任务</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {tasks.map((t) => (
              <div key={t.task_id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-700 truncate">
                    {t.task_id.slice(0, 8)}...
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {t.progress_message} &middot; {t.results_count} 篇
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  {(t.status === "running" || t.status === "pending") && (
                    <button
                      onClick={async () => {
                        await cancelCollection(t.task_id);
                        fetchTasks();
                      }}
                      className="px-2.5 py-1 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      取消
                    </button>
                  )}
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      STATUS_COLORS[t.status] || ""
                    }`}
                  >
                    {t.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
