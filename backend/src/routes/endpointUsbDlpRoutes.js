const db = require("../../config/db");
const {
  evaluateUsbTransfer,
  resolveDlpRules,
} = require("../services/dlpRiskService");
const { createServiceDeskTicket } = require("../services/serviceDeskTicketService");

function normalizeUsbEvent(input) {
  const eventType = String(input?.event_type || "").trim().toLowerCase();
  if (!["device_connected", "device_disconnected", "file_written"].includes(eventType)) return null;
  const reference = String(input?.event_reference || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference)) return null;
  const occurredAt = input?.occurred_at && !Number.isNaN(Date.parse(input.occurred_at))
    ? new Date(input.occurred_at).toISOString()
    : new Date().toISOString();
  const lastWriteAt = input?.file_last_write_at && !Number.isNaN(Date.parse(input.file_last_write_at))
    ? new Date(input.file_last_write_at).toISOString()
    : null;

  return {
    event_reference: reference,
    event_type: eventType,
    drive_letter: String(input?.drive_letter || "").replace(/[^a-z0-9:]/gi, "").slice(0, 10) || null,
    volume_label: String(input?.volume_label || "").replace(/\0/g, "").trim().slice(0, 255) || null,
    volume_serial: String(input?.volume_serial || "").replace(/[^a-z0-9-]/gi, "").slice(0, 100) || null,
    filesystem: String(input?.filesystem || "").replace(/[^a-z0-9]/gi, "").slice(0, 50) || null,
    file_name: eventType === "file_written"
      ? String(input?.file_name || "").replace(/[\0\r\n]/g, "").trim().slice(0, 500) || null
      : null,
    relative_path: eventType === "file_written"
      ? String(input?.relative_path || "").replace(/[\0\r\n]/g, "").trim().slice(0, 2000) || null
      : null,
    extension: eventType === "file_written"
      ? String(input?.extension || "").replace(/[^a-z0-9.]/gi, "").toLowerCase().slice(0, 50) || null
      : null,
    file_size_bytes: eventType === "file_written"
      ? Math.max(0, Math.round(Number(input?.file_size_bytes) || 0))
      : null,
    file_last_write_at: lastWriteAt,
    occurred_at: occurredAt,
  };
}

async function createDlpIncident(device, event, risk, alertId, policy) {
  if (
    !policy?.auto_incident_enabled
    || !device.branch_id
    || !device.assigned_user_id
    || !["High", "Critical"].includes(risk.riskLevel)
  ) return null;

  const category = await db.query(
    `SELECT category_id FROM ticket_categories
     ORDER BY CASE WHEN LOWER(category_name)='security' THEN 0 WHEN LOWER(category_name) LIKE '%incident%' THEN 1 ELSE 2 END, category_id
     LIMIT 1`
  );
  if (!category.rows[0]) return null;

  const result = await createServiceDeskTicket({
    branchId: device.branch_id,
    requesterId: device.assigned_user_id,
    actorId: device.assigned_user_id,
    categoryId: category.rows[0].category_id,
    requireBranch: true,
    enforceRequesterBranch: true,
    title: `DLP Alert: USB transfer on ${device.hostname}`,
    description: [
      "Automatically created from consent-approved endpoint USB monitoring.",
      `Risk: ${risk.riskLevel} (${risk.score}/100)`,
      `File: ${event.file_name || "Unknown"}`,
      `Size: ${event.file_size_bytes || 0} bytes`,
      `Removable drive: ${event.drive_letter || "Unknown"} ${event.volume_label || ""}`.trim(),
      `Matched rules: ${risk.matches.join(", ") || "None"}`,
      `Endpoint alert ID: ${alertId}`,
    ].join("\n"),
    priority: risk.riskLevel === "Critical" ? "P1-Critical" : "P2-High",
    source: "endpoint_monitoring",
    ticketNumberPrefix: "DLP",
    metadata: {
      origin_system: "AstreaBlue Endpoint Agent",
      origin_module: "Endpoint Monitoring",
      origin_feature: "USB DLP",
      external_reference: `usb-event-${event.event_reference}`,
      created_via: "automatic_dlp_incident",
    },
  });
  return result.ticket;
}

function registerEndpointUsbDlpRoutes(router, {
  requireAgent,
  requireAdmin,
  findDevice,
  resolveConsentGatedFeature,
}) {
  router.get("/usb-monitoring-permission", requireAgent, async (req, res) => {
    try {
      const device = await findDevice(req.query || {});
      if (!device) return res.status(404).json({ success: false, message: "Device not registered. Send a heartbeat first." });
      const permission = await resolveConsentGatedFeature(device, "usb_monitoring_enabled");
      return res.json({
        success: true,
        data: {
          allowed: permission.allowed,
          feature: "usb_monitoring",
          policy_version: permission.policy?.policy_version || null,
          consent_id: permission.policy?.consent_id || null,
          reason: permission.reason,
        },
      });
    } catch (error) {
      console.error("[laptop-monitoring:usb-monitoring-permission]", error.message);
      return res.status(500).json({ success: false, message: "Failed to verify USB monitoring consent." });
    }
  });

  router.post("/usb-events/batch", requireAgent, async (req, res) => {
    try {
      const device = await findDevice(req.body || {});
      if (!device) return res.status(404).json({ success: false, message: "Device is not registered. Send a heartbeat first." });
      if (req.agentDevice && String(req.agentDevice.device_id) !== String(device.device_id)) {
        return res.status(403).json({ success: false, message: "Device credential does not match the USB event device." });
      }
      const permission = await resolveConsentGatedFeature(device, "usb_monitoring_enabled");
      if (!permission.allowed) {
        return res.status(403).json({ success: false, message: permission.reason || "USB monitoring is disabled." });
      }

      const incoming = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [];
      const events = incoming.map(normalizeUsbEvent).filter(Boolean);
      if (!events.length) return res.status(400).json({ success: false, message: "At least one valid USB event is required." });

      const saved = [];
      for (const event of events) {
        const risk = event.event_type === "file_written"
          ? evaluateUsbTransfer(event, permission.policy)
          : { score: 0, riskLevel: "Low", matches: [] };
        const inserted = await db.query(
          `INSERT INTO endpoint_usb_events (
             event_reference,device_id,device_uuid,assigned_user_id,branch_id,department,event_type,
             drive_letter,volume_label,volume_serial,filesystem,file_name,relative_path,extension,file_size_bytes,
             file_last_write_at,risk_score,risk_level,rule_matches,occurred_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20)
           ON CONFLICT (event_reference) DO NOTHING RETURNING *`,
          [
            event.event_reference, device.device_id, device.device_uuid, device.assigned_user_id,
            device.branch_id, device.department, event.event_type, event.drive_letter, event.volume_label,
            event.volume_serial, event.filesystem, event.file_name, event.relative_path, event.extension,
            event.file_size_bytes, event.file_last_write_at, risk.score, risk.riskLevel,
            JSON.stringify(risk.matches), event.occurred_at,
          ]
        );
        if (!inserted.rows.length) continue;

        const record = inserted.rows[0];
        if (event.event_type === "file_written" && ["High", "Critical"].includes(risk.riskLevel)) {
          const alert = await db.query(
            `INSERT INTO laptop_alerts (device_id,severity,alert_type,message)
             VALUES ($1,$2,'USB DLP Risk',$3) RETURNING id`,
            [device.device_id, risk.riskLevel, `${event.file_name || "A file"} was written to removable media. ${risk.matches.join("; ")}.`]
          );
          let ticket = null;
          try {
            ticket = await createDlpIncident(device, event, risk, alert.rows[0].id, permission.policy);
          } catch (ticketError) {
            console.error("[laptop-monitoring:usb-dlp-ticket]", ticketError.message);
          }
          const updated = await db.query(
            `UPDATE endpoint_usb_events SET alert_id=$2,ticket_id=$3,dlp_action=$4 WHERE id=$1 RETURNING *`,
            [record.id, alert.rows[0].id, ticket?.id || null, ticket ? "incident_created" : "alerted"]
          );
          saved.push(updated.rows[0]);
        } else {
          saved.push(record);
        }
      }
      return res.status(201).json({ success: true, message: "USB events processed.", data: { accepted: saved.length, events: saved } });
    } catch (error) {
      console.error("[laptop-monitoring:usb-events]", error.message);
      return res.status(500).json({ success: false, message: "Failed to process USB events." });
    }
  });

  router.get("/dlp-rules", requireAdmin, async (req, res) => {
    if (req.monitoringIsEmployee) {
      return res.status(403).json({ success: false, message: "Employees cannot view DLP rule configuration." });
    }
    const rules = resolveDlpRules({});
    return res.json({
      success: true,
      data: {
        ...rules,
        collection_mode: "metadata_only",
        enforcement_mode: "detect_and_alert",
        note: "Endpoint policies can override extensions, filename keywords, and the large-transfer threshold.",
      },
    });
  });

  router.get("/usb-events/options", requireAdmin, async (req, res) => {
    try {
      const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
      const devices = await db.query(
        `SELECT DISTINCT d.device_uuid,d.hostname,d.device_name
         FROM endpoint_usb_events e
         JOIN monitored_devices d ON d.device_id=e.device_id
         WHERE ($1::int IS NULL OR e.branch_id=$1)
           AND ($2::int IS NULL OR e.assigned_user_id=$2)
         ORDER BY d.hostname`,
        [req.monitoringBranchId, employeeId]
      );
      return res.json({
        success: true,
        data: {
          devices: devices.rows,
          event_types: ["device_connected", "device_disconnected", "file_written"],
          risk_levels: ["Critical", "High", "Medium", "Low"],
        },
      });
    } catch (error) {
      console.error("[laptop-monitoring:usb-event-options]", error.message);
      return res.status(500).json({ success: false, message: "Failed to load USB filter options." });
    }
  });

  router.get("/usb-events", requireAdmin, async (req, res) => {
    try {
      const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(10, Number(req.query.page_size || req.query.limit) || 25));
      const riskLevel = ["Critical", "High", "Medium", "Low"].includes(req.query.risk_level) ? req.query.risk_level : null;
      const eventType = ["device_connected", "device_disconnected", "file_written"].includes(req.query.event_type)
        ? req.query.event_type
        : null;
      const deviceUuid = /^[0-9a-f-]{36}$/i.test(String(req.query.device_uuid || "")) ? String(req.query.device_uuid) : null;
      const search = String(req.query.search || "").trim().slice(0, 200) || null;
      const parseBoundary = (value, endOfDay = false) => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setUTCDate(date.getUTCDate() + 1);
        return date.toISOString();
      };
      const params = [
        req.monitoringBranchId,
        employeeId,
        riskLevel,
        eventType,
        deviceUuid,
        search ? `%${search}%` : null,
        parseBoundary(req.query.date_from),
        parseBoundary(req.query.date_to, true),
      ];
      const where = `WHERE ($1::int IS NULL OR e.branch_id=$1)
        AND ($2::int IS NULL OR e.assigned_user_id=$2)
        AND ($3::text IS NULL OR e.risk_level=$3)
        AND ($4::text IS NULL OR e.event_type=$4)
        AND ($5::text IS NULL OR e.device_uuid::text=$5)
        AND ($6::text IS NULL OR e.file_name ILIKE $6 OR e.relative_path ILIKE $6
          OR d.hostname ILIKE $6 OR u.full_name ILIKE $6 OR e.volume_label ILIKE $6)
        AND ($7::timestamptz IS NULL OR e.occurred_at >= $7)
        AND ($8::timestamptz IS NULL OR e.occurred_at < $8)`;
      const [result, countResult] = await Promise.all([
        db.query(
          `SELECT e.*,d.hostname,d.device_name,u.full_name AS assigned_user,b.branch_name
           FROM endpoint_usb_events e
           JOIN monitored_devices d ON d.device_id=e.device_id
           LEFT JOIN users u ON u.user_id=e.assigned_user_id
           LEFT JOIN branches b ON b.branch_id=e.branch_id
           ${where}
           ORDER BY e.occurred_at DESC LIMIT $9 OFFSET $10`,
          [...params, pageSize, (page - 1) * pageSize]
        ),
        db.query(
          `SELECT COUNT(*)::int AS total
           FROM endpoint_usb_events e
           JOIN monitored_devices d ON d.device_id=e.device_id
           LEFT JOIN users u ON u.user_id=e.assigned_user_id
           ${where}`,
          params
        ),
      ]);
      const total = countResult.rows[0]?.total || 0;
      return res.json({
        success: true,
        data: result.rows,
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (error) {
      console.error("[laptop-monitoring:usb-events-list]", error.message);
      return res.status(500).json({ success: false, message: "Failed to load USB events." });
    }
  });

  router.get("/usb-events/stats", requireAdmin, async (req, res) => {
    try {
      const employeeId = req.monitoringIsEmployee ? req.monitoringUser.userId : null;
      const result = await db.query(
        `SELECT COUNT(*) FILTER (WHERE occurred_at>=CURRENT_DATE)::int AS events_today,
                COUNT(*) FILTER (WHERE event_type='file_written' AND occurred_at>=CURRENT_DATE)::int AS transfers_today,
                COUNT(*) FILTER (WHERE risk_level IN ('High','Critical') AND occurred_at>=CURRENT_DATE)::int AS high_risk_today,
                COUNT(DISTINCT device_id) FILTER (WHERE occurred_at>=CURRENT_DATE)::int AS devices_today,
                COUNT(*) FILTER (WHERE ticket_id IS NOT NULL AND occurred_at>=CURRENT_DATE)::int AS incidents_today
         FROM endpoint_usb_events
         WHERE ($1::int IS NULL OR branch_id=$1) AND ($2::int IS NULL OR assigned_user_id=$2)`,
        [req.monitoringBranchId, employeeId]
      );
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("[laptop-monitoring:usb-events-stats]", error.message);
      return res.status(500).json({ success: false, message: "Failed to load USB statistics." });
    }
  });
}

module.exports = {
  normalizeUsbEvent,
  registerEndpointUsbDlpRoutes,
};
