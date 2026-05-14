import type { UserCriteria, ApiResponse, ReportSummary, ReportDetail, CollectionTask, ReportStats, ChatConversation } from "../types";

const BASE = "/api/v1";

async function request<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return res.json();
}

export async function startCollection(criteria: UserCriteria) {
  return request<{ task_id: string }>(`${BASE}/collection/start`, {
    method: "POST",
    body: JSON.stringify(criteria),
  });
}

export async function getCollectionStatus(taskId: string) {
  return request<CollectionTask>(`${BASE}/collection/${taskId}`);
}

export async function cancelCollection(taskId: string) {
  return request(`${BASE}/collection/${taskId}`, { method: "DELETE" });
}

export async function listCollectionTasks() {
  return request<{ tasks: CollectionTask[] }>(`${BASE}/collection/tasks/list`);
}

export interface ReportListParams {
  market?: string;
  asset_class?: string;
  frequency?: string;
  topic?: string;
  search?: string;
  source?: string;
  has_full_text?: boolean;
  sort_by?: string;
  limit?: number;
  offset?: number;
}

export async function getReports(params: ReportListParams = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  return request<{ reports: ReportSummary[]; total: number; limit: number; offset: number }>(
    `${BASE}/reports?${qs.toString()}`
  );
}

export async function getReport(id: number) {
  return request<ReportDetail>(`${BASE}/reports/${id}`);
}

export function summarizeReportStream(id: number): { url: string; method: string } {
  return { url: `${BASE}/reports/${id}/summarize`, method: "POST" };
}

export async function deepParseReport(id: number) {
  return request<{ tables_count: number; equations_count: number; full_text_length: number }>(
    `${BASE}/reports/${id}/parse`,
    { method: "POST" }
  );
}

export function analyzeReportStream(id: number, depth: string = "standard"): { url: string; method: string } {
  return { url: `${BASE}/reports/${id}/analyze?depth=${depth}`, method: "POST" };
}

export async function deleteReport(id: number) {
  return request(`${BASE}/reports/${id}`, { method: "DELETE" });
}

export async function getReportStats() {
  return request<ReportStats>(`${BASE}/reports/stats`);
}

export async function getTaxonomy() {
  return request<{ taxonomy: Record<string, unknown> }>(`${BASE}/classification/taxonomy`);
}

export function connectCollectionWs(
  taskId: string,
  onMessage: (data: unknown) => void,
  onClose?: () => void
): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/collection/${taskId}`);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      onMessage(e.data);
    }
  };
  ws.onclose = () => onClose?.();
  return ws;
}

// ── Chat ──

export const CHAT_STREAM_URL = `${BASE}/chat/stream`;

export async function getConversations() {
  return request<{ conversations: ChatConversation[] }>(`${BASE}/chat/conversations`);
}

export async function deleteConversation(id: string) {
  return request(`${BASE}/chat/conversations/${id}`, { method: "DELETE" });
}
