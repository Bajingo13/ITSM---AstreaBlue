const db = require("../config/db");

const confirmed = process.argv.includes("--confirm");

function plusDays(days, hour = 9) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value.toISOString();
}

async function upsertConfigItem(client, branchId, categoryId, item) {
  const existing = await client.query(
    "SELECT ci_id FROM config_items WHERE ci_name=$1 AND branch_id=$2 LIMIT 1",
    [item.name, branchId]
  );
  if (existing.rows[0]) return existing.rows[0].ci_id;

  const result = await client.query(
    `INSERT INTO config_items
      (ci_name,ci_type,category_id,description,branch_id,environment,ip_address,operating_system,owner,status,version,location)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING ci_id`,
    [
      item.name, item.type, categoryId, item.description, branchId,
      item.environment, item.ip, item.os, item.owner, item.status,
      item.version, item.location,
    ]
  );
  return result.rows[0].ci_id;
}

async function upsertChange(client, branchId, ownerId, values) {
  const result = await client.query(
    `INSERT INTO change_requests
      (change_number,title,description,change_type,category,priority,status,branch_id,requester_id,owner_id,
       planned_start,planned_end,impact_level,risk_level,business_justification,implementation_plan,testing_plan,
       backout_plan,communication_plan,post_implementation_verification,risk_score,security_impact,
       compliance_impact,data_loss_risk,operational_risk,linked_cis)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     ON CONFLICT(change_number) DO UPDATE SET
       title=EXCLUDED.title,description=EXCLUDED.description,status=EXCLUDED.status,
       planned_start=EXCLUDED.planned_start,planned_end=EXCLUDED.planned_end,
       linked_cis=EXCLUDED.linked_cis,updated_at=NOW()
     RETURNING id`,
    [
      values.number, values.title, values.description, values.type, values.category,
      values.priority, values.status, branchId, ownerId, values.start, values.end,
      values.impact, values.risk, values.justification, values.implementation,
      values.testing, values.backout, values.communication, values.verification,
      values.riskScore, values.securityImpact, values.complianceImpact,
      values.dataLossRisk, values.operationalRisk, JSON.stringify(values.linkedCis),
    ]
  );
  await client.query(
    `INSERT INTO change_activities(change_id,actor_id,event_type,message,metadata)
     SELECT $1,$2,'demo_seed',$3,$4
     WHERE NOT EXISTS (SELECT 1 FROM change_activities WHERE change_id=$1 AND event_type='demo_seed')`,
    [result.rows[0].id, ownerId, `Presentation demo record prepared: ${values.number}.`, JSON.stringify({ demo: true })]
  );
  return result.rows[0].id;
}

async function upsertRelease(client, branchId, ownerId, values) {
  const result = await client.query(
    `INSERT INTO release_plans
      (release_number,title,description,environment,status,branch_id,owner_id,scheduled_start,scheduled_end,
       progress,package_details,dependencies,checklist,release_notes,validation_notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(release_number) DO UPDATE SET
       title=EXCLUDED.title,description=EXCLUDED.description,status=EXCLUDED.status,
       progress=EXCLUDED.progress,scheduled_start=EXCLUDED.scheduled_start,
       scheduled_end=EXCLUDED.scheduled_end,updated_at=NOW()
     RETURNING id`,
    [
      values.number, values.title, values.description, values.environment,
      values.status, branchId, ownerId, values.start, values.end, values.progress,
      JSON.stringify(values.packages), JSON.stringify(values.dependencies),
      JSON.stringify(values.checklist), values.notes, values.validation,
    ]
  );
  return result.rows[0].id;
}

async function upsertRollback(client, branchId, ownerId, values) {
  const result = await client.query(
    `INSERT INTO rollback_procedures
      (rollback_number,title,description,status,branch_id,owner_id,linked_change_id,linked_release_id,
       recovery_plan,checklist,version,approved_by,approved_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11::integer,CASE WHEN $11::integer IS NULL THEN NULL ELSE NOW() END)
     ON CONFLICT(rollback_number) DO UPDATE SET
       title=EXCLUDED.title,description=EXCLUDED.description,status=EXCLUDED.status,
       linked_change_id=EXCLUDED.linked_change_id,linked_release_id=EXCLUDED.linked_release_id,
       recovery_plan=EXCLUDED.recovery_plan,checklist=EXCLUDED.checklist,updated_at=NOW()
     RETURNING id`,
    [
      values.number, values.title, values.description, values.status, branchId,
      ownerId, values.changeId, values.releaseId, values.plan,
      JSON.stringify(values.checklist), values.status === "Draft" ? null : ownerId,
    ]
  );
  const rollbackId = result.rows[0].id;
  await client.query(
    `INSERT INTO rollback_versions(rollback_id,version,recovery_plan,checklist,changed_by)
     VALUES($1,1,$2,$3,$4) ON CONFLICT(rollback_id,version) DO NOTHING`,
    [rollbackId, values.plan, JSON.stringify(values.checklist), ownerId]
  );
  await client.query(
    `INSERT INTO rollback_execution_logs(rollback_id,actor_id,action,details)
     SELECT $1,$2,'Demo Prepared',$3
     WHERE NOT EXISTS (SELECT 1 FROM rollback_execution_logs WHERE rollback_id=$1 AND action='Demo Prepared')`,
    [rollbackId, ownerId, "Presentation-ready rollback evidence created."]
  );
  return rollbackId;
}

async function main() {
  if (!confirmed) {
    console.log("No data was changed. Run with --confirm to insert the idempotent presentation demo records.");
    console.log("Command: npm run demo:seed -- --confirm");
    await db.rawPool.end();
    return;
  }

  const client = await db.rawPool.connect();
  try {
    await client.query("BEGIN");
    const branch = (await client.query("SELECT branch_id,branch_name FROM branches ORDER BY branch_id LIMIT 1")).rows[0];
    if (!branch) throw new Error("Create at least one branch before seeding presentation data.");

    const owner = (await client.query(
      `SELECT u.user_id,u.full_name FROM users u
       LEFT JOIN system_roles r ON r.role_id=u.role_id
       ORDER BY CASE WHEN LOWER(COALESCE(r.role_name,''))='superadmin' THEN 0 ELSE 1 END,u.user_id
       LIMIT 1`
    )).rows[0];
    if (!owner) throw new Error("Create at least one user before seeding presentation data.");

    for (const [name, description] of [
      ["Server", "Physical or virtual servers"],
      ["Application", "Software applications and services"],
      ["Database", "Database instances and clusters"],
      ["Network Device", "Routers, switches, firewalls, and gateways"],
    ]) {
      await client.query(
        "INSERT INTO ci_categories(category_name,description) VALUES($1,$2) ON CONFLICT(category_name) DO NOTHING",
        [name, description]
      );
    }
    const categories = Object.fromEntries((await client.query(
      "SELECT ci_category_id,category_name FROM ci_categories WHERE category_name=ANY($1::text[])",
      [["Server", "Application", "Database", "Network Device"]]
    )).rows.map((row) => [row.category_name, row.ci_category_id]));

    const ci = {};
    ci.gateway = await upsertConfigItem(client, branch.branch_id, categories["Network Device"], {
      name: "AB-DEMO-API-GATEWAY-01", type: "API Gateway", description: "Routes Inventory System traffic into AstreaBlue services.",
      environment: "Production", ip: "10.20.10.10", os: "Linux", owner: "IT Operations", status: "Active", version: "1.4.0", location: "Primary Data Center",
    });
    ci.application = await upsertConfigItem(client, branch.branch_id, categories.Application, {
      name: "AB-DEMO-INVENTORY-APP-01", type: "Application", description: "Inventory integration and stock management application service.",
      environment: "Production", ip: "10.20.20.15", os: "Ubuntu Server 24.04", owner: "Business Applications", status: "Active", version: "2.3.1", location: "Application Cluster",
    });
    ci.database = await upsertConfigItem(client, branch.branch_id, categories.Database, {
      name: "AB-DEMO-INVENTORY-DB-01", type: "Database", description: "PostgreSQL database supporting Inventory System transactions.",
      environment: "Production", ip: "10.20.30.21", os: "PostgreSQL 16", owner: "Database Operations", status: "Active", version: "16.3", location: "Database Cluster",
    });
    ci.server = await upsertConfigItem(client, branch.branch_id, categories.Server, {
      name: "AB-DEMO-WEB-SERVER-01", type: "Server", description: "Web node hosting the AstreaBlue service portal.",
      environment: "Production", ip: "10.20.20.11", os: "Windows Server 2022", owner: "Infrastructure Team", status: "Active", version: "2022", location: "Primary Data Center",
    });

    for (const relationship of [
      [ci.application, ci.gateway, "connects_to", "Inventory application sends ticket requests through the API gateway."],
      [ci.application, ci.database, "depends_on", "Inventory application requires the transactional database."],
      [ci.gateway, ci.server, "hosted_on", "Gateway services are hosted in the application tier."],
    ]) {
      await client.query(
        `INSERT INTO ci_dependencies(source_ci_id,target_ci_id,relationship_type,description,created_by,branch_id)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_ci_id,target_ci_id,relationship_type) DO NOTHING`,
        [...relationship, owner.user_id, branch.branch_id]
      );
    }

    const change1 = await upsertChange(client, branch.branch_id, owner.user_id, {
      number: "CHG-DEMO-001", title: "Deploy Inventory Ticket Gateway v1.0", description: "Enable centralized ticket submission from Inventory System through the external API gateway.",
      type: "Normal", category: "Application", priority: "High", status: "Approved", start: plusDays(1, 20), end: plusDays(1, 22), impact: "Medium", risk: "Medium",
      justification: "Standardizes employee support intake and provides traceable service ownership.", implementation: "Deploy gateway configuration, validate API credentials, submit a controlled test ticket, and monitor logs.",
      testing: "Verify 201 creation, 200 idempotent replay, status lookup, audit logging, and centralized queue visibility.", backout: "Disable the integration key, restore the previous gateway configuration, and verify internal ticketing remains available.",
      communication: "Notify Service Desk, Inventory product owner, and change stakeholders before and after deployment.", verification: "Confirm ticket prefix, SLA creation, notifications, and audit trail.",
      riskScore: 6, securityImpact: "Low", complianceImpact: "Low", dataLossRisk: "Low", operationalRisk: "Medium", linkedCis: [ci.gateway, ci.application, ci.database],
    });
    const change2 = await upsertChange(client, branch.branch_id, owner.user_id, {
      number: "CHG-DEMO-002", title: "Upgrade Production Database Maintenance Release", description: "Apply the approved PostgreSQL maintenance package and verify application compatibility.",
      type: "Standard", category: "Database", priority: "Medium", status: "Pending CAB Review", start: plusDays(4, 21), end: plusDays(5, 0), impact: "High", risk: "High",
      justification: "Maintains vendor support and resolves security and stability defects.", implementation: "Take backup, drain connections, apply update, restart services, and execute smoke tests.",
      testing: "Run database health checks, application login, inventory search, and ticket submission tests.", backout: "Stop services, restore the pre-change snapshot, validate replication, and reopen connections.",
      communication: "CAB, Database Operations, Application Support, and Service Desk receive milestone updates.", verification: "Validate replication, query latency, error logs, and business transaction success.",
      riskScore: 12, securityImpact: "Medium", complianceImpact: "Low", dataLossRisk: "Medium", operationalRisk: "High", linkedCis: [ci.database, ci.application],
    });
    await upsertChange(client, branch.branch_id, owner.user_id, {
      number: "CHG-DEMO-003", title: "Optimize API Gateway Health Checks", description: "Tune gateway health checks to reduce false-positive service alerts.",
      type: "Standard", category: "Infrastructure", priority: "Low", status: "Implemented", start: plusDays(-2, 19), end: plusDays(-2, 20), impact: "Low", risk: "Low",
      justification: "Improves monitoring accuracy without changing service behavior.", implementation: "Update health-check intervals and thresholds, then reload gateway configuration.",
      testing: "Simulate healthy and unhealthy upstream services and verify alerts.", backout: "Restore previous thresholds and reload configuration.",
      communication: "Notify Endpoint and Service Desk teams.", verification: "Confirm stable health status for one hour.",
      riskScore: 2, securityImpact: "None", complianceImpact: "None", dataLossRisk: "None", operationalRisk: "Low", linkedCis: [ci.gateway],
    });

    const release1 = await upsertRelease(client, branch.branch_id, owner.user_id, {
      number: "REL-DEMO-001", title: "Inventory Integration Release 1.0", description: "Production release of the centralized Inventory System ticket gateway.",
      environment: "Production", status: "Scheduled", start: plusDays(1, 20), end: plusDays(1, 22), progress: 25,
      packages: ["inventory-gateway-config-v1.0", "external-ticket-contract-v1"], dependencies: ["API key active", "Service Desk queue available", "Rollback procedure approved"],
      checklist: [{ id: 1, label: "Confirm CAB approval", complete: true }, { id: 2, label: "Validate API key", complete: true }, { id: 3, label: "Submit production smoke test", complete: false }, { id: 4, label: "Verify monitoring and audit logs", complete: false }],
      notes: "Introduces Inventory System as an authenticated external ticket source.", validation: "Awaiting scheduled deployment window.",
    });
    const release2 = await upsertRelease(client, branch.branch_id, owner.user_id, {
      number: "REL-DEMO-002", title: "Database Maintenance Release 16.3", description: "Controlled PostgreSQL maintenance deployment with application validation.",
      environment: "Staging", status: "Verifying", start: plusDays(-1, 20), end: plusDays(-1, 23), progress: 80,
      packages: ["postgresql-16.3-maintenance", "db-validation-suite"], dependencies: ["Backup verified", "Application test account", "DBA on call"],
      checklist: [{ id: 1, label: "Snapshot completed", complete: true }, { id: 2, label: "Maintenance installed", complete: true }, { id: 3, label: "Application smoke test", complete: true }, { id: 4, label: "Performance validation", complete: false }],
      notes: "Staging rehearsal for the upcoming production database change.", validation: "Functional tests passed; performance verification is in progress.",
    });
    await client.query("INSERT INTO change_release_links(change_id,release_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [change1, release1]);
    await client.query("INSERT INTO change_release_links(change_id,release_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [change2, release2]);

    await upsertRollback(client, branch.branch_id, owner.user_id, {
      number: "RBK-DEMO-001", title: "Inventory Gateway Release Recovery", description: "Return Inventory ticket integration to the pre-release state.", status: "Available", changeId: change1, releaseId: release1,
      plan: "1. Disable the Inventory integration key.\n2. Restore the previous gateway configuration.\n3. Reload gateway services.\n4. Submit an internal portal ticket smoke test.\n5. Confirm external requests are blocked and internal ticketing remains healthy.\n6. Notify stakeholders and attach validation evidence.",
      checklist: [{ id: 1, label: "Integration key disabled", complete: false }, { id: 2, label: "Previous configuration restored", complete: false }, { id: 3, label: "Internal ticketing verified", complete: false }, { id: 4, label: "Stakeholders notified", complete: false }],
    });
    await upsertRollback(client, branch.branch_id, owner.user_id, {
      number: "RBK-DEMO-002", title: "Database Maintenance Restore Procedure", description: "Restore database services from the verified pre-maintenance snapshot.", status: "Approved", changeId: change2, releaseId: release2,
      plan: "1. Stop application writes.\n2. Isolate the affected database node.\n3. Restore the verified snapshot.\n4. Validate replication and integrity.\n5. Reconnect the application.\n6. Execute transaction and ticket gateway smoke tests.",
      checklist: [{ id: 1, label: "Writes stopped", complete: false }, { id: 2, label: "Snapshot restored", complete: false }, { id: 3, label: "Integrity verified", complete: false }, { id: 4, label: "Application reconnected", complete: false }],
    });

    await client.query("COMMIT");
    console.log(`Presentation demo data is ready for branch: ${branch.branch_name}.`);
    console.log("Created or reused: 4 configuration items, 3 relationships, 3 changes, 2 releases, and 2 rollback procedures.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await db.rawPool.end();
  }
}

main().catch((error) => {
  console.error("Presentation demo seed failed:", error.message);
  process.exitCode = 1;
});
