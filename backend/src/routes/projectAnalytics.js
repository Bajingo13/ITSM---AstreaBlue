const express = require("express");
const db = require("../../config/db");
const { getRequestContext } = require("./_ticketAccess");

const router = express.Router();
const cache = new Map();
const CACHE_TTL_MS = 30_000;

function requireAnalyticsAccess(req, res, next) {
  const context = getRequestContext(req);
  if (!context.authenticated) {
    return res.status(401).json({ success: false, message: "Authentication required.", data: null });
  }
  const role = String(context.roleName || "").toLowerCase();
  if (!['superadmin', 'admin'].includes(role)) {
    return res.status(403).json({ success: false, message: "Project analytics access denied.", data: null });
  }
  req.analyticsContext = { ...context, role };
  return next();
}

function numeric(value) {
  return Number(value || 0);
}

router.get("/dashboard", requireAnalyticsAccess, async (req, res) => {
  const { role, branchId } = req.analyticsContext;
  const cacheKey = `${role}:${branchId || "all"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return res.json({ success: true, message: "Project analytics loaded.", data: cached.data, meta: { cached: true } });
  }

  try {
    const projectParams = [];
    const projectScope = role === "superadmin"
      ? "p.is_active = true"
      : (projectParams.push(branchId), `p.is_active = true AND p.branch_id = $${projectParams.length}`);
    if (role !== "superadmin" && !branchId) {
      return res.status(403).json({ success: false, message: "An assigned branch is required.", data: null });
    }

    const ticketParams = [];
    const ticketScope = role === "superadmin"
      ? "1=1"
      : (ticketParams.push(branchId), `t.branch_id = $${ticketParams.length}`);

    const [projects, milestones, risks, resources, costs, recurring, knownErrors, rootCategories, problemTrends] = await Promise.all([
      db.query(`SELECT p.project_id,p.project_code,p.project_name,p.status,p.start_date,p.planned_finish_date,
        p.projected_finish_date,p.planned_completion_pct,p.actual_completion_pct,p.health_score,p.forecast_confidence,
        p.budget,p.planned_value,p.earned_value,p.actual_cost
        FROM it_projects p WHERE ${projectScope} ORDER BY p.updated_at DESC`, projectParams),
      db.query(`SELECT m.milestone_id,m.project_id,m.milestone_name,m.due_date,m.completed_at,m.status
        FROM it_project_milestones m JOIN it_projects p ON p.project_id=m.project_id
        WHERE ${projectScope} ORDER BY m.due_date NULLS LAST`, projectParams),
      db.query(`SELECT r.risk_id,r.project_id,r.title,r.severity,r.status
        FROM it_project_risks r JOIN it_projects p ON p.project_id=r.project_id
        WHERE ${projectScope} AND LOWER(r.status) <> 'resolved'`, projectParams),
      db.query(`SELECT COALESCE(SUM(r.allocation_pct),0) allocated,
        COALESCE(SUM(GREATEST(r.capacity_pct-r.allocation_pct,0)),0) available,
        COUNT(*)::int resource_count
        FROM it_project_resources r JOIN it_projects p ON p.project_id=r.project_id WHERE ${projectScope}`, projectParams),
      db.query(`SELECT c.snapshot_date,
        SUM(c.planned_value) planned_value,SUM(c.earned_value) earned_value,SUM(c.actual_cost) actual_cost
        FROM it_project_cost_snapshots c JOIN it_projects p ON p.project_id=c.project_id
        WHERE ${projectScope} GROUP BY c.snapshot_date ORDER BY c.snapshot_date`, projectParams),
      db.query(`SELECT t.title,COUNT(*)::int occurrences FROM tickets t WHERE ${ticketScope}
        GROUP BY LOWER(t.title),t.title HAVING COUNT(*) > 1 ORDER BY occurrences DESC LIMIT 5`, ticketParams),
      db.query(`SELECT COUNT(*)::int count FROM tickets t WHERE ${ticketScope}
        AND NULLIF(TRIM(t.root_cause),'') IS NOT NULL`, ticketParams),
      db.query(`SELECT COALESCE(c.category_name,'Uncategorized') category,COUNT(*)::int count
        FROM tickets t LEFT JOIN ticket_categories c ON c.category_id=t.category_id
        WHERE ${ticketScope} AND NULLIF(TRIM(t.root_cause),'') IS NOT NULL
        GROUP BY c.category_name ORDER BY count DESC LIMIT 6`, ticketParams),
      db.query(`SELECT TO_CHAR(DATE_TRUNC('month',t.created_at),'YYYY-MM') period,COUNT(*)::int count
        FROM tickets t WHERE ${ticketScope} AND t.created_at >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month',t.created_at) ORDER BY DATE_TRUNC('month',t.created_at)`, ticketParams),
    ]);

    const projectRows = projects.rows.map((project) => ({
      ...project,
      planned_completion_pct: numeric(project.planned_completion_pct),
      actual_completion_pct: numeric(project.actual_completion_pct),
      health_score: numeric(project.health_score),
      forecast_confidence: numeric(project.forecast_confidence),
      budget: numeric(project.budget), planned_value: numeric(project.planned_value),
      earned_value: numeric(project.earned_value), actual_cost: numeric(project.actual_cost),
    }));
    const total = projectRows.length;
    const countStatus = (status) => projectRows.filter((project) => project.status.toLowerCase() === status).length;
    const completedMilestones = milestones.rows.filter((milestone) => milestone.completed_at || milestone.status.toLowerCase() === 'completed').length;
    const milestoneTotal = milestones.rows.length;
    const allocated = numeric(resources.rows[0]?.allocated);
    const available = numeric(resources.rows[0]?.available);

    const data = {
      portfolio: {
        total_projects: total,
        on_track_pct: total ? Math.round((countStatus('on track') / total) * 100) : 0,
        at_risk_pct: total ? Math.round((countStatus('at risk') / total) * 100) : 0,
        delayed_pct: total ? Math.round((countStatus('delayed') / total) * 100) : 0,
        health_score: total ? Number((projectRows.reduce((sum, p) => sum + p.health_score, 0) / total).toFixed(1)) : 0,
      },
      schedule: projectRows,
      milestones: {
        completion_pct: milestoneTotal ? Math.round((completedMilestones / milestoneTotal) * 100) : 0,
        completed: completedMilestones,
        remaining: milestoneTotal - completedMilestones,
        upcoming: milestones.rows.filter((m) => !m.completed_at && m.due_date && new Date(m.due_date) >= new Date()).length,
        items: milestones.rows,
      },
      risks: {
        open_issues: risks.rows.length,
        high_risk_issues: risks.rows.filter((risk) => ['high','critical'].includes(risk.severity.toLowerCase())).length,
        items: risks.rows,
      },
      costs: {
        planned_value: projectRows.reduce((sum,p) => sum+p.planned_value,0),
        earned_value: projectRows.reduce((sum,p) => sum+p.earned_value,0),
        actual_cost: projectRows.reduce((sum,p) => sum+p.actual_cost,0),
        trend: costs.rows.map((row) => ({ date: row.snapshot_date, planned_value: numeric(row.planned_value), earned_value: numeric(row.earned_value), actual_cost: numeric(row.actual_cost) })),
      },
      resources: {
        utilization_pct: allocated + available ? Math.round((allocated/(allocated+available))*100) : 0,
        allocated, available, resource_count: resources.rows[0]?.resource_count || 0,
      },
      forecast: projectRows.map((project) => ({ project_id: project.project_id, project_name: project.project_name,
        current_progress: project.actual_completion_pct, estimated_completion: project.planned_completion_pct,
        projected_finish_date: project.projected_finish_date || project.planned_finish_date,
        confidence: project.forecast_confidence })),
      problems: {
        recurring_problems: recurring.rows,
        known_errors: knownErrors.rows[0]?.count || 0,
        root_cause_categories: rootCategories.rows,
        trends: problemTrends.rows,
      },
      generated_at: new Date().toISOString(),
    };
    cache.set(cacheKey, { createdAt: Date.now(), data });
    return res.json({ success: true, message: "Project analytics loaded.", data, meta: { cached: false } });
  } catch (error) {
    console.error("Project analytics dashboard error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load project analytics.", data: null });
  }
});

module.exports = router;
