import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  X,
} from "lucide-react";
import { registerAppDialogHandler } from "../../services/appDialog";

const toneStyles = {
  danger: {
    icon: ShieldAlert,
    iconWrap: "bg-rose-100 text-rose-700",
    button: "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-300",
  },
  warning: {
    icon: AlertTriangle,
    iconWrap: "bg-amber-100 text-amber-700",
    button: "bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-300",
  },
  success: {
    icon: CheckCircle2,
    iconWrap: "bg-emerald-100 text-emerald-700",
    button: "bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-300",
  },
  info: {
    icon: Info,
    iconWrap: "bg-sky-100 text-sky-700",
    button: "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-300",
  },
  primary: {
    icon: Info,
    iconWrap: "bg-blue-100 text-blue-700",
    button: "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-300",
  },
};

export default function AppDialogHost() {
  const [queue, setQueue] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const confirmRef = useRef(null);
  const current = queue[0] || null;

  useEffect(
    () => registerAppDialogHandler((request) => {
      setQueue((items) => [...items, request]);
    }),
    []
  );

  useEffect(() => {
    if (!current) return undefined;
    setInputValue(current.defaultValue || "");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => confirmRef.current?.focus(), 0);

    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      current.resolve(current.type === "prompt" ? null : false);
      setQueue((items) => items.slice(1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [current]);

  if (!current) return null;

  const tone = toneStyles[current.tone] || toneStyles.primary;
  const ToneIcon = tone.icon;
  const close = (value) => {
    current.resolve(value);
    setQueue((items) => items.slice(1));
  };
  const cancelValue = current.type === "prompt" ? null : false;

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="astreablue-dialog-title"
        aria-describedby="astreablue-dialog-message"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.35)]"
      >
        <div className="flex items-start gap-4 px-6 pb-4 pt-6">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tone.iconWrap}`}>
            <ToneIcon size={23} strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">
              AstreaBlue
            </p>
            <h2 id="astreablue-dialog-title" className="text-xl font-black text-slate-950">
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => close(cancelValue)}
            aria-label="Close dialog"
            className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6">
          <p id="astreablue-dialog-message" className="whitespace-pre-line text-sm leading-6 text-slate-600">
            {current.message}
          </p>
          {current.detail && (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-slate-600">
              {current.detail}
            </div>
          )}
          {current.type === "prompt" && (
            <input
              autoFocus
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={current.placeholder || ""}
              className="mt-4 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
              onKeyDown={(event) => {
                if (event.key === "Enter" && inputValue.trim()) close(inputValue);
              }}
            />
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-4">
          {current.type !== "alert" && (
            <button
              type="button"
              onClick={() => close(cancelValue)}
              className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
            >
              {current.cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            disabled={current.type === "prompt" && current.required && !inputValue.trim()}
            onClick={() => close(current.type === "prompt" ? inputValue : true)}
            className={`rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50 ${tone.button}`}
          >
            {current.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
