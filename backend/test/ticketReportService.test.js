const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const {
  createReportMetadata,
  createTicketExcelReport,
  createTicketPdfReport,
} = require("../src/services/ticketReportService");

const sampleTickets = [
  {
    id: 101,
    ticket_number: "TKT-20260721-0001",
    title: "Unable to access payroll portal",
    priority: "P2-High",
    status: "Open Queue",
    category: "Access Request",
    branch_name: "Makati Head Office",
    requester_name: "Sample Employee",
    assigned_name: "Sample Technician",
    created_at: "2026-07-21T01:00:00.000Z",
    updated_at: "2026-07-21T01:30:00.000Z",
  },
];

test("ticket Excel report contains branded metadata and tabular ticket rows", async () => {
  const metadata = createReportMetadata({
    companyName: "AstreaBlue Enterprise ITSM",
    scopeLabel: "Makati Head Office",
    recordCount: sampleTickets.length,
  });
  const buffer = await createTicketExcelReport(sampleTickets, metadata);
  assert.ok(buffer.length > 1000);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Ticket Report");
  assert.ok(worksheet);
  assert.equal(worksheet.getCell("A1").value, "TICKET MANAGEMENT REPORT");
  assert.match(String(worksheet.getCell("A2").value), /Makati Head Office/);
  assert.equal(worksheet.getCell("A5").value, "Ticket No.");
  assert.equal(worksheet.getCell("A6").value, "TKT-20260721-0001");
  assert.equal(worksheet.getCell("F6").value, "Makati Head Office");
});

test("ticket PDF report is a valid branded PDF document", async () => {
  const metadata = createReportMetadata({
    companyName: "AstreaBlue Enterprise ITSM",
    scopeLabel: "All Branches / Centralized Systems",
    recordCount: sampleTickets.length,
  });
  const buffer = await createTicketPdfReport(sampleTickets, metadata);
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(buffer.length > 1000);
});
