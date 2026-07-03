import { useEffect, useState } from "react";
import { formatPriority, getPriorityBadgeClass } from "../utils/ticketVisuals";
import { X, Calendar, User, Building, Paperclip, Info } from "lucide-react";
import { API_URL } from "../config/api";
import { getAuthToken } from "../services/authHeaders";

const API_BASE = `${API_URL}/api/v1`;

export default function TicketDetails({ id, onClose }) {
  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/tickets/${id}`, {
      headers: {
        "Authorization": `Bearer ${getAuthToken()}`
      }
    })
      .then(res => {
        if (!res.ok) throw new Error("Ticket not found");
        return res.json();
      })
      .then(data => setTicket(data))
      .catch(err => console.error("Fetch ticket error:", err));
  }, [id]);

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
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-white z-10">
          <div>
            <div className="text-sm font-medium text-slate-500 mb-1">{ticket.ticket_number}</div>
            <h2 className="text-xl font-bold text-slate-900">{ticket.title}</h2>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-8">
          
          {/* Top Section */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col items-start gap-2 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusBadgeClass}`}>
                {ticket.status}
              </span>
            </div>
            
            <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col items-start gap-2 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Priority</span>
              <span className={getPriorityBadgeClass(ticket.priority)}>
                {formatPriority(ticket.priority)}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col items-start gap-2 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <User size={14} /> Requester
              </span>
              <span className="text-sm font-medium text-slate-800">
                {ticket.requester_name || "N/A"}
              </span>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col items-start gap-2 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Building size={14} /> Branch
              </span>
              <span className="text-sm font-medium text-slate-800">
                {ticket.branch_name || "N/A"}
              </span>
            </div>
          </div>

          {/* Description Box */}
          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
            <h3 className="flex items-center gap-2 font-semibold text-slate-800 mb-3">
              <Info size={18} className="text-blue-500" />
              Description
            </h3>
            <div className="text-slate-700 whitespace-pre-wrap text-sm leading-relaxed">
              {ticket.description}
            </div>
          </div>

          {/* Attachments Section */}
          {ticket.attachments && ticket.attachments.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Paperclip size={16} className="text-slate-400" />
                Attachments
              </h3>
              <div className="flex flex-wrap gap-2">
                {ticket.attachments.map((attachment, idx) => (
                  <a 
                    key={idx} 
                    href={attachment.url || "#"} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
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
