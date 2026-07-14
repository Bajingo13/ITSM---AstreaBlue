const db = require("../../config/db");

async function applySlaToNewTicket(ticketPayload, queryable = db) {
  const { priority, category_id } = ticketPayload;
    
    // Find matching SLA policy. Try priority + category match first, then fallback to priority only
    let query = `
      SELECT * FROM sla_policies 
      WHERE is_active = true 
      AND priority = $1 
      ORDER BY 
        CASE WHEN category_id::text = $2::text THEN 0 ELSE 1 END,
        policy_id ASC
      LIMIT 1
    `;
  const res = await queryable.query(query, [priority, category_id || null]);
    
  if (res.rows.length === 0) return null;
    
  const policy = res.rows[0];
    
    // Calculate due dates (simplified: ignoring business hours for now)
  const now = new Date();
  const responseDueAt = new Date(now.getTime() + policy.response_target_mins * 60000);
  const resolutionDueAt = new Date(now.getTime() + policy.resolution_target_mins * 60000);
    
  return {
    sla_policy_id: policy.policy_id,
    response_due_at: responseDueAt,
    resolution_due_at: resolutionDueAt,
    response_sla_status: 'Pending',
    resolution_sla_status: 'Pending'
  };
}

module.exports = {
  applySlaToNewTicket
};
