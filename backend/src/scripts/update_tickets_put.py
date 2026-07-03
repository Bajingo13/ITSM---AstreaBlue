import sys

file_path = "C:/Users/janis/asset-monitoring-backend/backend/src/routes/tickets.js"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# I need to find the update query and values array
old_update = """    const result = await db.query(
      `
      UPDATE tickets
      SET
        title = $1,
        description = $2,
        priority = $3,
        status = $4,
        category_id = $5,
        requester_id = $6,
        assigned_to = $7,
        source = $8,
        impact = $9,
        urgency = $10,
        resolution_notes = $11,
        root_cause = $12,
        time_spent_minutes = $13,
        parts_used = $14,
        satisfaction_rating = $15,
        resolved_at = $16,
        closed_at = $17,
        first_response_at = $18
      WHERE id = $19"""

new_update = """    // SLA Calculations on Update
    const isNowResolvedOrClosed = (finalStatus === "Resolved" || finalStatus === "Closed");
    const now = new Date();
    
    let resSlaStat = existing.response_sla_status;
    let resolSlaStat = existing.resolution_sla_status;
    
    if (finalStatus === "Cancelled") {
      resSlaStat = "Cancelled";
      resolSlaStat = "Cancelled";
    } else {
      if (firstResponseAt && !existing.first_response_at) {
        if (existing.response_due_at && firstResponseAt <= existing.response_due_at) resSlaStat = "Met";
        else resSlaStat = "Breached";
      }
      if (isNowResolvedOrClosed && !existing.resolved_at && !existing.closed_at) {
        const endTime = resolvedAt || closedAt || now;
        if (existing.resolution_due_at && endTime <= existing.resolution_due_at) resolSlaStat = "Met";
        else resolSlaStat = "Breached";
      }
    }

    const result = await db.query(
      `
      UPDATE tickets
      SET
        title = $1,
        description = $2,
        priority = $3,
        status = $4,
        category_id = $5,
        requester_id = $6,
        assigned_to = $7,
        source = $8,
        impact = $9,
        urgency = $10,
        resolution_notes = $11,
        root_cause = $12,
        time_spent_minutes = $13,
        parts_used = $14,
        satisfaction_rating = $15,
        resolved_at = $16,
        closed_at = $17,
        first_response_at = $18,
        response_sla_status = $20,
        resolution_sla_status = $21
      WHERE id = $19"""

content = content.replace(old_update, new_update)

old_values_put = """        resolvedAt,
        closedAt,
        firstResponseAt,
        id,
      ]"""

new_values_put = """        resolvedAt,
        closedAt,
        firstResponseAt,
        id,
        resSlaStat,
        resolSlaStat
      ]"""
content = content.replace(old_values_put, new_values_put)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Tickets.js PUT update complete")
