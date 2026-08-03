import { useEffect, useRef, useState } from "react";
import {
  Bot,
  BookOpen,
  Loader2,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../../config/api";
import { authHeaders } from "../../services/authHeaders";
import { useAuth } from "../../context/AuthContext";

function createWelcomeMessage(firstName) {
  return {
    role: "assistant",
    content: `Hello, ${firstName}! I'm Odysseus. What can I help you with?`,
    sources: [],
    welcome: true,
  };
}

const fallbackSuggestions = [
  "How many devices are currently sending screenshots?",
  "What is the latest USB and DLP activity?",
  "How do I troubleshoot an offline endpoint?",
  "How many tickets are currently in progress?",
  "How many hardware assets do we have?",
];

export default function AIAssistant() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const endRef = useRef(null);
  const firstName = String(user?.full_name || user?.name || "there").trim().split(/\s+/)[0];
  const welcomeMessage = useRef(createWelcomeMessage(firstName)).current;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([welcomeMessage]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState(fallbackSuggestions);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, sending]);

  useEffect(() => {
    if (!open || suggestionsLoaded) return;
    let active = true;

    fetch(`${API_URL}/api/v1/ai-assistant/suggestions`, {
      headers: authHeaders(),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Suggestions unavailable.");
        return payload;
      })
      .then((payload) => {
        const nextSuggestions = payload?.data?.suggestions;
        if (active && Array.isArray(nextSuggestions) && nextSuggestions.length) {
          setSuggestions(nextSuggestions);
        }
      })
      .catch(() => {
        // Keep the safe built-in prompts when suggestions cannot be loaded.
      })
      .finally(() => {
        if (active) setSuggestionsLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [open, suggestionsLoaded]);

  const submitFeedback = async (messageIndex, helpful) => {
    const message = messages[messageIndex];
    if (!message?.question || message.feedback || message.error) return;

    setMessages((current) =>
      current.map((item, index) =>
        index === messageIndex ? { ...item, feedback: helpful ? "helpful" : "not-helpful" } : item
      )
    );

    try {
      const response = await fetch(`${API_URL}/api/v1/ai-assistant/feedback`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          question: message.question,
          response_mode: message.mode || null,
          helpful,
        }),
      });
      if (!response.ok) throw new Error("Feedback could not be saved.");
    } catch {
      setMessages((current) =>
        current.map((item, index) =>
          index === messageIndex ? { ...item, feedback: null, feedbackError: true } : item
        )
      );
    }
  };

  const sendMessage = async (suggestedMessage) => {
    const userMessage = String(suggestedMessage ?? input).trim();
    if (!userMessage || sending) return;

    const previousHistory = messages
      .filter((message) => !message.welcome)
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
    const answerNumber = messages.filter(
      (message) => message.role === "assistant" && message.question && !message.error
    ).length + 1;

    setMessages((current) => [
      ...current,
      { role: "user", content: userMessage, sources: [] },
    ]);
    setInput("");
    setSending(true);

    try {
      const response = await fetch(`${API_URL}/api/v1/ai-assistant/chat`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: userMessage, history: previousHistory }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || "The assistant could not answer right now.");
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.data.answer,
          sources: payload.data.sources || [],
          notice: payload.data.notice || "",
          mode: payload.data.mode || "",
          dataContext: payload.data.data_context || null,
          question: userMessage,
          feedback: null,
          showFeedback: answerNumber % 5 === 0,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: error.message,
          sources: [],
          error: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Odysseus assistant"
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#2563EB_0%,#5B3FF2_100%)] px-5 py-3 text-sm font-bold text-white shadow-2xl shadow-blue-900/25 transition hover:-translate-y-1 hover:shadow-blue-900/35 focus:outline-none focus:ring-4 focus:ring-blue-200"
        >
          <Sparkles size={18} />
          Odysseus AI
        </button>
      )}

      {open && (
        <section
          aria-label="Odysseus assistant"
          className="fixed bottom-4 right-4 z-40 flex h-[min(660px,calc(100vh-32px))] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden rounded-[28px] border border-blue-100 bg-white shadow-2xl shadow-slate-900/30"
        >
          <header className="relative flex items-center justify-between overflow-hidden border-b border-blue-400/30 bg-[linear-gradient(135deg,#082954_0%,#145FA5_58%,#13A4DC_100%)] px-5 py-[18px]">
            <div className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full border-[18px] border-white/10" />
            <div className="relative flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/25 bg-white/15 text-white shadow-inner shadow-white/10">
                <Bot size={21} />
              </div>
              <div>
                <h2 className="text-base font-extrabold tracking-tight text-white">Odysseus AI</h2>
                <p className="mt-0.5 text-[11px] font-semibold text-blue-100">AstreaBlue workspace assistant</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="relative rounded-xl border border-white/25 bg-white/5 p-2 text-white transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/70"
            >
              <X size={19} />
            </button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#F0F7FF_0%,#F8FAFC_45%,#F8FAFC_100%)] p-4">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm leading-6 shadow-sm ${message.welcome ? "max-w-[92%] border-blue-100 bg-white/95 text-slate-700 shadow-blue-950/5" : "max-w-[88%]"} ${
                    message.role === "user"
                      ? "border-blue-600 bg-blue-600 text-white"
                      : message.error
                        ? "border-red-200 bg-red-50 text-red-800"
                        : message.welcome
                          ? ""
                          : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.sources?.length > 0 && (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-slate-500">
                        <BookOpen size={13} />
                        Sources
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {message.sources.map((source) => (
                          <button
                            type="button"
                            key={source.id}
                            title={source.title}
                            onClick={() => {
                              setOpen(false);
                              navigate("/knowledge-base");
                            }}
                            className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-left text-xs font-bold text-blue-700 transition hover:border-blue-400 hover:bg-blue-100"
                          >
                            {source.label} {source.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {message.role === "assistant" && message.question && message.showFeedback && !message.error && (
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                      <p className="text-xs font-semibold text-slate-500">
                        {message.feedback
                          ? "Thank you for the feedback."
                          : message.feedbackError
                            ? "Feedback was not saved. Please try again."
                            : "Was this helpful?"}
                      </p>
                      {!message.feedback && (
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => submitFeedback(index, true)}
                            aria-label="Mark answer helpful"
                            className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                          >
                            <ThumbsUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => submitFeedback(index, false)}
                            aria-label="Mark answer not helpful"
                            className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                          >
                            <ThumbsDown size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {messages.length === 1 && (
              <div className="rounded-2xl border border-blue-100 bg-white/75 p-3 shadow-sm shadow-blue-950/5 backdrop-blur-sm">
                <p className="mb-2.5 px-1 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Try asking</p>
                <div className="grid gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => sendMessage(suggestion)}
                      className="group flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-xs font-bold leading-5 text-slate-700 transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:shadow-sm"
                    >
                      <span>{suggestion}</span>
                      <Send size={13} className="shrink-0 text-slate-300 transition group-hover:text-blue-600" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
                  <Loader2 size={16} className="animate-spin text-blue-600" />
                  Checking AstreaBlue data...
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <footer className="border-t border-slate-200 bg-white/95 p-4 shadow-[0_-8px_24px_rgba(15,23,42,0.04)] backdrop-blur">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                rows={1}
                maxLength={2000}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Message Odysseus..."
                aria-label="Message Odysseus"
                className="max-h-28 min-h-12 flex-1 resize-none rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => sendMessage()}
                disabled={sending || !input.trim()}
                aria-label="Send question"
                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#2563EB_0%,#5B3FF2_100%)] text-white shadow-md shadow-blue-900/15 transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
