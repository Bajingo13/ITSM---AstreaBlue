const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../../config/db");
const { uploadTicketAttachments } = require("./_uploads");
const { addTicketAccessFilter, requireAuthenticatedTicketUser } = require("./_ticketAccess");

const router = express.Router();
router.use(requireAuthenticatedTicketUser);

async function requireScopedTicket(req, res, next) {
  try {
    const params = [req.params.id];
    const clauses = addTicketAccessFilter(req, params, "t");
    const result = await db.query(
      `SELECT t.id FROM tickets t WHERE t.id=$1 AND ${clauses.join(" AND ")}`,
      params
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Ticket not found" });
    }
    return next();
  } catch (error) {
    console.error("Ticket attachment scope error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to verify ticket access" });
  }
}

router.get("/:id/attachments", requireScopedTicket, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `
      SELECT
        attachment_id,
        ticket_id,
        uploaded_by,
        file_name,
        file_path,
        mime_type,
        file_size,
        uploaded_at
      FROM ticket_attachments
      WHERE ticket_id = $1
      ORDER BY uploaded_at ASC
      `,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch attachments error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch attachments" });
  }
});

router.post("/:id/attachments", requireScopedTicket, (req, res) => {
  uploadTicketAttachments.array("attachments", 10)(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({
        success: false,
        error:
          uploadErr.code === "LIMIT_FILE_SIZE"
            ? "File size must be 10MB or less"
            : uploadErr.message || "Failed to upload attachment",
      });
    }

  try {
    const { id } = req.params;
    const uploadedBy = req.ticketAccessContext.currentUserId;
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one attachment file is required",
      });
    }

    const savedAttachments = [];

    for (const file of files) {
      const relativePath = `/uploads/tickets/${file.filename}`;
      const result = await db.query(
        `
        INSERT INTO ticket_attachments
        (ticket_id, file_name, file_path, file_size, mime_type, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING attachment_id, ticket_id, uploaded_by, file_name, file_path, mime_type, file_size, uploaded_at
        `,
        [
          id,
          file.originalname,
          relativePath,
          file.size,
          file.mimetype,
          uploadedBy || null,
        ]
      );

      try {
        await db.query(
          `
          INSERT INTO ticket_history
          (ticket_id, changed_by, action, old_value, new_value)
          VALUES ($1, $2, 'Attachment Added', NULL, $3)
          `,
          [id, uploadedBy || null, file.originalname]
        );
      } catch (historyErr) {
        console.warn("Failed to insert into ticket_history during attachment upload:", historyErr.message);
      }

      savedAttachments.push(result.rows[0]);
    }

    res.status(201).json({ success: true, attachments: savedAttachments });
  } catch (err) {
    console.error("Upload attachment error:", err.message);
    res.status(500).json({ success: false, error: "Upload error: " + err.message });
  }
  });
});

router.delete("/:id/attachments/:attachmentId", requireScopedTicket, async (req, res) => {
  try {
    const { id, attachmentId } = req.params;
    const result = await db.query(
      `
      DELETE FROM ticket_attachments
      WHERE ticket_id = $1 AND attachment_id = $2
      RETURNING attachment_id, file_path
      `,
      [id, attachmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Attachment not found" });
    }

    const filePath = result.rows[0].file_path;
    if (filePath) {
      const absolutePath = path.join(__dirname, "..", "..", filePath.replace(/^\/uploads[\\/]/, "uploads/"));
      fs.unlink(absolutePath, () => {});
    }

    res.json({ success: true, message: "Attachment deleted successfully" });
  } catch (err) {
    console.error("Delete attachment error:", err.message);
    res.status(500).json({ success: false, error: "Failed to delete attachment" });
  }
});

module.exports = router;
