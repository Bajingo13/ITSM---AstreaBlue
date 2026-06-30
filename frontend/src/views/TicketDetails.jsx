import { useEffect, useState } from "react";
import apiService from "../services/api";

export default function TicketDetails({ id, onClose }) {
  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    apiService.fetchRequestById(id).then((res) => {
      setTicket(res.data);
    });
  }, [id]);

  if (!ticket) return <div>Loading ticket...</div>;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center">

      <div className="bg-white w-[600px] p-6 rounded">

        <button onClick={onClose} className="float-right text-red-500">
          X
        </button>

        <h2 className="text-xl font-bold">{ticket.ticket_number}</h2>

        <p><b>Title:</b> {ticket.title}</p>
        <p><b>Description:</b> {ticket.description}</p>
        <p><b>Category:</b> {ticket.category}</p>
        <p><b>Status:</b> {ticket.status}</p>
        <p><b>Priority:</b> {formatPriority(ticket.priority)}</p>
        <p><b>Branch:</b> {ticket.branch_name}</p>
        <p><b>Requester:</b> {ticket.requester_name}</p>

      </div>
    </div>
  );
}