import { useState, useEffect, useRef, useCallback } from "react";
import Markdown from "react-markdown";
import type { ChatMessage, ToolCallEvent, ChatConversation } from "../types";
import { CHAT_STREAM_URL, getConversations, deleteConversation } from "../services/api";

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
        思考过程
      </button>
      {open && (
        <div className="mt-1 p-2 bg-purple-50 border border-purple-200 rounded text-xs text-purple-800 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ tc }: { tc: ToolCallEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 border border-amber-200 bg-amber-50 rounded-lg p-2 text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-amber-700 font-medium w-full text-left"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
        <span className="font-mono">{tc.name}</span>
        {tc.result ? (
          <span className="ml-auto text-green-600">done</span>
        ) : (
          <span className="ml-auto text-amber-600 animate-pulse">running...</span>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div>
            <div className="text-amber-600 mb-1">Args:</div>
            <pre className="bg-white p-2 rounded text-xs overflow-x-auto">
              {JSON.stringify(tc.args, null, 2)}
            </pre>
          </div>
          {tc.result && (
            <div>
              <div className="text-green-600 mb-1">Result:</div>
              <pre className="bg-white p-2 rounded text-xs overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                {tc.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="bg-indigo-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-[75%] whitespace-pre-wrap text-sm">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-2.5 max-w-[85%] text-sm shadow-sm">
        {msg.thinking && <ThinkingBlock content={msg.thinking} />}
        {msg.toolCalls?.map((tc, i) => <ToolCallBlock key={i} tc={tc} />)}
        {msg.content && (
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:bg-gray-50 prose-pre:text-xs">
            <Markdown>{msg.content}</Markdown>
          </div>
        )}
        {msg.isStreaming && !msg.content && !msg.thinking && (
          <div className="flex items-center gap-2 text-gray-400 text-xs py-1">
            <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
            思考中...
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: ChatConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="w-56 flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col h-full">
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full py-2 px-3 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          + 新对话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center rounded-lg px-3 py-2 mb-1 cursor-pointer text-sm transition-colors ${
              c.id === activeId
                ? "bg-indigo-100 text-indigo-800"
                : "text-gray-600 hover:bg-gray-100"
            }`}
            onClick={() => onSelect(c.id)}
          >
            <span className="flex-1 truncate">{c.title || "新对话"}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-1 text-xs"
              title="删除"
            >
              &#10005;
            </button>
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="text-center text-gray-400 text-xs py-6">暂无对话</div>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    const res = await getConversations();
    if (res.success && res.data) {
      setConversations(res.data.conversations);
    }
  };

  const handleNewConversation = () => {
    setConversationId(null);
    setMessages([]);
  };

  const handleSelectConversation = (id: string) => {
    setConversationId(id);
    setMessages([]);
    // Load conversation messages from backend
    fetch(`/api/v1/chat/conversations/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data) {
          const msgs: ChatMessage[] = res.data.messages.map(
            (m: { role: string; content: string }, i: number) => ({
              id: `${id}-${i}`,
              role: m.role as "user" | "assistant",
              content: m.content,
              timestamp: Date.now(),
            })
          );
          setMessages(msgs);
        }
      });
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id);
    if (id === conversationId) {
      setConversationId(null);
      setMessages([]);
    }
    loadConversations();
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      thinking: "",
      toolCalls: [],
      timestamp: Date.now(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(CHAT_STREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: text,
        }),
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

            setMessages((prev) => {
              const updated = [...prev];
              const last = { ...updated[updated.length - 1] };

              switch (evt.type) {
                case "token":
                  last.content = (last.content || "") + evt.content;
                  break;
                case "thinking":
                  last.thinking = (last.thinking || "") + evt.content;
                  break;
                case "tool_call":
                  last.toolCalls = [
                    ...(last.toolCalls || []),
                    { name: evt.name, args: evt.args },
                  ];
                  break;
                case "tool_result": {
                  const calls = [...(last.toolCalls || [])];
                  for (let i = calls.length - 1; i >= 0; i--) {
                    if (calls[i].name === evt.name && !calls[i].result) {
                      calls[i] = { ...calls[i], result: evt.result };
                      break;
                    }
                  }
                  last.toolCalls = calls;
                  break;
                }
                case "done":
                  last.isStreaming = false;
                  if (evt.conversation_id && !conversationId) {
                    setConversationId(evt.conversation_id);
                  }
                  loadConversations();
                  break;
                case "error":
                  last.content = (last.content || "") + `\n\n**Error:** ${evt.content}`;
                  last.isStreaming = false;
                  break;
              }

              updated[updated.length - 1] = last;
              return updated;
            });
          } catch {
            // skip malformed lines
          }
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
      sendMessage();
    }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  return (
    <div className="fixed inset-0 top-14 flex bg-gray-50">
      <ConversationSidebar
        conversations={conversations}
        activeId={conversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="max-w-3xl mx-auto">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-20 text-gray-400">
                <div className="text-4xl mb-4">&#128172;</div>
                <div className="text-lg font-medium mb-2">ResearchAgent 智能助手</div>
                <div className="text-sm text-center max-w-md">
                  你可以让我收集研报、搜索研报库、分析研报内容，<br />
                  或搜索网络获取最新量化资讯。
                </div>
                <div className="mt-6 flex flex-wrap gap-2 justify-center">
                  {[
                    "帮我收集最新的因子模型研报",
                    "搜索研报库中关于高频交易的论文",
                    "分析一下ID为1的研报",
                    "搜索量化投资领域的最新进展",
                  ].map((hint) => (
                    <button
                      key={hint}
                      onClick={() => setInput(hint)}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-gray-100 hover:border-gray-300 transition-colors"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input area */}
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... (Shift+Enter 换行)"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent max-h-32 overflow-y-auto"
              style={{ minHeight: "42px" }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 128) + "px";
              }}
              disabled={streaming}
            />
            {streaming ? (
              <button
                onClick={stopStreaming}
                className="px-4 py-2.5 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition-colors flex-shrink-0"
              >
                停止
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
