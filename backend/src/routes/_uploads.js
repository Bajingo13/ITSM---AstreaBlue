const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const ticketUploadDir = path.join(__dirname, "..", "..", "uploads", "tickets");
fs.mkdirSync(ticketUploadDir, { recursive: true });

const allowedAttachmentMimeTypes = new Set([
  "image/jpg",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const ticketAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ticketUploadDir),
  filename: (req, file, cb) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeBase}`);
  },
});

const uploadTicketAttachments = multer({
  storage: ticketAttachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedAttachmentMimeTypes.has(file.mimetype)) {
      return cb(new Error("Only JPG, JPEG, PNG, WEBP, and PDF files are supported"));
    }
    cb(null, true);
  },
});

module.exports = {
  uploadTicketAttachments,
};
