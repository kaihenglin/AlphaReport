import { useState, useRef, useEffect } from "react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { askPaperUrl } from "@/services/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export default function AskAI({ reportId }: { reportId: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendQuestion = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(askPaperUrl(reportId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
        signal: controller.signal,
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
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const evt = JSON.parse(raw);
            if (evt.type === "token") {
              setMessages((prev) => {
                const updated = [...prev];
                const last = { ...updated[updated.length - 1] };
                last.content = (last.content || "") + evt.content;
                updated[updated.length - 1] = last;
                return updated;
              });
            } else if (evt.type === "done") {
              setMessages((prev) => {
                const updated = [...prev];
                const last = { ...updated[updated.length - 1] };
                last.isStreaming = false;
                updated[updated.length - 1] = last;
                return updated;
              });
            } else if (evt.type === "error") {
              setMessages((prev) => {
                const updated = [...prev];
                const last = { ...updated[updated.length - 1] };
                last.content = `Error: ${evt.content}`;
                last.isStreaming = false;
                updated[updated.length - 1] = last;
                return updated;
              });
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => {
          const updated = [...prev];
          const last = { ...updated[updated.length - 1] };
          last.content = `连接失败: ${(err as Error).message}`;
          last.isStreaming = false;
          updated[updated.length - 1] = last;
          return updated;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <div className="text-3xl mb-3">&#x1F4AC;</div>
            <p className="text-sm font-medium">Ask AI about this paper</p>
            <p className="text-xs mt-1 text-center max-w-xs">
              Ask questions about methodology, findings, data, or anything related to this paper
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {[
                "这篇论文的核心贡献是什么？",
                "方法论的优缺点是什么？",
                "论文使用了什么数据？",
                "有哪些实践启示？",
              ].map((hint) => (
                <button
                  key={hint}
                  onClick={() => { setInput(hint); }}
                  className="px-3 py-1.5 border border-border rounded-full text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted/50 border border-border rounded-bl-sm"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2">
                      <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.content}</Markdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                  {msg.isStreaming && !msg.content && (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse" />
                      <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse delay-150" />
                      <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse delay-300" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about this paper..."
            rows={1}
            disabled={streaming}
            className="min-h-[40px] resize-none text-sm"
          />
          <Button
            size="sm"
            onClick={sendQuestion}
            disabled={!input.trim() || streaming}
          >
            {streaming ? "..." : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
