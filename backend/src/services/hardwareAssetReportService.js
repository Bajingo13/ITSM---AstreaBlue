const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { protectWorkbook } = require("./excelProtectionService");
const PDFDocument = require("pdfkit");

const COLORS = {
  navy: "0B2A5B",
  blue: "2563EB",
  cyan: "22D3EE",
  paleBlue: "EAF2FF",
  border: "CBD5E1",
  text: "0F172A",
  muted: "64748B",
};

const LOGO_CANDIDATES = [
  path.resolve(__dirname, "../assets/astrea-blue-logo.png"),
  path.resolve(__dirname, "../../../frontend/public/astrea-blue-logo.png"),
  path.resolve(process.cwd(), "../frontend/public/astrea-blue-logo.png"),
  path.resolve(process.cwd(), "frontend/public/astrea-blue-logo.png"),
];

function findLogoPath() {
  return LOGO_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

function formatTimestamp(value = new Date()) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatDate(value, includeTime = false) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    ...(includeTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  }).format(new Date(value));
}

function normalizeRows(assets) {
  return assets.map((asset) => ({
    asset_id: asset.asset_id ?? "-",
    asset_name: asset.asset_name || "Unnamed asset",
    asset_type: asset.asset_type || "-",
    asset_tag: asset.asset_tag || "-",
    serial_number: asset.serial_number || "-",
    brand_model: [asset.brand, asset.model].filter(Boolean).join(" ") || "-",
    branch_name: asset.branch_name || "Unassigned",
    assigned_user: asset.assigned_name || asset.borrower_name || "Unassigned",
    status: asset.status || "-",
    purchase_date: formatDate(asset.purchase_date),
    warranty_date: formatDate(asset.warranty_expiration),
    created_at: formatDate(asset.created_at, true),
    updated_at: formatDate(asset.updated_at, true),
  }));
}

function createHardwareAssetReportMetadata({ companyName, scopeLabel, recordCount }) {
  return {
    companyName: companyName || "AstreaBlue Enterprise ITSM",
    scopeLabel: scopeLabel || "All Authorized Branches",
    generatedAt: formatTimestamp(),
    recordCount: Number(recordCount) || 0,
  };
}

async function createHardwareAssetExcelReport(assets, metadata) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AstreaBlue Enterprise ITSM";
  workbook.company = metadata.companyName;
  workbook.title = "Hardware Asset Report";
  workbook.subject = metadata.scopeLabel;
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Hardware Assets", {
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  worksheet.columns = [
    { key: "asset_id", width: 11 },
    { key: "asset_name", width: 32 },
    { key: "asset_type", width: 18 },
    { key: "asset_tag", width: 20 },
    { key: "serial_number", width: 23 },
    { key: "brand_model", width: 27 },
    { key: "branch_name", width: 28 },
    { key: "assigned_user", width: 25 },
    { key: "status", width: 17 },
    { key: "purchase_date", width: 18 },
    { key: "warranty_date", width: 18 },
    { key: "created_at", width: 23 },
    { key: "updated_at", width: 23 },
  ];

  worksheet.mergeCells("A1:H1");
  worksheet.getCell("A1").value = "HARDWARE ASSET REPORT";
  worksheet.getCell("A1").font = { name: "Aptos Display", size: 22, bold: true, color: { argb: `FF${COLORS.navy}` } };
  worksheet.getCell("A1").alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells("A2:H2");
  worksheet.getCell("A2").value = `${metadata.companyName} | Scope: ${metadata.scopeLabel}`;
  worksheet.getCell("A2").font = { name: "Aptos", size: 12, bold: true, color: { argb: `FF${COLORS.blue}` } };

  worksheet.mergeCells("A3:H3");
  worksheet.getCell("A3").value = `Generated: ${metadata.generatedAt} PHT | Records: ${metadata.recordCount}`;
  worksheet.getCell("A3").font = { name: "Aptos", size: 10, color: { argb: `FF${COLORS.muted}` } };

  const logoPath = findLogoPath();
  if (logoPath) {
    const logoId = workbook.addImage({ filename: logoPath, extension: "png" });
    worksheet.addImage(logoId, { tl: { col: 10.4, row: 0.1 }, ext: { width: 145, height: 58 } });
  } else {
    worksheet.mergeCells("L1:M2");
    worksheet.getCell("L1").value = "AstreaBlue";
    worksheet.getCell("L1").font = { size: 18, bold: true, italic: true, color: { argb: `FF${COLORS.blue}` } };
    worksheet.getCell("L1").alignment = { horizontal: "right", vertical: "middle" };
  }

  const headers = [
    "Asset ID", "Asset Name", "Type", "Asset Tag", "Serial Number", "Brand / Model",
    "Branch / Company", "Assigned User", "Status", "Purchase Date", "Warranty Date",
    "Created (PHT)", "Updated (PHT)",
  ];
  const headerRowNumber = 5;
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.values = headers;
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.navy}` } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: `FF${COLORS.navy}` } },
      bottom: { style: "thin", color: { argb: `FF${COLORS.cyan}` } },
      left: { style: "thin", color: { argb: `FF${COLORS.border}` } },
      right: { style: "thin", color: { argb: `FF${COLORS.border}` } },
    };
  });

  normalizeRows(assets).forEach((row, index) => {
    const excelRow = worksheet.addRow(row);
    excelRow.height = 31;
    excelRow.eachCell((cell) => {
      cell.font = { name: "Aptos", size: 10, color: { argb: `FF${COLORS.text}` } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? "FFFFFFFF" : `FF${COLORS.paleBlue}` } };
      cell.border = {
        top: { style: "thin", color: { argb: `FF${COLORS.border}` } },
        bottom: { style: "thin", color: { argb: `FF${COLORS.border}` } },
        left: { style: "thin", color: { argb: `FF${COLORS.border}` } },
        right: { style: "thin", color: { argb: `FF${COLORS.border}` } },
      };
    });
    excelRow.getCell(1).font = { name: "Aptos", size: 10, bold: true, color: { argb: `FF${COLORS.blue}` } };
  });

  const lastRow = Math.max(headerRowNumber, worksheet.rowCount);
  worksheet.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: lastRow, column: headers.length } };
  worksheet.views = [{ state: "frozen", ySplit: headerRowNumber, activeCell: "A6" }];
  worksheet.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`;
  worksheet.headerFooter.oddFooter = `&LAstreaBlue Enterprise ITSM&C${metadata.scopeLabel}&RPage &P of &N`;

  await protectWorkbook(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function cleanTextValue(value) {
  return String(value ?? "-").replace(/[\t\r\n]+/g, " ").trim() || "-";
}

function createHardwareAssetTextReport(assets, metadata) {
  const headers = [
    "Asset ID", "Asset Name", "Type", "Asset Tag", "Serial Number", "Brand / Model",
    "Branch / Company", "Assigned User", "Status", "Purchase Date", "Warranty Date", "Created (PHT)", "Updated (PHT)",
  ];
  const keys = [
    "asset_id", "asset_name", "asset_type", "asset_tag", "serial_number", "brand_model",
    "branch_name", "assigned_user", "status", "purchase_date", "warranty_date", "created_at", "updated_at",
  ];
  const lines = [
    "ASTREABLUE ENTERPRISE ITSM",
    "HARDWARE ASSET REPORT",
    `Company: ${metadata.companyName}`,
    `Scope: ${metadata.scopeLabel}`,
    `Generated: ${metadata.generatedAt} PHT`,
    `Records: ${metadata.recordCount}`,
    "",
    headers.join("\t"),
  ];
  normalizeRows(assets).forEach((row) => {
    lines.push(keys.map((key) => cleanTextValue(row[key])).join("\t"));
  });
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

function drawPdfHeader(doc, metadata, logoPath) {
  doc.fillColor(`#${COLORS.navy}`).font("Helvetica-Bold").fontSize(19).text("HARDWARE ASSET REPORT", 32, 28, { width: 560 });
  doc.fillColor(`#${COLORS.blue}`).font("Helvetica-Bold").fontSize(10.5).text(`${metadata.companyName} | Scope: ${metadata.scopeLabel}`, 32, 54, { width: 560 });
  doc.fillColor(`#${COLORS.muted}`).font("Helvetica").fontSize(8.5).text(`Generated: ${metadata.generatedAt} PHT | Records: ${metadata.recordCount}`, 32, 72, { width: 560 });
  if (logoPath) {
    doc.image(logoPath, doc.page.width - 154, 22, { fit: [118, 52], align: "right" });
  } else {
    doc.fillColor(`#${COLORS.blue}`).font("Helvetica-BoldOblique").fontSize(16).text("AstreaBlue", doc.page.width - 160, 35, { width: 125, align: "right" });
  }
  doc.moveTo(32, 92).lineTo(doc.page.width - 32, 92).lineWidth(1.2).strokeColor(`#${COLORS.cyan}`).stroke();
}

function drawPdfTableHeader(doc, columns, y) {
  doc.rect(32, y, 777, 27).fill(`#${COLORS.navy}`);
  let x = 32;
  columns.forEach((column) => {
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(6.8).text(column.label, x + 3, y + 7, {
      width: column.width - 6,
      height: 16,
      ellipsis: true,
    });
    x += column.width;
  });
  return y + 27;
}

function createHardwareAssetPdfReport(assets, metadata) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, info: {
      Title: "Hardware Asset Report",
      Author: "AstreaBlue Enterprise ITSM",
      Subject: metadata.scopeLabel,
    } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const columns = [
      { key: "asset_id", label: "ID", width: 45 },
      { key: "asset_name", label: "Asset Name", width: 100 },
      { key: "asset_type", label: "Type", width: 65 },
      { key: "asset_tag", label: "Asset Tag", width: 70 },
      { key: "serial_number", label: "Serial", width: 80 },
      { key: "brand_model", label: "Brand / Model", width: 90 },
      { key: "branch_name", label: "Branch / Company", width: 100 },
      { key: "assigned_user", label: "Assigned", width: 92 },
      { key: "status", label: "Status", width: 70 },
      { key: "updated_at", label: "Updated", width: 65 },
    ];
    const rows = normalizeRows(assets);
    const logoPath = findLogoPath();
    const pageBottom = doc.page.height - 38;
    let y;

    const startPage = () => {
      drawPdfHeader(doc, metadata, logoPath);
      y = drawPdfTableHeader(doc, columns, 103);
    };
    startPage();

    rows.forEach((row, index) => {
      const rowHeight = Math.max(28, ...columns.map((column) => doc.font("Helvetica").fontSize(7).heightOfString(cleanTextValue(row[column.key]), { width: column.width - 6 }))) + 8;
      if (y + rowHeight > pageBottom) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 32 });
        startPage();
      }
      doc.rect(32, y, 777, rowHeight).fill(index % 2 === 0 ? "#FFFFFF" : `#${COLORS.paleBlue}`);
      let x = 32;
      columns.forEach((column) => {
        doc.rect(x, y, column.width, rowHeight).lineWidth(0.45).strokeColor(`#${COLORS.border}`).stroke();
        doc.fillColor(column.key === "asset_id" ? `#${COLORS.blue}` : `#${COLORS.text}`)
          .font(column.key === "asset_id" ? "Helvetica-Bold" : "Helvetica")
          .fontSize(7)
          .text(cleanTextValue(row[column.key]), x + 3, y + 5, { width: column.width - 6, height: rowHeight - 8, ellipsis: true });
        x += column.width;
      });
      y += rowHeight;
    });

    const range = doc.bufferedPageRange();
    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      doc.fillColor(`#${COLORS.muted}`).font("Helvetica").fontSize(7.5)
        .text("AstreaBlue Enterprise ITSM", 32, doc.page.height - 24, { width: 300 })
        .text(`Page ${pageIndex + 1} of ${range.count}`, doc.page.width - 180, doc.page.height - 24, { width: 148, align: "right" });
    }
    doc.end();
  });
}

module.exports = {
  createHardwareAssetReportMetadata,
  createHardwareAssetExcelReport,
  createHardwareAssetTextReport,
  createHardwareAssetPdfReport,
};
