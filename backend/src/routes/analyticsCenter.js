const express = require("express");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const db = require("../../config/db");
const { getRequestContext } = require("./_ticketAccess");
const { ensureReplacementSchema } = require("../services/replacementSchemaService");

const router = express.Router();
const summaryCache = new Map();
const CACHE_TTL_MS = 30_000;

function requireAnalytics(req, res, next) {
  const context = getRequestContext(req);
  const role = String(context.roleName || "").toLowerCase();
  if (!context.authenticated) return res.status(401).json({ success: false, message: "Authentication required.", data: null });
  if (!["superadmin", "admin"].includes(role)) return res.status(403).json({ success: false, message: "Analytics access is limited to administrators.", data: null });
  if (role !== "superadmin" && !context.branchId) return res.status(403).json({ success: false, message: "An assigned branch is required.", data: null });
  req.analyticsContext = { ...context, role };
  return next();
}

function requireManagerAnalytics(_req, _res, next) { return next(); }

const n = (value) => Number(value || 0);
function scope(role, branchId, alias, column = "branch_id") {
  return role === "superadmin" ? { sql: "1=1", params: [] } : { sql: `${alias}.${column}=$1`, params: [branchId] };
}

router.get("/summary", requireAnalytics, async (req, res) => {
  const { role, branchId } = req.analyticsContext;
  const days = [30,90,180,365].includes(Number(req.query.days)) ? Number(req.query.days) : 180;
  const cacheKey = `${role}:${branchId || "all"}:${days}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return res.json({ success: true, message: "Enterprise analytics loaded.", data: cached.data, meta: { cached: true } });
  try {
    await ensureReplacementSchema();
    const baseTicketScope = scope(role, branchId, "t");
    const ts = { sql: baseTicketScope.sql, params: [...baseTicketScope.params] };
    ts.params.push(days); ts.sql += ` AND t.created_at>=CURRENT_DATE-($${ts.params.length}::int*INTERVAL '1 day')`;
    const assetScope = scope(role, branchId, "a");
    const ds = scope(role, branchId, "d");
    const cs = scope(role, branchId, "c");
    const ks = scope(role, branchId, "k");
    const ps = scope(role, branchId, "p");
    const [tickets, incidentTrend, incidentCategories, incidentHeatmap, problems, rootCauses, assets, assetDistribution, endpoints, endpointAlerts, screenshots, softwareCompliance, consents, knowledge, knowledgeTop, projects, resources, replacementManagement, replacementRecent] = await Promise.all([
      db.query(`SELECT COUNT(*) FILTER(WHERE t.status IN ('Open Queue','In Progress'))::int open_incidents,
        COUNT(*) FILTER(WHERE t.status='Resolved' AND t.resolved_at::date=CURRENT_DATE)::int resolved_today,
        COUNT(*) FILTER(WHERE t.priority='P1-Critical' AND t.status NOT IN ('Resolved','Closed','Cancelled'))::int critical_incidents,
        COUNT(*) FILTER(WHERE t.assigned_to IS NOT NULL AND t.status NOT IN ('Resolved','Closed','Cancelled'))::int assigned_tickets,
        COALESCE(AVG(EXTRACT(EPOCH FROM (t.resolved_at-t.created_at))/3600) FILTER(WHERE t.resolved_at IS NOT NULL),0) avg_resolution_hours,
        COALESCE(AVG(EXTRACT(EPOCH FROM (t.first_response_at-t.created_at))/60) FILTER(WHERE t.first_response_at IS NOT NULL),0) avg_response_minutes,
        COUNT(*) FILTER(WHERE LOWER(COALESCE(t.resolution_sla_status,''))='met')::int sla_met,
        COUNT(*) FILTER(WHERE LOWER(COALESCE(t.resolution_sla_status,''))='breached')::int sla_violated
        FROM tickets t WHERE ${ts.sql}`, ts.params),
      db.query(`SELECT TO_CHAR(DATE_TRUNC('month',t.created_at),'YYYY-MM') period,COUNT(*)::int count FROM tickets t
        WHERE ${ts.sql} GROUP BY DATE_TRUNC('month',t.created_at) ORDER BY DATE_TRUNC('month',t.created_at)`, ts.params),
      db.query(`SELECT COALESCE(tc.category_name,'Uncategorized') category,COUNT(*)::int count FROM tickets t LEFT JOIN ticket_categories tc ON tc.category_id=t.category_id WHERE ${ts.sql} GROUP BY tc.category_name ORDER BY count DESC LIMIT 6`,ts.params),
      db.query(`SELECT EXTRACT(ISODOW FROM t.created_at)::int day_index,EXTRACT(HOUR FROM t.created_at)::int hour_index,COUNT(*)::int count FROM tickets t WHERE ${ts.sql} GROUP BY 1,2 ORDER BY 1,2`,ts.params),
      db.query(`SELECT t.title,COUNT(*)::int occurrences FROM tickets t WHERE ${ts.sql}
        GROUP BY LOWER(t.title),t.title HAVING COUNT(*)>1 ORDER BY occurrences DESC LIMIT 5`, ts.params),
      db.query(`SELECT COALESCE(tc.category_name,'Uncategorized') category,COUNT(*)::int count FROM tickets t
        LEFT JOIN ticket_categories tc ON tc.category_id=t.category_id WHERE ${ts.sql} AND NULLIF(TRIM(t.root_cause),'') IS NOT NULL
        GROUP BY tc.category_name ORDER BY count DESC LIMIT 6`, ts.params),
      db.query(`SELECT COUNT(*)::int total_assets,
        COUNT(*) FILTER(WHERE LOWER(COALESCE(a.status,'')) IN ('assigned','borrowed','in use'))::int assigned_assets,
        COUNT(*) FILTER(WHERE LOWER(COALESCE(a.status,'')) IN ('available','active'))::int available_assets,
        COUNT(*) FILTER(WHERE a.warranty_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE+INTERVAL '90 days')::int warranty_expiring,
        COUNT(*) FILTER(WHERE LOWER(COALESCE(a.status,'')) NOT IN ('disposed','lost','damaged'))::int healthy_assets,
        COALESCE(SUM(a.purchase_price),0) asset_value FROM hardware_assets a WHERE ${assetScope.sql}`, assetScope.params),
      db.query(`SELECT COALESCE(NULLIF(TRIM(a.status),''),'Unknown') label,COUNT(*)::int value FROM hardware_assets a WHERE ${assetScope.sql} GROUP BY a.status ORDER BY value DESC LIMIT 8`,assetScope.params),
      db.query(`SELECT COUNT(*)::int total_devices,
        COUNT(*) FILTER(WHERE d.last_seen_at>=NOW()-INTERVAL '10 minutes')::int online_devices,
        COUNT(*) FILTER(WHERE d.last_seen_at<NOW()-INTERVAL '10 minutes' OR d.last_seen_at IS NULL)::int offline_devices,
        COUNT(*) FILTER(WHERE LOWER(COALESCE(d.consent_status,'')) NOT IN ('approved','granted','active'))::int awaiting_consent,
        MAX(d.last_seen_at) last_heartbeat FROM monitored_devices d WHERE ${ds.sql}`, ds.params),
      db.query(`SELECT COUNT(*) FILTER(WHERE LOWER(a.status) NOT IN ('resolved','closed'))::int open_alerts,
        COUNT(*) FILTER(WHERE LOWER(a.status) NOT IN ('resolved','closed') AND LOWER(a.severity) IN ('high','critical'))::int critical_alerts,
        COUNT(*) FILTER(WHERE LOWER(a.status) NOT IN ('resolved','closed') AND LOWER(a.alert_type) LIKE '%usb%')::int usb_alerts
        FROM laptop_alerts a JOIN monitored_devices d ON d.device_id=a.device_id WHERE ${ds.sql}`, ds.params),
      db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE s.captured_at>=NOW()-INTERVAL '24 hours')::int recent
        FROM laptop_screenshots s JOIN monitored_devices d ON d.device_id=s.device_id WHERE ${ds.sql}`, ds.params),
      db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE LOWER(COALESCE(s.compliance_status,''))='compliant')::int compliant
        FROM endpoint_software_inventory s WHERE ${role === 'superadmin' ? '1=1' : 's.branch_id=$1'}`, role === 'superadmin' ? [] : [branchId]),
      db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE LOWER(COALESCE(c.status,'')) IN ('approved','active'))::int approved,
        COUNT(*) FILTER(WHERE LOWER(COALESCE(c.status,'')) IN ('pending','requested','revision required'))::int pending,
        COUNT(*) FILTER(WHERE LOWER(COALESCE(c.status,''))='expired')::int expired FROM consent_documents c WHERE ${cs.sql}`, cs.params),
      db.query(`SELECT COUNT(*)::int published,COALESCE(SUM(k.views),0)::int articles_used,
        COUNT(*) FILTER(WHERE COALESCE(k.helpful_count,0)>0)::int suggested FROM knowledge_base k WHERE ${ks.sql}`, ks.params),
      db.query(`SELECT k.title,COALESCE(k.views,0)::int views FROM knowledge_base k WHERE ${ks.sql} ORDER BY COALESCE(k.views,0) DESC,k.title LIMIT 5`,ks.params),
      db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE LOWER(p.status)='on track')::int on_track,
        COUNT(*) FILTER(WHERE LOWER(p.status)='at risk')::int at_risk,COUNT(*) FILTER(WHERE LOWER(p.status)='delayed')::int delayed,
        MIN(COALESCE(p.projected_finish_date,p.planned_finish_date)) FILTER(WHERE COALESCE(p.projected_finish_date,p.planned_finish_date)>=CURRENT_DATE) forecast_finish
        FROM it_projects p WHERE p.is_active=true AND ${ps.sql}`, ps.params),
      db.query(`SELECT COUNT(*)::int technicians,COALESCE(SUM(workload.open_count),0)::int open_assignments,
        COALESCE(AVG(workload.open_count),0) avg_queue FROM (
          SELECT u.user_id,COUNT(t.id) FILTER(WHERE t.status NOT IN ('Resolved','Closed','Cancelled'))::int open_count
          FROM users u JOIN system_roles r ON r.role_id=u.role_id LEFT JOIN tickets t ON t.assigned_to=u.user_id
          WHERE LOWER(r.role_name)='technician' AND ${role === 'superadmin' ? '1=1' : 'u.branch_id=$1'} GROUP BY u.user_id
        ) workload`, role === 'superadmin' ? [] : [branchId]),
      db.query(`WITH scoped AS (
          SELECT * FROM replacement_requests rr WHERE ${role === 'superadmin' ? '1=1' : 'rr.branch_id=$1'}
        ), trend AS (
          SELECT TO_CHAR(DATE_TRUNC('month',created_at),'YYYY-MM') period,COUNT(*)::int count
          FROM scoped WHERE created_at>=CURRENT_DATE-INTERVAL '6 months'
          GROUP BY DATE_TRUNC('month',created_at)
        ) SELECT
          (SELECT COUNT(*)::int FROM scoped WHERE status NOT IN ('Completed','Repaired','Rejected','Cancelled')) active_requests,
          (SELECT COUNT(*)::int FROM scoped WHERE status='Awaiting Approval') awaiting_approval,
          (SELECT COUNT(*)::int FROM scoped WHERE status='Replacement Reserved') reserved_assets,
          (SELECT COUNT(*)::int FROM scoped WHERE status='Issued') issued_requests,
          (SELECT COUNT(*)::int FROM scoped WHERE status='Completed') completed_requests,
          (SELECT COUNT(*)::int FROM scoped WHERE status='Repair Recommended') repair_recommended,
          (SELECT COUNT(*)::int FROM scoped WHERE status='In Repair') in_repair,
          (SELECT COUNT(*)::int FROM scoped WHERE status='Repaired') repaired,
          (SELECT COALESCE(JSON_AGG(trend ORDER BY period),'[]'::json) FROM trend) trend`, role === 'superadmin' ? [] : [branchId]),
      db.query(`SELECT h.message,h.event_type,h.created_at,rr.request_number
        FROM replacement_request_history h JOIN replacement_requests rr ON rr.id=h.replacement_request_id
        WHERE ${role === 'superadmin' ? '1=1' : 'rr.branch_id=$1'} ORDER BY h.created_at DESC LIMIT 6`,role === 'superadmin'?[]:[branchId]),
    ]);
    const ticket = tickets.rows[0] || {}; const asset = assets.rows[0] || {}; const endpoint = endpoints.rows[0] || {};
    const alert = endpointAlerts.rows[0] || {}; const screenshot = screenshots.rows[0] || {}; const sw = softwareCompliance.rows[0] || {}; const consent = consents.rows[0] || {};
    const project = projects.rows[0] || {}; const resourceRows=resources.rows; const replacementRow=replacementManagement.rows[0]||{};
    const replacementData={active_requests:n(replacementRow.active_requests),awaiting_approval:n(replacementRow.awaiting_approval),reserved_assets:n(replacementRow.reserved_assets),issued_requests:n(replacementRow.issued_requests),completed_requests:n(replacementRow.completed_requests),repair_recommended:n(replacementRow.repair_recommended),trend:replacementRow.trend||[]};
    const slaTotal=n(ticket.sla_met)+n(ticket.sla_violated); const totalAssets=n(asset.total_assets); const totalDevices=n(endpoint.total_devices);
    const data = {
      service_desk:{open_incidents:n(ticket.open_incidents),resolved_today:n(ticket.resolved_today),critical_incidents:n(ticket.critical_incidents),assigned_tickets:n(ticket.assigned_tickets),avg_resolution_hours:Number(n(ticket.avg_resolution_hours).toFixed(1)),avg_response_minutes:Number(n(ticket.avg_response_minutes).toFixed(1)),sla_compliance_pct:slaTotal?Math.round(n(ticket.sla_met)/slaTotal*100):0,trend:incidentTrend.rows,top_categories:incidentCategories.rows,heatmap:incidentHeatmap.rows},
      problems:{recurring_problems:problems.rows.length,known_errors:rootCauses.rows.reduce((s,r)=>s+n(r.count),0),root_cause_categories:rootCauses.rows,problem_trends:incidentTrend.rows,most_frequent_category:rootCauses.rows[0]?.category||null,top_recurring_incident:problems.rows[0]?.title||null},
      assets:{total_assets:totalAssets,assigned_assets:n(asset.assigned_assets),available_assets:n(asset.available_assets),warranty_expiring:n(asset.warranty_expiring),health_score:totalAssets?Math.round(n(asset.healthy_assets)/totalAssets*100):0,assignment_rate:totalAssets?Math.round(n(asset.assigned_assets)/totalAssets*100):0,asset_value:n(asset.asset_value),depreciation_summary:"Not configured",lifecycle_distribution:assetDistribution.rows},
      endpoints:{online_devices:n(endpoint.online_devices),offline_devices:n(endpoint.offline_devices),critical_alerts:n(alert.critical_alerts),open_alerts:n(alert.open_alerts),policy_compliance_pct:n(sw.total)?Math.round(n(sw.compliant)/n(sw.total)*100):0,awaiting_consent:n(endpoint.awaiting_consent),last_heartbeat:endpoint.last_heartbeat||null,endpoint_health_pct:totalDevices?Math.round(n(endpoint.online_devices)/totalDevices*100):0,usb_alerts:n(alert.usb_alerts),screenshot_monitoring_status:n(screenshot.recent)>0?"Active":"No captures in 24 hours"},
      sla:{met:n(ticket.sla_met),violated:n(ticket.sla_violated),avg_response_minutes:Number(n(ticket.avg_response_minutes).toFixed(1)),avg_resolution_hours:Number(n(ticket.avg_resolution_hours).toFixed(1))},
      knowledge:{published_articles:n(knowledge.rows[0]?.published),articles_used:n(knowledge.rows[0]?.articles_used),suggested_articles:n(knowledge.rows[0]?.suggested),search_trends:[],most_viewed:knowledgeTop.rows},
      compliance:{consent_pct:n(consent.total)?Math.round(n(consent.approved)/n(consent.total)*100):0,policy_compliance_pct:n(sw.total)?Math.round(n(sw.compliant)/n(sw.total)*100):0,pending_consents:n(consent.pending),expired_consents:n(consent.expired)},
      resources:{technicians:resourceRows.reduce((s,r)=>s+n(r.technicians),0),open_assignments:resourceRows.reduce((s,r)=>s+n(r.open_assignments),0),average_queue:resourceRows.length?Number((resourceRows.reduce((s,r)=>s+n(r.avg_queue),0)/resourceRows.length).toFixed(1)):0,capacity_pct:resourceRows.length?Math.max(0,Math.round(100-(resourceRows.reduce((s,r)=>s+n(r.avg_queue),0)/resourceRows.length)*10)):100},
      projects:{current_projects:n(project.total),on_track:n(project.on_track),at_risk:n(project.at_risk),delayed:n(project.delayed),forecast_completion:project.forecast_finish||null},
      replacements:{available:true,...replacementData,recent_activity:replacementRecent.rows},
      generated_at:new Date().toISOString()
    };
    summaryCache.set(cacheKey,{createdAt:Date.now(),data}); return res.json({success:true,message:"Enterprise analytics loaded.",data,meta:{cached:false}});
  } catch(error) { console.error("Enterprise analytics error:",error.message); return res.status(500).json({success:false,message:"Failed to load enterprise analytics.",data:null}); }
});

function buildReportQuery(req) {
  const { role, branchId }=req.analyticsContext; const clauses=[]; const params=[];
  const add=(sql,value)=>{params.push(value);clauses.push(sql.replace('?',`$${params.length}`));};
  if(role!=='superadmin') add('t.branch_id=?',branchId);
  const q=req.query;
  if(q.date_from)add('t.created_at::date>=?',q.date_from); if(q.date_to)add('t.created_at::date<=?',q.date_to);
  if(q.branch_id&&role==='superadmin')add('t.branch_id=?',q.branch_id); if(q.priority)add('t.priority=?',q.priority);
  if(q.category_id)add('t.category_id=?',q.category_id); if(q.status)add('t.status=?',q.status); if(q.technician_id)add('t.assigned_to=?',q.technician_id);
  if(q.department)add('LOWER(COALESCE(u.department,\'\'))=LOWER(?)',q.department);
  return {where:clauses.length?`WHERE ${clauses.join(' AND ')}`:'',params};
}
async function reportRows(req){const {where,params}=buildReportQuery(req);return (await db.query(`SELECT t.ticket_number,t.title,t.priority,t.status,
  COALESCE(c.category_name,'Uncategorized') category,COALESCE(b.branch_name,'Unassigned') branch,
  COALESCE(tech.full_name,'Unassigned') technician,COALESCE(u.department,'') department,t.created_at,t.resolved_at
  FROM tickets t LEFT JOIN ticket_categories c ON c.category_id=t.category_id LEFT JOIN branches b ON b.branch_id=t.branch_id
  LEFT JOIN users tech ON tech.user_id=t.assigned_to LEFT JOIN users u ON u.user_id=t.requester_id ${where} ORDER BY t.created_at DESC LIMIT 5000`,params)).rows;}

router.get('/report-options',requireAnalytics,requireManagerAnalytics,async(req,res)=>{try{
  const {role,branchId}=req.analyticsContext;
  const branchWhere=role==='superadmin'?'1=1':'b.branch_id=$1';
  const userWhere=role==='superadmin'?'1=1':'u.branch_id=$1';
  const ticketWhere=role==='superadmin'?'1=1':'t.branch_id=$1';
  const params=role==='superadmin'?[]:[branchId];
  const [branches,categories,technicians,departments,statuses]=await Promise.all([
    db.query(`SELECT b.branch_id,b.branch_name FROM branches b WHERE ${branchWhere} AND COALESCE(b.is_active,true)=true ORDER BY b.branch_name`,params),
    db.query(`SELECT category_id,category_name FROM ticket_categories ORDER BY category_name`),
    db.query(`SELECT u.user_id,u.full_name FROM users u JOIN system_roles r ON r.role_id=u.role_id WHERE ${userWhere} AND LOWER(r.role_name)='technician' AND COALESCE(u.is_active,true)=true ORDER BY u.full_name`,params),
    db.query(`SELECT DISTINCT u.department FROM users u WHERE ${userWhere} AND NULLIF(TRIM(u.department),'') IS NOT NULL ORDER BY u.department`,params),
    db.query(`SELECT DISTINCT t.status FROM tickets t WHERE ${ticketWhere} AND NULLIF(TRIM(t.status),'') IS NOT NULL ORDER BY t.status`,params),
  ]);
  res.json({success:true,message:'Report filters loaded.',data:{branches:branches.rows,categories:categories.rows,technicians:technicians.rows,departments:departments.rows.map(r=>r.department),statuses:statuses.rows.map(r=>r.status),priorities:['P1-Critical','P2-High','P3-Medium','P4-Low']}});
}catch(error){console.error('Report options error:',error.message);res.status(500).json({success:false,message:'Failed to load report filters.',data:null});}});

router.get('/custom-report',requireAnalytics,requireManagerAnalytics,async(req,res)=>{try{const rows=await reportRows(req);res.json({success:true,message:'Custom report generated.',data:rows});}catch(error){console.error('Custom report error:',error.message);res.status(500).json({success:false,message:'Failed to generate report.',data:null});}});
router.get('/custom-report/export',requireAnalytics,requireManagerAnalytics,async(req,res)=>{try{const rows=await reportRows(req);const format=String(req.query.format||'csv').toLowerCase();const columns=['ticket_number','title','priority','status','category','branch','technician','department','created_at','resolved_at'];
  if(format==='csv'){const escape=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv=[columns.join(','),...rows.map(row=>columns.map(c=>escape(row[c])).join(','))].join('\n');res.type('text/csv').set('Content-Disposition','attachment; filename="astreablue-report.csv"').send(csv);return;}
  if(format==='xlsx'){const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('AstreaBlue Report');sheet.columns=columns.map(c=>({header:c.replace(/_/g,' ').toUpperCase(),key:c,width:22}));sheet.addRows(rows);const buffer=await workbook.xlsx.writeBuffer();res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition','attachment; filename="astreablue-report.xlsx"').send(Buffer.from(buffer));return;}
  if(format==='pdf'){res.type('application/pdf').set('Content-Disposition','attachment; filename="astreablue-report.pdf"');const doc=new PDFDocument({margin:36,size:'A4',layout:'landscape'});doc.pipe(res);doc.fontSize(16).text('AstreaBlue Custom Report');doc.moveDown();rows.slice(0,250).forEach(row=>doc.fontSize(8).text(`${row.ticket_number} | ${row.priority} | ${row.status} | ${row.title}`));doc.end();return;}
  return res.status(400).json({success:false,message:'format must be csv, xlsx, or pdf.',data:null});
}catch(error){console.error('Custom report export error:',error.message);if(!res.headersSent)res.status(500).json({success:false,message:'Failed to export report.',data:null});}});

module.exports=router;
