const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { protectWorkbook } = require("./excelProtectionService");

const COLORS = { navy: "123A6D", blue: "2563EB", line: "CBD5E1", ink: "172033", muted: "64748B" };

function logoPath() {
  return [
    path.resolve(__dirname, "../assets/astrea-blue-logo.png"),
    path.resolve(__dirname, "../../../frontend/public/astrea-blue-logo.png"),
    path.resolve(process.cwd(), "../frontend/public/astrea-blue-logo.png"),
    path.resolve(process.cwd(), "frontend/public/astrea-blue-logo.png"),
  ].find((candidate) => fs.existsSync(candidate)) || null;
}

function clean(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
  return String(value).replace(/[\r\n\t]+/g, " ").trim();
}

function normalizeReport(input = {}) {
  const columns = (Array.isArray(input.columns) ? input.columns : []).slice(0, 20).map((column, index) => ({
    key: clean(column.key || `column_${index + 1}`).slice(0, 80),
    label: clean(column.label || column.key || `Column ${index + 1}`).slice(0, 100),
    width: Math.min(40, Math.max(12, Number(column.width) || 20)),
  }));
  if (!columns.length) throw new Error("At least one report column is required.");
  const rows = (Array.isArray(input.rows) ? input.rows : []).slice(0, 5000).map((row) =>
    Object.fromEntries(columns.map((column) => [column.key, clean(row?.[column.key]).slice(0, 2000)]))
  );
  return {
    title: clean(input.title || "AstreaBlue Report").slice(0, 140),
    company: clean(input.company || "AstreaBlue Enterprise ITSM").slice(0, 140),
    scope: clean(input.scope || "Authorized scope").slice(0, 180),
    generatedAt: input.generatedAt ? new Date(input.generatedAt) : new Date(),
    columns,
    rows,
  };
}

async function createExcelReport(input) {
  const report = normalizeReport(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AstreaBlue ITSM";
  workbook.created = report.generatedAt;
  const sheet = workbook.addWorksheet("Report", { views: [{ state: "frozen", ySplit: 5 }] });
  const lastColumn = Math.max(report.columns.length, 6);
  sheet.mergeCells(1, 1, 1, Math.max(1, lastColumn - 2));
  sheet.getCell("A1").value = report.title.toUpperCase();
  sheet.getCell("A1").font = { bold: true, size: 20, color: { argb: `FF${COLORS.navy}` } };
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell("A2").value = `${report.company} | ${report.scope}`;
  sheet.getCell("A2").font = { bold: true, size: 11, color: { argb: `FF${COLORS.muted}` } };
  sheet.mergeCells(3, 1, 3, lastColumn);
  sheet.getCell("A3").value = `Generated: ${report.generatedAt.toLocaleString("en-PH", { timeZone: "Asia/Manila" })} | Records: ${report.rows.length}`;
  sheet.getCell("A3").font = { size: 10, color: { argb: `FF${COLORS.muted}` } };
  const logo = logoPath();
  if (logo) {
    const imageId = workbook.addImage({ filename: logo, extension: "png" });
    sheet.addImage(imageId, { tl: { col: Math.max(0, lastColumn - 2), row: 0 }, ext: { width: 125, height: 52 } });
  }
  sheet.getRow(5).values = report.columns.map((column) => column.label);
  sheet.getRow(5).height = 28;
  sheet.getRow(5).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.navy}` } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: `FF${COLORS.blue}` } } };
  });
  report.rows.forEach((record, index) => {
    const row = sheet.addRow(report.columns.map((column) => record[column.key]));
    row.height = 24;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${index % 2 ? "F8FAFC" : "FFFFFF"}` } };
      cell.border = { bottom: { style: "thin", color: { argb: `FF${COLORS.line}` } } };
    });
  });
  report.columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, sheet.rowCount), column: report.columns.length } };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  await protectWorkbook(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function createTextReport(input) {
  const report = normalizeReport(input);
  const lines = ["ASTREABLUE ENTERPRISE ITSM", report.title.toUpperCase(), `Company: ${report.company}`, `Scope: ${report.scope}`, `Generated: ${report.generatedAt.toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`, `Records: ${report.rows.length}`, "", report.columns.map((column) => column.label).join("\t"), ...report.rows.map((row) => report.columns.map((column) => row[column.key]).join("\t"))];
  return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
}

function createPdfReport(input) {
  const report = normalizeReport(input);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28, bufferPages: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const pageWidth = doc.page.width - 56;
    const logo = logoPath();
    const widths = report.columns.map((column) => column.width);
    const widthTotal = widths.reduce((sum, width) => sum + width, 0);
    const scaledWidths = widths.map((width) => (width / widthTotal) * pageWidth);
    const drawHeader = () => {
      doc.fillColor(`#${COLORS.navy}`).font("Helvetica-Bold").fontSize(17).text(report.title, 28, 28, { width: pageWidth - 150 });
      doc.fillColor(`#${COLORS.muted}`).font("Helvetica").fontSize(9).text(`${report.company} | ${report.scope}`, 28, 52, { width: pageWidth - 150 });
      doc.text(`Generated: ${report.generatedAt.toLocaleString("en-PH", { timeZone: "Asia/Manila" })} | Records: ${report.rows.length}`, 28, 66);
      if (logo) doc.image(logo, doc.page.width - 148, 20, { fit: [120, 48], align: "right" });
      let x = 28;
      scaledWidths.forEach((width, index) => {
        doc.rect(x, 88, width, 28).fillAndStroke(`#${COLORS.navy}`, `#${COLORS.line}`);
        doc.fillColor("white").font("Helvetica-Bold").fontSize(7).text(report.columns[index].label, x + 4, 96, { width: width - 8, height: 16, ellipsis: true });
        x += width;
      });
      return 116;
    };
    let y = drawHeader();
    report.rows.forEach((row, rowIndex) => {
      const height = 27;
      if (y + height > doc.page.height - 40) { doc.addPage(); y = drawHeader(); }
      let x = 28;
      scaledWidths.forEach((width, columnIndex) => {
        doc.rect(x, y, width, height).fillAndStroke(rowIndex % 2 ? "#F8FAFC" : "#FFFFFF", `#${COLORS.line}`);
        doc.fillColor(`#${COLORS.ink}`).font("Helvetica").fontSize(7).text(row[report.columns[columnIndex].key], x + 4, y + 7, { width: width - 8, height: 15, ellipsis: true });
        x += width;
      });
      y += height;
    });
    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(index);
      doc.fillColor(`#${COLORS.muted}`).fontSize(8).text(`Page ${index + 1} of ${range.count}`, 28, doc.page.height - 25, { width: pageWidth, align: "right" });
    }
    doc.end();
  });
}

module.exports = { normalizeReport, createExcelReport, createTextReport, createPdfReport };
