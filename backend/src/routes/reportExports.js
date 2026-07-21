const express = require("express");
const { requireAuthenticatedTicketUser } = require("./_ticketAccess");
const { createExcelReport, createTextReport, createPdfReport } = require("../services/tabularReportService");

const router = express.Router();
router.use(requireAuthenticatedTicketUser);

router.post("/tabular", async (req, res) => {
  try {
    const format = String(req.body?.format || "excel").toLowerCase();
    if (!["excel", "txt", "pdf"].includes(format)) return res.status(400).json({ success: false, message: "Export format must be excel, txt, or pdf." });
    const safeName = String(req.body?.filename || "astreablue-report").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "astreablue-report";
    const buffer = format === "txt" ? createTextReport(req.body) : format === "pdf" ? await createPdfReport(req.body) : await createExcelReport(req.body);
    const extension = format === "excel" ? "xlsx" : format;
    const contentType = format === "excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : format === "pdf" ? "application/pdf" : "text/plain; charset=utf-8";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${extension}"`);
    return res.end(buffer);
  } catch (error) {
    console.error("Tabular report export error:", error.message);
    return res.status(400).json({ success: false, message: error.message || "Failed to export report." });
  }
});

module.exports = router;
