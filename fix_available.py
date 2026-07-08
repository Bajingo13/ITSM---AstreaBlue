import sys
import re

file_path = 'frontend/src/views/AvailableTickets.jsx'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Add import
if 'TicketDetailsModal' not in content:
    content = content.replace('import PageHero from "../components/layout/PageHero";', 'import PageHero from "../components/layout/PageHero";\nimport TicketDetailsModal from "../components/tickets/TicketDetailsModal";')

# 2. Add state
if 'selectedTicket' not in content:
    content = content.replace('const [acceptingId, setAcceptingId] = useState(null);', 'const [acceptingId, setAcceptingId] = useState(null);\n  const [selectedTicket, setSelectedTicket] = useState(null);')

# 3. Add View button next to Accept
old_btn = '''<button
                onClick={() => acceptTicket(ticket.id)}
                disabled={acceptingId === ticket.id}
                className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {acceptingId === ticket.id ? "Accepting..." : "Accept"}
              </button>'''

new_btns = '''<div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedTicket(ticket)}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200"
                >
                  View
                </button>
                <button
                  onClick={() => acceptTicket(ticket.id)}
                  disabled={acceptingId === ticket.id}
                  className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {acceptingId === ticket.id ? "Accepting..." : "Accept"}
                </button>
              </div>'''
content = content.replace(old_btn, new_btns)

# 4. Add modal at the end
modal_code = '''
      {selectedTicket && (
        <TicketDetailsModal
          ticketId={selectedTicket.id}
          onClose={() => setSelectedTicket(null)}
          onUpdate={fetchTickets}
        />
      )}
    </div>
  );
}'''
content = re.sub(r'</div>\s*<TicketTable', modal_code + r'\n\n<TicketTable', content)
if 'TicketDetailsModal ticketId' not in content:
    content = content.replace('    </div>\n  );\n}\n\nfunction TicketTable', modal_code + '\n\nfunction TicketTable')

with open(file_path, 'w') as f:
    f.write(content)
