import { useEffect, useState } from "react";
import apiService from "../services/api";
import { formatPriority, getPriorityBadgeClass } from "../utils/ticketVisuals";

export default function TicketDetails({ id, onClose }) {
  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    apiService.fetchRequestById(id).then((res) => {
      setTicket(res.data);
    });
  }, [id]);

  if (!ticket) return <div>Loading ticket...</div>;

  return (
    <div className="astrea-modal-backdrop">

      <div className="astrea-modal-panel max-w-xl p-6">

        <button onClick={onClose} className="float-right text-red-500">
          X
        </button>

        <h2 className="text-xl font-bold">{ticket.ticket_number}</h2>

        <p><b>Title:</b> {ticket.title}</p>
        <p><b>Description:</b> {ticket.description}</p>
        <p><b>Category:</b> {ticket.category}</p>
        <p><b>Status:</b> {ticket.status}</p>
        <p className="flex items-center gap-2"><b>Priority:</b> <span className={getPriorityBadgeClass(ticket.priority)}>{formatPriority(ticket.priority)}</span></p>
        <p><b>Branch:</b> {ticket.branch_name}</p>
        <p><b>Requester:</b> {ticket.requester_name}</p>

      </div>
    </div>
  );
}
