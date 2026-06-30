const db = require("../../config/db");

async function calculateSlaDueDate(priorityStr) {
  try {
    // Attempt to match priority format
    const { rows } = await db.query(
      `SELECT resolution_time_minutes FROM sla_policies 
       WHERE is_active = TRUE AND priority = $1`,
      [priorityStr]
    );

    let resolutionMinutes = 1440; // Default 24 hours
    if (rows.length > 0) {
      resolutionMinutes = rows[0].resolution_time_minutes;
    } else {
      // Fallback matching
      const p = (priorityStr || "").toLowerCase();
      if (p.includes("p1") || p.includes("critical")) resolutionMinutes = 240;
      else if (p.includes("p2") || p.includes("high")) resolutionMinutes = 480;
      else if (p.includes("p3") || p.includes("medium")) resolutionMinutes = 1440;
      else if (p.includes("p4") || p.includes("low")) resolutionMinutes = 2880;
    }

    const slaDueDate = new Date();
    slaDueDate.setMinutes(slaDueDate.getMinutes() + resolutionMinutes);
    return slaDueDate;
  } catch (error) {
    console.error("Error calculating SLA due date:", error);
    // Fallback
    const fallbackDate = new Date();
    fallbackDate.setHours(fallbackDate.getHours() + 24);
    return fallbackDate;
  }
}

module.exports = {
  calculateSlaDueDate,
};
