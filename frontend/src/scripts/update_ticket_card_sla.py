import sys

file_path = "C:/Users/janis/asset-monitoring-backend/frontend/src/views/Tickets.jsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Add getSlaBadgeClass function
sla_badge_fn = """function getSlaBadgeClass(status) {
  switch (status) {
    case "Met": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "Breached": return "bg-red-100 text-red-800 border-red-200";
    case "Due Soon": return "bg-amber-100 text-amber-800 border-amber-200";
    default: return "bg-blue-100 text-blue-800 border-blue-200"; // Pending / Active
  }
}

function TicketCard"""

content = content.replace("function TicketCard", sla_badge_fn)

# Add badge to TicketCard layout
old_ticket_card_top = """      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-wider text-blue-600 truncate">
          {ticket.ticket_number || `TKT-${ticket.id}`}
        </p>
        <span
          className={`${getPriorityBadgeClass(ticket.priority)} shrink-0 whitespace-nowrap px-2.5 py-0.5 text-[11px]`}
        >
          {formatPriority(ticket.priority)}
        </span>
      </div>"""

# Note: The SLA status might be in response_sla_status or resolution_sla_status. 
# We'll use a derived overall status: if resolution is breached, breached. if response is breached, breached.
new_ticket_card_top = """      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <p className="text-xs font-black uppercase tracking-wider text-blue-600 truncate">
            {ticket.ticket_number || `TKT-${ticket.id}`}
          </p>
          {(ticket.resolution_sla_status || ticket.response_sla_status) && (
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${getSlaBadgeClass(ticket.resolution_sla_status === 'Breached' || ticket.response_sla_status === 'Breached' ? 'Breached' : ticket.resolution_sla_status === 'Pending' ? (ticket.response_sla_status === 'Met' ? 'Pending' : ticket.response_sla_status) : ticket.resolution_sla_status)}`}>
              {ticket.resolution_sla_status === 'Breached' || ticket.response_sla_status === 'Breached' ? 'SLA Breach' : ticket.resolution_sla_status === 'Met' ? 'SLA Met' : 'SLA Active'}
            </span>
          )}
        </div>
        <span
          className={`${getPriorityBadgeClass(ticket.priority)} shrink-0 whitespace-nowrap px-2.5 py-0.5 text-[11px]`}
        >
          {formatPriority(ticket.priority)}
        </span>
      </div>"""

content = content.replace(old_ticket_card_top, new_ticket_card_top)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Tickets.jsx TicketCard updated with SLA badge")
