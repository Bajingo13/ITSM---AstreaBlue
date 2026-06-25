import { useEffect } from "react";
import { Download, X } from "lucide-react";
import { API_URL } from "../config/api";

export default function AttachmentPreviewModal({ attachment, onClose }) {
  const fileUrl = attachment?.file_path
    ? `${API_URL}${attachment.file_path}`
    : "";

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!attachment) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-5xl flex-col rounded-3xl bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-slate-900">
              {attachment.file_name}
            </p>
            <p className="text-xs font-semibold text-slate-400">
              {attachment.mime_type}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={fileUrl}
              download={attachment.file_name}
              className="flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-black text-white hover:bg-blue-800"
            >
              <Download size={16} />
              Download
            </a>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-950 p-4">
          <img
            src={fileUrl}
            alt={attachment.file_name}
            className="max-h-[78vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
        </div>
      </div>
    </div>
  );
}
