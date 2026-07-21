const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const {
  createHardwareAssetReportMetadata,
  createHardwareAssetExcelReport,
  createHardwareAssetTextReport,
  createHardwareAssetPdfReport,
} = require("../src/services/hardwareAssetReportService");

const assets = [{
  asset_id: 501,
  asset_name: "Makati Support Laptop",
  asset_type: "Laptop",
  asset_tag: "AB-MKT-0501",
  serial_number: "SN-0501",
  brand: "Lenovo",
  model: "ThinkPad T14",
  branch_name: "Makati Head Office",
  assigned_name: "Sample Employee",
  status: "In Use",
  purchase_date: "2026-01-15T00:00:00.000Z",
  warranty_expiration: "2029-01-15T00:00:00.000Z",
  created_at: "2026-01-15T01:00:00.000Z",
  updated_at: "2026-07-21T01:00:00.000Z",
}];

const metadata = createHardwareAssetReportMetadata({
  companyName: "AstreaBlue Enterprise ITSM",
  scopeLabel: "Makati Head Office",
  recordCount: assets.length,
});

test("hardware asset Excel export contains the branded header and asset table", async () => {
  const buffer = await createHardwareAssetExcelReport(assets, metadata);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Hardware Assets");
  assert.equal(worksheet.getCell("A1").value, "HARDWARE ASSET REPORT");
  assert.match(String(worksheet.getCell("A2").value), /Makati Head Office/);
  assert.equal(worksheet.getCell("A5").value, "Asset ID");
  assert.equal(worksheet.getCell("B6").value, "Makati Support Laptop");
  assert.equal(worksheet.sheetProtection?.sheet, true);
});

test("hardware asset TXT export is a distinct tabular plain-text file", () => {
  const text = createHardwareAssetTextReport(assets, metadata).toString("utf8");
  assert.match(text, /HARDWARE ASSET REPORT/);
  assert.match(text, /Asset ID\tAsset Name\tType/);
  assert.match(text, /Makati Support Laptop/);
});

test("hardware asset PDF export is a distinct valid PDF file", async () => {
  const buffer = await createHardwareAssetPdfReport(assets, metadata);
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(buffer.length > 1000);
});
