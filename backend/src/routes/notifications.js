const express = require("express");
const router = express.Router();
const db = require("../../config/db");

// Fetch all notifications for the current user
router.get("/", async (req, res) => {
  const userId = req.query.user_id || req.headers["x-user-id"];
  
  if (!userId) {
    return res.status(400).json({ success: false, message: "User ID is required" });
  }

  try {
    const result = await db.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching notifications:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Mark a notification as read
router.patch("/:id/read", async (req, res) => {
  const { id } = req.params;
  const userId = req.body.user_id || req.headers["x-user-id"];

  if (!userId) {
    return res.status(400).json({ success: false, message: "User ID is required" });
  }

  try {
    const result = await db.query(
      `UPDATE notifications 
       SET read = TRUE 
       WHERE id = $1 AND user_id = $2 
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.json({ success: true, notification: result.rows[0] });
  } catch (error) {
    console.error("Error updating notification:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
