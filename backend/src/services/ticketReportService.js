const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const BRAND = {
  navy: "0B2A5B",
  blue: "2563EB",
  cyan: "22D3EE",
  paleBlue: "EAF2FF",
  border: "CBD5E1",
  text: "0F172A",
  muted: "64748B",
};

const LOGO_CANDIDATES = [
  path.resolve(__dirname, "../../../frontend/public/astrea-blue-logo.png"),
  path.resolve(process.cwd(), "../frontend/public/astrea-blue-logo.png"),
  path.resolve(process.cwd(), "frontend/public/astrea-blue-logo.png"),
];

function findLogoPath() {
  return LOGO_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

function formatReportTimestamp(value = new Date()) {
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

function formatCellDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function reportRows(tickets) {
  return tickets.map((ticket) => ({
    ticket_number: ticket.ticket_number || `#${ticket.id}`,
    title: ticket.title || "Untitled ticket",
    priority: ticket.priority || "-",
    status: ticket.status || "-",
    category: ticket.category || "Uncategorized",
    branch: ticket.branch_name || "Unassigned Branch",
    requester: ticket.requester_name || "Not recorded",
    assigned: ticket.assigned_name || "Unassigned",
    created_at: formatCellDate(ticket.created_at),
    updated_at: formatCellDate(ticket.updated_at),
  }));
}

async function createTicketExcelReport(tickets, metadata) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AstreaBlue Enterprise ITSM";
  workbook.subject = "Ticket Management Report";
  workbook.title = "Ticket Management Report";
  workbook.company = metadata.companyName;
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Ticket Report", {
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
    { key: "ticket_number", width: 23 },
    { key: "title", width: 36 },
    { key: "priority", width: 17 },
    { key: "status", width: 17 },
    { key: "category", width: 22 },
    { key: "branch", width: 27 },
    { key: "requester", width: 24 },
    { key: "assigned", width: 24 },
    { key: "created_at", width: 24 },
    { key: "updated_at", width: 24 },
  ];

  worksheet.mergeCells("A1:G1");
  worksheet.getCell("A1").value = "TICKET MANAGEMENT REPORT";
  worksheet.getCell("A1").font = { name: "Aptos Display", size: 22, bold: true, color: { argb: `FF${BRAND.navy}` } };
  worksheet.getCell("A1").alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells("A2:G2");
  worksheet.getCell("A2").value = `${metadata.companyName} | Scope: ${metadata.scopeLabel}`;
  worksheet.getCell("A2").font = { name: "Aptos", size: 12, bold: true, color: { argb: `FF${BRAND.blue}` } };

  worksheet.mergeCells("A3:G3");
  worksheet.getCell("A3").value = `Generated: ${metadata.generatedAt} PHT | Records: ${tickets.length}`;
  worksheet.getCell("A3").font = { name: "Aptos", size: 10, color: { argb: `FF${BRAND.muted}` } };

  const logoPath = findLogoPath();
  if (logoPath) {
    const logoId = workbook.addImage({ filename: logoPath, extension: "png" });
    worksheet.addImage(logoId, { tl: { col: 8.1, row: 0.1 }, ext: { width: 145, height: 58 } });
  } else {
    worksheet.mergeCells("I1:J2");
    worksheet.getCell("I1").value = "AstreaBlue";
    worksheet.getCell("I1").font = { size: 18, bold: true, italic: true, color: { argb: `FF${BRAND.blue}` } };
    worksheet.getCell("I1").alignment = { horizontal: "right", vertical: "middle" };
  }

  const headerRowNumber = 5;
  const headers = ["Ticket No.", "Title", "Priority", "Status", "Category", "Branch / Company", "Requester", "Assigned To", "Created (PHT)", "Updated (PHT)"];
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.values = headers;
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BRAND.navy}` } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: `FF${BRAND.navy}` } },
      bottom: { style: "thin", color: { argb: `FF${BRAND.cyan}` } },
      left: { style: "thin", color: { argb: `FF${BRAND.border}` } },
      right: { style: "thin", color: { argb: `FF${BRAND.border}` } },
    };
  });

  for (const [index, row] of reportRows(tickets).entries()) {
    const excelRow = worksheet.addRow(row);
    excelRow.height = 31;
    excelRow.eachCell((cell) => {
      cell.font = { name: "Aptos", size: 10, color: { argb: `FF${BRAND.text}` } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: index % 2 === 0 ? "FFFFFFFF" : `FF${BRAND.paleBlue}` },
      };
      cell.border = {
        top: { style: "thin", color: { argb: `FF${BRAND.border}` } },
        bottom: { style: "thin", color: { argb: `FF${BRAND.border}` } },
        left: { style: "thin", color: { argb: `FF${BRAND.border}` } },
        right: { style: "thin", color: { argb: `FF${BRAND.border}` } },
      };
    });
    excelRow.getCell(1).font = { name: "Aptos", size: 10, bold: true, color: { argb: `FF${BRAND.blue}` } };
  }

  const lastRow = Math.max(headerRowNumber, worksheet.rowCount);
  worksheet.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: lastRow, column: headers.length } };
  worksheet.views = [{ state: "frozen", ySplit: headerRowNumber, activeCell: "A6" }];
  worksheet.headerFooter.oddFooter = `&LAstreaBlue Enterprise ITSM&C${metadata.scopeLabel}&RPage &P of &N`;
  worksheet.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function drawPdfReportHeader(doc, metadata, logoPath) {
  const margin = 32;
  doc.fillColor(`#${BRAND.navy}`).font("Helvetica-Bold").fontSize(19).text("TICKET MANAGEMENT REPORT", margin, 28, { width: 560 });
  doc.fillColor(`#${BRAND.blue}`).font("Helvetica-Bold").fontSize(10.5).text(`${metadata.companyName} | Scope: ${metadata.scopeLabel}`, margin, 54, { width: 560 });
  doc.fillColor(`#${BRAND.muted}`).font("Helvetica").fontSize(8.5).text(`Generated: ${metadata.generatedAt} PHT | Records: ${metadata.recordCount}`, margin, 72, { width: 560 });
  if (logoPath) {
    doc.image(logoPath, doc.page.width - 154, 22, { fit: [118, 52], align: "right" });
  } else {
    doc.fillColor(`#${BRAND.blue}`).font("Helvetica-BoldOblique").fontSize(16).text("AstreaBlue", doc.page.width - 160, 35, { width: 125, align: "right" });
  }
  doc.moveTo(margin, 92).lineTo(doc.page.width - margin, 92).lineWidth(1.2).strokeColor(`#${BRAND.cyan}`).stroke();
}

function drawPdfTableHeader(doc, columns, y) {
  doc.rect(32, y, 777, 27).fill(`#${BRAND.navy}`);
  let x = 32;
  for (const column of columns) {
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.2).text(column.label, x + 4, y + 8, {
      width: column.width - 8,
      align: column.align || "left",
      ellipsis: true,
    });
    x += column.width;
  }
  return y + 27;
}

async function createTicketPdfReport(tickets, metadata) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, info: {
      Title: "Ticket Management Report",
      Author: "AstreaBlue Enterprise ITSM",
      Subject: metadata.scopeLabel,
    } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const logoPath = findLogoPath();
    const columns = [
      { key: "ticket_number", label: "Ticket No.", width: 98 },
      { key: "title", label: "Title", width: 148 },
      { key: "priority", label: "Priority", width: 70 },
      { key: "status", label: "Status", width: 75 },
      { key: "category", label: "Category", width: 90 },
      { key: "branch", label: "Branch / Company", width: 110 },
      { key: "requester", label: "Requester", width: 95 },
      { key: "assigned", label: "Assigned To", width: 91 },
    ];
    const rows = reportRows(tickets);
    const pageBottom = doc.page.height - 38;
    let y;

    const startPage = () => {
      drawPdfReportHeader(doc, metadata, logoPath);
      y = drawPdfTableHeader(doc, columns, 103);
    };

    startPage();
    rows.forEach((row, index) => {
      const rowHeight = Math.max(28, ...columns.map((column) => doc.font("Helvetica").fontSize(7.4).heightOfString(String(row[column.key] || "-"), { width: column.width - 8 }))) + 8;
      if (y + rowHeight > pageBottom) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 32 });
        startPage();
      }

      doc.rect(32, y, 777, rowHeight).fill(index % 2 === 0 ? "#FFFFFF" : `#${BRAND.paleBlue}`);
      let x = 32;
      columns.forEach((column) => {
        doc.rect(x, y, column.width, rowHeight).lineWidth(0.45).strokeColor(`#${BRAND.border}`).stroke();
        doc.fillColor(column.key === "ticket_number" ? `#${BRAND.blue}` : `#${BRAND.text}`)
          .font(column.key === "ticket_number" ? "Helvetica-Bold" : "Helvetica")
          .fontSize(7.4)
          .text(String(row[column.key] || "-"), x + 4, y + 5, { width: column.width - 8, height: rowHeight - 8, ellipsis: true });
        x += column.width;
      });
      y += rowHeight;
    });

    if (rows.length === 0) {
      doc.fillColor(`#${BRAND.muted}`).font("Helvetica").fontSize(10).text("No ticket records matched the selected filters.", 32, y + 18, { width: 777, align: "center" });
    }

    const range = doc.bufferedPageRange();
    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      doc.fillColor(`#${BRAND.muted}`).font("Helvetica").fontSize(7.5)
        .text("AstreaBlue Enterprise ITSM", 32, doc.page.height - 24, { width: 300 })
        .text(`Page ${pageIndex + 1} of ${range.count}`, doc.page.width - 180, doc.page.height - 24, { width: 148, align: "right" });
    }
    doc.end();
  });
}

function createReportMetadata({ companyName, scopeLabel, recordCount }) {
  return {
    companyName: companyName || "AstreaBlue Enterprise ITSM",
    scopeLabel: scopeLabel || "All Authorized Branches",
    generatedAt: formatReportTimestamp(),
    recordCount: Number(recordCount) || 0,
  };
}

module.exports = {
  createReportMetadata,
  createTicketExcelReport,
  createTicketPdfReport,
  formatReportTimestamp,
};
