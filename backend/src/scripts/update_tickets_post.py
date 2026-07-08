import sys

file_path = "C:/Users/janis/asset-monitoring-backend/backend/src/routes/tickets.js"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace import
content = content.replace(
    'const { calculateSlaDueDate } = require("../services/slaService");',
    'const { applySlaToNewTicket } = require("../services/slaService");'
)

# Replace ticket insertion columns and values
old_insert = """
    const slaDueDate = await calculateSlaDueDate(priority || "P3-Medium");

    const result = await db.query(
      `
      INSERT INTO tickets
      (
        ticket_number,
        title,
        description,
        priority,
        status,
        category_id,
        requester_id,
        assigned_to,
        branch_id,
        source,
        impact,
        urgency,
        sla_due_date
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING
"""

new_insert = """
    const slaData = await applySlaToNewTicket({ priority: priority || "P3-Medium", category_id });
    
    // Fallback if no SLA policy matched
    const slaPolicyId = slaData ? slaData.sla_policy_id : null;
    const responseDueAt = slaData ? slaData.response_due_at : null;
    const resolutionDueAt = slaData ? slaData.resolution_due_at : null;
    const responseStatus = slaData ? slaData.response_sla_status : 'Pending';
    const resolutionStatus = slaData ? slaData.resolution_sla_status : 'Pending';
    // Backwards compatibility with sla_due_date
    const slaDueDate = resolutionDueAt || (new Date(Date.now() + 24 * 60 * 60 * 1000));

    const result = await db.query(
      `
      INSERT INTO tickets
      (
        ticket_number,
        title,
        description,
        priority,
        status,
        category_id,
        requester_id,
        assigned_to,
        branch_id,
        source,
        impact,
        urgency,
        sla_due_date,
        sla_policy_id,
        response_due_at,
        resolution_due_at,
        response_sla_status,
        resolution_sla_status
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING
"""
content = content.replace(old_insert, new_insert)

# Replace values array
old_values = "      [ticketNumber, title, description, priority || \"P3-Medium\", status || \"Open Queue\", category_id || null, requester_id || null, assigned_to || null, userBranch, source || \"portal\", impact || \"Medium\", urgency || \"Medium\", slaDueDate]"
new_values = "      [ticketNumber, title, description, priority || \"P3-Medium\", status || \"Open Queue\", category_id || null, requester_id || null, assigned_to || null, userBranch, source || \"portal\", impact || \"Medium\", urgency || \"Medium\", slaDueDate, slaPolicyId, responseDueAt, resolutionDueAt, responseStatus, resolutionStatus]"
content = content.replace(old_values, new_values)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Tickets.js POST update complete")
