import { useState } from "react";
import TicketDetails from "../views/TicketDetails";
import { getStatusBadgeClass } from "../utils/ticketVisuals";

export default function TicketTable({ requests }) {
  const [selectedTicket, setSelectedTicket] = useState(null);

  return (
    <div className="bg-white rounded shadow">

      <table className="w-full">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">Ticket</th>
            <th>Title</th>
            <th>Category</th>
            <th>Branch</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {requests.length === 0 ? (
            <tr>
              <td colSpan="6" className="p-4">
                No requests found
              </td>
            </tr>
          ) : (
            requests.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="p-2">{r.ticket_number}</td>
                <td>{r.title}</td>
                <td>{r.category}</td>
                <td>{r.branch_name}</td>
                <td>
                  <span className={`${getStatusBadgeClass(r.status)} px-2.5 py-0.5 font-semibold`}>
                    {r.status}
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => setSelectedTicket(r.id)}
                    className="text-blue-600"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* MODAL */}
      {selectedTicket && (
        <TicketDetails
          id={selectedTicket}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </div>
  );
}
