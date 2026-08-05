const fs = require('fs');
const original = fs.readFileSync('frontend/src/views/Tickets.jsx', 'utf8');
const replacement = fs.readFileSync('C:\\Users\\janis\\.gemini\\antigravity-cli\\brain\\534903cd-b1d0-4298-886c-d37ab055732d\\TicketDetailsDrawer_updated.jsx', 'utf8');

const lines = original.split('\n');
const startIdx = lines.findIndex((l, i) => i >= 750 && l.includes('<div className="astrea-modal-backdrop z-[80]">'));
const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('{cancelModalOpen && ('));

if (startIdx !== -1 && endIdx !== -1) {
  const before = lines.slice(0, startIdx).join('\n');
  const after = lines.slice(endIdx).join('\n');
  fs.writeFileSync('frontend/src/views/Tickets.jsx', before + '\n' + replacement.trim() + '\n\n    ' + after);
  console.log('Replaced successfully');
} else {
  console.error('Could not find start or end index', startIdx, endIdx);
}
