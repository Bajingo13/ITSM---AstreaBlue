import { useState } from "react";
import { Bot, X, Send, Sparkles } from "lucide-react";

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hello! I'm your AstreaBlue AI Assistant. I can help summarize tickets, check SLA risks, and review asset alerts.",
    },
  ]);
  const [input, setInput] = useState("");

  const sendMessage = () => {
    if (!input.trim()) return;

    const userMessage = input;

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I'm analyzing your ITSM data. Once connected to the backend, I can provide real ticket summaries, SLA risks, and asset recommendations.",
        },
      ]);
    }, 600);
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-700 to-violet-700 px-5 py-3 text-sm font-bold text-white shadow-2xl shadow-blue-900/30 transition hover:-translate-y-0.5"
        >
          <Sparkles size={18} />
          AstreaBlue AI
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[520px] w-[380px] flex-col overflow-hidden rounded-3xl border border-blue-900/30 bg-slate-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-blue-900/30 bg-gradient-to-r from-slate-950 to-blue-950 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 text-white">
                <Bot size={20} />
              </div>
              <div>
                <h3 className="font-bold text-white">AstreaBlue AI</h3>
                <p className="text-xs text-emerald-400">Online</p>
              </div>
            </div>

            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                    msg.role === "user"
                      ? "bg-blue-700 text-white"
                      : "border border-blue-900/30 bg-slate-900 text-slate-200"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-blue-900/30 p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {["SLA risks", "Critical tickets", "Asset alerts"].map((item) => (
                <button
                  key={item}
                  onClick={() => setInput(item)}
                  className="rounded-full border border-blue-800/40 px-3 py-1 text-xs text-blue-200 hover:bg-blue-900/40"
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Ask me anything..."
                className="flex-1 rounded-xl border border-blue-900/40 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
              />

              <button
                onClick={sendMessage}
                className="rounded-xl bg-blue-700 p-3 text-white hover:bg-blue-800"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}