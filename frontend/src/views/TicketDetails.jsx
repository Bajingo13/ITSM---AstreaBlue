import { useEffect, useState } from "react";
import { formatPriority, getPriorityBadgeClass } from "../utils/ticketVisuals";
import { X, Calendar, User, Building, Paperclip, Info } from "lucide-react";
import { API_URL } from "../config/api";
import { getAuthToken } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1`;

export default function TicketDetails({ id, onClose }) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/tickets/${id}`, {
      headers: {
        "Authorization": `Bearer ${getAuthToken()}`
      }
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || "Ticket not found");
        return data;
      })
      .then(data => setTicket(data))
      .catch(err => {
        console.error("Fetch ticket error:", err);
        setError(err.message);
      });
  }, [id]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
        <div className="bg-white p-6 rounded-3xl shadow-2xl relative max-w-md w-full border border-slate-300">
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
          <div className="text-red-500 font-medium text-center py-4">
            <h3 className="text-lg font-bold mb-2">Could not load ticket</h3>
            <p className="text-sm text-slate-600">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
        <div className="bg-white p-6 rounded-3xl shadow-2xl">
          <div className="text-slate-500 animate-pulse font-medium">Loading ticket...</div>
        </div>
      </div>
    );
  }

  let statusBadgeClass = "bg-slate-100 text-slate-700";
  if (ticket.status === "Open Queue") statusBadgeClass = "bg-blue-100 text-blue-700";
  else if (ticket.status === "In Progress") statusBadgeClass = "bg-amber-100 text-amber-700";
  else if (ticket.status === "Resolved") statusBadgeClass = "bg-emerald-100 text-emerald-700";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-slate-200 px-7 py-5 bg-white z-10 shadow-sm">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-slate-500 mb-1">{ticket.ticket_number}</div>
            <h2 className="text-2xl font-black text-slate-900">{ticket.title}</h2>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shadow-sm border border-transparent hover:border-slate-200"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-7 space-y-8">
          
          {/* Top Section */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="astrea-card p-4 flex flex-col items-start gap-2 shadow-sm transition-shadow hover:shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Status</span>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${statusBadgeClass}`}>
                {ticket.status}
              </span>
            </div>
            
            <div className="astrea-card p-4 flex flex-col items-start gap-2 shadow-sm transition-shadow hover:shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Priority</span>
              <span className={getPriorityBadgeClass(ticket.priority)}>
                {formatPriority(ticket.priority)}
              </span>
            </div>

            <div className="astrea-card p-4 flex flex-col items-start gap-2 shadow-sm transition-shadow hover:shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <User size={13} /> Requester
              </span>
              <span className="text-sm font-black text-slate-900">
                {ticket.requester_name || "N/A"}
              </span>
            </div>

            <div className="astrea-card p-4 flex flex-col items-start gap-2 shadow-sm transition-shadow hover:shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Building size={13} /> Branch
              </span>
              <span className="text-sm font-black text-slate-900">
                {ticket.branch_name || "N/A"}
              </span>
            </div>
          </div>

          {/* Description Box */}
          <div className="astrea-card p-6 shadow-sm">
            <h3 className="flex items-center gap-2 font-black text-slate-900 mb-4">
              <Info size={18} className="text-astrea-primary" />
              Description
            </h3>
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 shadow-inner text-slate-700 whitespace-pre-wrap text-sm leading-relaxed">
              {ticket.description}
            </div>
          </div>

          {/* Attachments Section */}
          {ticket.attachments && ticket.attachments.length > 0 && (
            <div className="astrea-card p-6 shadow-sm">
              <h3 className="text-sm font-black text-slate-900 mb-4 flex items-center gap-2">
                <Paperclip size={18} className="text-astrea-primary" />
                Attachments
              </h3>
              <div className="flex flex-wrap gap-3">
                {ticket.attachments.map((attachment, idx) => (
                  <a 
                    key={idx} 
                    href={attachment.url || "#"} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 transition-colors shadow-sm"
                  >
                    <Paperclip size={14} className="text-slate-500" />
                    {attachment.name || `Attachment ${idx + 1}`}
                  </a>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
