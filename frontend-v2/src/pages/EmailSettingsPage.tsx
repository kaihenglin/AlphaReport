import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import {
  getEmailConfig,
  sendTestEmail,
  getSubscriptions,
  createSubscription,
  deleteSubscription,
  updateSubscriptionSchedule,
  getScheduleStatus,
} from "@/services/api";
import type { EmailSubscription } from "@/types";
import { WEEKDAY_LABELS } from "@/types";

export default function EmailSettingsPage() {
  useAuth(); // required for X-User-Email header via api.ts
  const [subscriptions, setSubscriptions] = useState<EmailSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<{
    enabled: boolean;
    smtp_host: string;
    smtp_port: number;
    from_addr: string;
  } | null>(null);

  // Add form
  const [newEmail, setNewEmail] = useState("");
  const [newTime, setNewTime] = useState("08:00");
  const [newWeekdays, setNewWeekdays] = useState("mon-fri");
  const [adding, setAdding] = useState(false);

  // Schedule status
  const [schedRunning, setSchedRunning] = useState(false);
  const [schedStatus, setSchedStatus] = useState<Record<string, { next_run: string | null }>>({});

  // Per-subscription editing state
  const [editingSchedule, setEditingSchedule] = useState<Record<string, {
    enabled: boolean; time: string; weekdays: string; saving: boolean;
  }>>({});

  const [testing, setTesting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadData = async () => {
    const [subsRes, configRes, schedRes] = await Promise.all([
      getSubscriptions(),
      getEmailConfig(),
      getScheduleStatus(),
    ]);
    if (subsRes.success && subsRes.data) {
      setSubscriptions(subsRes.data);
      // Initialize editing state
      const editing: Record<string, { enabled: boolean; time: string; weekdays: string; saving: boolean }> = {};
      for (const s of subsRes.data) {
        editing[s.email] = {
          enabled: s.schedule_enabled,
          time: s.schedule_time,
          weekdays: s.schedule_weekdays,
          saving: false,
        };
      }
      setEditingSchedule(editing);
    }
    if (configRes.success && configRes.data) {
      const c = configRes.data;
      setConfig({ enabled: c.enabled, smtp_host: c.smtp_host, smtp_port: c.smtp_port, from_addr: c.from_addr });
    }
    if (schedRes.success && schedRes.data) {
      setSchedRunning(schedRes.data.running);
      const status: Record<string, { next_run: string | null }> = {};
      for (const [email, info] of Object.entries(schedRes.data.subscriptions)) {
        status[email] = { next_run: info.next_run };
      }
      setSchedStatus(status);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  // ── Actions ──

  const handleAdd = async () => {
    const email = newEmail.trim();
    if (!email) return;
    setAdding(true);
    try {
      const res = await createSubscription({
        email,
        schedule_time: newTime,
        schedule_weekdays: newWeekdays,
        schedule_enabled: true,
      });
      if (res.success) {
        setNewEmail("");
        showMsg("success", `已创建 ${email} 的订阅`);
        await loadData();
      } else {
        showMsg("error", res.error || "创建失败");
      }
    } catch {
      showMsg("error", "请求失败");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (email: string) => {
    await deleteSubscription(email);
    setSubscriptions((prev) => prev.filter((s) => s.email !== email));
    showMsg("success", `已删除 ${email}`);
  };

  const handleSaveSchedule = async (email: string) => {
    const edit = editingSchedule[email];
    if (!edit) return;
    setEditingSchedule((prev) => ({ ...prev, [email]: { ...prev[email], saving: true } }));
    try {
      await updateSubscriptionSchedule(email, {
        enabled: edit.enabled,
        schedule_time: edit.time,
        schedule_weekdays: edit.weekdays,
      });
      showMsg("success", edit.enabled ? `${email} 定时推送已更新` : `${email} 推送已关闭`);
      await loadData();
    } catch {
      showMsg("error", "保存失败");
    } finally {
      setEditingSchedule((prev) => ({ ...prev, [email]: { ...prev[email], saving: false } }));
    }
  };

  const handleTest = async (email: string) => {
    setTesting(email);
    try {
      const res = await sendTestEmail(email);
      showMsg(res.success ? "success" : "error", res.message || (res.error ?? "发送失败"));
    } catch {
      showMsg("error", "请求失败");
    } finally {
      setTesting(null);
    }
  };

  const formatNextRun = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    } catch {
      return iso;
    }
  };

  // ── Render ──

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-lg font-semibold">邮件推送设置</h1>

      {/* SMTP Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            SMTP 配置状态
            <Badge variant={config?.enabled ? "default" : "secondary"} className="text-xs">
              {config?.enabled ? "已启用" : "未启用"}
            </Badge>
            {schedRunning && (
              <Badge variant="default" className="text-xs bg-emerald-500 hover:bg-emerald-500">调度运行中</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          {loading ? (
            <div className="space-y-1">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-36" />
            </div>
          ) : config ? (
            <>
              <p>SMTP 服务器：{config.smtp_host}:{config.smtp_port}</p>
              <p>发件地址：{config.from_addr || "（使用环境变量）"}</p>
              <p>订阅数量：{subscriptions.length}</p>
              {!config.enabled && (
                <p className="text-amber-600">邮件服务未启用，请设置环境变量后启动。</p>
              )}
            </>
          ) : (
            <p>无法获取配置</p>
          )}
        </CardContent>
      </Card>

      {/* Add Subscription */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">添加订阅</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground block mb-1">邮箱地址</label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">推送时间</label>
              <Input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-32 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">重复</label>
              <select
                value={newWeekdays}
                onChange={(e) => setNewWeekdays(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {Object.entries(WEEKDAY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={handleAdd} disabled={adding || !newEmail.trim()}>
              {adding ? "添加中..." : "添加"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Subscription List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            订阅列表
            {subscriptions.length > 0 && (
              <span className="text-muted-foreground font-normal ml-1">({subscriptions.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无订阅，请在上方添加</p>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => {
                const edit = editingSchedule[sub.email];
                const sched = schedStatus[sub.email];
                const directionNames = Object.keys(sub.directions || {});

                return (
                  <div
                    key={sub.email}
                    className="border rounded-lg p-4 space-y-3"
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{sub.email}</span>
                        {directionNames.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            ({directionNames.length} 个研究方向)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleTest(sub.email)}
                          disabled={testing === sub.email}
                        >
                          {testing === sub.email ? "发送中..." : "测试"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={() => handleDelete(sub.email)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>

                    {/* Schedule controls */}
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={edit?.enabled ?? false}
                          onChange={(e) =>
                            setEditingSchedule((prev) => ({
                              ...prev,
                              [sub.email]: { ...prev[sub.email], enabled: e.target.checked },
                            }))
                          }
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <span className="text-xs">启用推送</span>
                      </label>
                      <Input
                        type="time"
                        value={edit?.time || "08:00"}
                        onChange={(e) =>
                          setEditingSchedule((prev) => ({
                            ...prev,
                            [sub.email]: { ...prev[sub.email], time: e.target.value },
                          }))
                        }
                        className="w-28 text-xs h-8"
                        disabled={!edit?.enabled}
                      />
                      <select
                        value={edit?.weekdays || "mon-fri"}
                        onChange={(e) =>
                          setEditingSchedule((prev) => ({
                            ...prev,
                            [sub.email]: { ...prev[sub.email], weekdays: e.target.value },
                          }))
                        }
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
                        disabled={!edit?.enabled}
                      >
                        {Object.entries(WEEKDAY_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleSaveSchedule(sub.email)}
                        disabled={edit?.saving}
                      >
                        {edit?.saving ? "保存中..." : "保存"}
                      </Button>
                    </div>

                    {/* Next run */}
                    <p className="text-xs text-muted-foreground">
                      下次推送：{formatNextRun(sched?.next_run ?? null)}
                    </p>

                    {/* Directions */}
                    {directionNames.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">研究方向：</span>
                        {directionNames.map((name) => {
                          const dir = sub.directions[name];
                          return (
                            <Badge key={name} variant="secondary" className="text-xs">
                              {name}
                              {dir?.keywords?.length ? ` (${dir.keywords.slice(0, 2).join(", ")})` : ""}
                            </Badge>
                          );
                        })}
                        <span className="text-xs text-muted-foreground ml-1">
                          通过 Agent 对话设置
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Toast */}
      {message && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm shadow-lg ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-600 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
