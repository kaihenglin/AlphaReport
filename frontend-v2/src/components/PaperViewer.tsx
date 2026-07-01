import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SOURCE_LABELS,
  MARKET_LABELS,
  ASSET_LABELS,
  FREQUENCY_LABELS,
  TOPIC_LABELS,
} from "@/types";
import type { ReportDetail } from "@/types";

interface PaperViewerProps {
  report: ReportDetail;
}

export default function PaperViewer({ report }: PaperViewerProps) {
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoadingPdf(true);
    setPdfBlobUrl(null);

    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }

    fetch(`/api/v1/reports/${report.id}/pdf`, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error("PDF not available");
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setPdfBlobUrl(url);
        setLoadingPdf(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setLoadingPdf(false);
        }
      });

    return () => {
      ctrl.abort();
    };
  }, [report.id]);

  const allTags = [
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
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Metadata Header */}
      <div className="px-4 py-3 border-b shrink-0">
        <h1 className="text-base font-semibold leading-snug mb-1.5">
          {report.title}
        </h1>

        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          {report.authors.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {report.authors.join(", ")}
            </span>
          )}
          <Badge variant="secondary" className="text-xs">
            {SOURCE_LABELS[report.source] || report.source}
          </Badge>
          {report.published_date && (
            <span className="text-xs text-muted-foreground">
              {report.published_date.slice(0, 10)}
            </span>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((t, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {t.value}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* PDF Viewer */}
      <div className="flex-1 min-h-0 bg-muted/30">
        {loadingPdf && (
          <div className="flex items-center justify-center h-full gap-2">
            <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
            <span className="text-muted-foreground text-sm">加载 PDF...</span>
          </div>
        )}
        {!loadingPdf && !pdfBlobUrl && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
            <span className="text-2xl">📄</span>
            {report.source === "arxiv" && report.arxiv_id ? (
              <>
                <p className="text-sm">PDF 需从 arXiv 直接查看</p>
                <a
                  href={`https://arxiv.org/pdf/${report.arxiv_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="sm">
                    在 arXiv 打开 PDF
                  </Button>
                </a>
              </>
            ) : (
              <p className="text-sm">PDF 不可用</p>
            )}
            {report.abstract && (
              <p className="text-xs text-center max-w-md leading-relaxed line-clamp-6">
                {report.abstract}
              </p>
            )}
          </div>
        )}
        {pdfBlobUrl && (
          <iframe
            src={pdfBlobUrl}
            className="w-full h-full"
            title="PDF Viewer"
          />
        )}
      </div>
    </div>
  );
}
