const express = require("express");
const router = express.Router();
const db = require("../../config/db");
const { requireCurrentRoles } = require("../middleware/currentActor");

router.use(requireCurrentRoles());
router.use((req, _res, next) => {
  req.authUser = req.currentActor;
  next();
});

// Fetch all notifications for the current user
router.get("/", async (req, res) => {
  const userId = req.authUser.userId;

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

router.patch("/read-all", async (req, res) => {
  const userId = req.authUser.userId;

  try {
    const result = await db.query(
      `UPDATE notifications
       SET read = TRUE
       WHERE user_id = $1 AND read = FALSE
       RETURNING id`,
      [userId]
    );
    res.json({ success: true, updated_count: result.rowCount });
  } catch (error) {
    console.error("Error marking all notifications as read:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Mark a notification as read
router.patch("/:id/read", async (req, res) => {
  const { id } = req.params;
  const userId = req.authUser.userId;

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
