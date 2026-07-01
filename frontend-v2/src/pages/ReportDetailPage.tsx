import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getReport, deleteReport } from "@/services/api";
import type { ReportDetail } from "@/types";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import PaperViewer from "@/components/PaperViewer";
import KnowledgeCard from "@/components/KnowledgeCard";
import AskAI from "@/components/AskAI";

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getReport(Number(id)).then((res) => {
      if (res.success && res.data) setReport(res.data);
      setLoading(false);
    });
  }, [id]);

  const handleDelete = async () => {
    if (!report) return;
    if (!confirm(`确定删除「${report.title.slice(0, 40)}...」？此操作不可撤销。`)) return;
    await deleteReport(report.id);
    navigate("/library");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        加载中...
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">研报不存在</p>
        <Link to="/library" className="text-primary text-sm mt-2 inline-block">
          返回研报库
        </Link>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Top header bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0">
        <Link
          to="/library"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; 返回研报库
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDelete}
          className="text-xs"
        >
          删除
        </Button>
      </header>

      {/* Split panel area */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup
          orientation={isMobile ? "vertical" : "horizontal"}
          className="h-full"
        >
          {/* Left: PaperViewer */}
          <ResizablePanel defaultSize={isMobile ? 50 : 55} minSize={isMobile ? 20 : 30}>
            <PaperViewer report={report} />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right: Knowledge Card / Ask AI */}
          <ResizablePanel defaultSize={isMobile ? 50 : 45} minSize={isMobile ? 20 : 25}>
            <Tabs defaultValue="knowledge-card" className="h-full flex flex-col">
              <div className="px-4 pt-3">
                <TabsList className="w-full">
                  <TabsTrigger value="knowledge-card" className="flex-1 text-xs">
                    Knowledge Card
                  </TabsTrigger>
                  <TabsTrigger value="ask-ai" className="flex-1 text-xs">
                    Ask AI
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent
                value="knowledge-card"
                className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
              >
                <KnowledgeCard reportId={report.id} />
              </TabsContent>
              <TabsContent
                value="ask-ai"
                className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
              >
                <AskAI reportId={report.id} />
              </TabsContent>
            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
