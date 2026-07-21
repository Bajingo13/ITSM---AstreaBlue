const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { createExcelReport, createTextReport, createPdfReport } = require("../src/services/tabularReportService");

const sample = {
  title: "SLA Ticket Queue",
  company: "AstreaBlue Enterprise ITSM",
  scope: "Makati Head Office",
  columns: [
    { key: "ticket", label: "Ticket", width: 20 },
    { key: "status", label: "Status", width: 16 },
  ],
  rows: [{ ticket: "TKT-20260721-0001", status: "Resolved" }],
};

test("shared Excel report is a branded workbook with tabular rows", async () => {
  const buffer = await createExcelReport(sample);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Report");
  assert.match(String(sheet.getCell("A1").value), /SLA TICKET QUEUE/);
  assert.equal(sheet.getCell("A6").value, "TKT-20260721-0001");
  assert.equal(sheet.sheetProtection?.sheet, true);
});

test("shared TXT report is a distinct branded text file", () => {
  const text = createTextReport(sample).toString("utf8");
  assert.match(text, /ASTREABLUE ENTERPRISE ITSM/);
  assert.match(text, /Ticket\tStatus/);
  assert.match(text, /TKT-20260721-0001\tResolved/);
});

test("shared PDF report is a distinct valid PDF file", async () => {
  const buffer = await createPdfReport(sample);
  assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
  assert.ok(buffer.length > 1000);
});
