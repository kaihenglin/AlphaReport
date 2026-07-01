import type { UserCriteria, ApiResponse, ReportSummary, ReportDetail, CollectionTask, ReportStats, ChatConversation, KnowledgeCard, EmailSubscription } from "../types";

const BASE = "/api/v1";
const EMAIL_KEY = "alphareport.email";

function authHeaders(): Record<string, string> {
  const email = localStorage.getItem(EMAIL_KEY) || "";
  return {
    "Content-Type": "application/json",
    "X-User-Email": email,
  };
}

async function request<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    headers: authHeaders(),
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

// ── Knowledge Card ──

export async function getKnowledgeCard(id: number, force: boolean = false) {
  return request<KnowledgeCard>(
    `${BASE}/reports/${id}/knowledge-card?force=${force}`,
    { method: "POST" }
  );
}

// ── Per-Paper Ask AI ──

// ── Per-Paper Ask AI ──

export const askPaperUrl = (id: number) => `${BASE}/reports/${id}/ask`;

// ── Email Settings ──

export async function getEmailConfig() {
  return request<{
    enabled: boolean;
    smtp_host: string;
    smtp_port: number;
    from_addr: string;
    subscription_count: number;
  }>(`${BASE}/email/config`);
}

export async function sendTestEmail(email: string) {
  return request<{ success: boolean; message: string }>(
    `${BASE}/subscriptions/${encodeURIComponent(email)}/test`,
    { method: "POST" }
  );
}

// ── Subscriptions ──

export async function getSubscriptions() {
  return request<EmailSubscription[]>(`${BASE}/subscriptions`);
}

export async function getSubscription(email: string) {
  return request<EmailSubscription>(`${BASE}/subscriptions/${encodeURIComponent(email)}`);
}

export async function createSubscription(data: {
  email: string;
  user_id?: string;
  schedule_time?: string;
  schedule_weekdays?: string;
  schedule_enabled?: boolean;
}) {
  return request<EmailSubscription>(`${BASE}/subscriptions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteSubscription(email: string) {
  return request(`${BASE}/subscriptions/${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
}

export async function updateSubscriptionSchedule(
  email: string,
  data: { enabled?: boolean; schedule_time?: string; schedule_weekdays?: string }
) {
  return request<EmailSubscription>(
    `${BASE}/subscriptions/${encodeURIComponent(email)}/schedule`,
    { method: "PUT", body: JSON.stringify(data) }
  );
}

// ── Schedule Status ──

export interface SubscriptionScheduleInfo {
  user_id?: string;
  email: string;
  schedule_enabled: boolean;
  schedule_time: string;
  schedule_weekdays: string;
  next_run: string | null;
  direction_count: number;
}

export async function getScheduleStatus() {
  return request<{
    running: boolean;
    config_enabled: boolean;
    subscriptions: Record<string, SubscriptionScheduleInfo>;
  }>(`${BASE}/schedule`);
}
