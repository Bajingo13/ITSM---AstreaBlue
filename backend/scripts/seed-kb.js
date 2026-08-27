#!/usr/bin/env node
"use strict";

/**
 * Seeds the starter Knowledge Base pack (scripts/kb-seed-articles.js) into a deployment.
 *
 *   node scripts/seed-kb.js <backend_url> [--branch <id> | --all-branches] [--dry-run]
 *
 * Default target is the headquarters branch (is_headquarters), else the lowest active branch id.
 * Idempotent: an article whose title already exists in a branch is skipped.
 * Requires the SuperAdmin login (superadmin@astreablue.com).
 */

const { ARTICLES, PREFIX } = require("./kb-seed-articles");

const BASE = process.argv[2];
const EMAIL = process.env.SEED_EMAIL || "superadmin@astreablue.com";
const PASS = process.env.SEED_PASSWORD || "superadmin123";
const args = process.argv.slice(3);
const dryRun = args.includes("--dry-run");
const allBranches = args.includes("--all-branches");
const branchArgIndex = args.indexOf("--branch");
const branchArg = branchArgIndex >= 0 ? Number(args[branchArgIndex + 1]) : null;

if (!BASE) {
  console.error("Usage: node scripts/seed-kb.js <backend_url> [--branch <id> | --all-branches] [--dry-run]");
  process.exit(2);
}

let TOKEN = "";
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function main() {
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASS });
  TOKEN = login.json?.token || "";
  if (!TOKEN) {
    console.error(`Login failed (${login.status}). Set SEED_EMAIL / SEED_PASSWORD if the SuperAdmin differs.`);
    process.exit(1);
  }
  console.log(`Logged in to ${BASE} as ${login.json.user?.email}`);

  const branchesRes = await api("GET", "/api/v1/branches");
  const branches = (branchesRes.json?.data || branchesRes.json || []).filter((b) => b.is_active !== false);
  if (!branches.length) {
    console.error("No active branches on this deployment. Create the branches first, then re-run.");
    process.exit(1);
  }

  let targetBranches;
  if (allBranches) {
    targetBranches = branches;
  } else if (branchArg) {
    targetBranches = branches.filter((b) => Number(b.branch_id) === branchArg);
    if (!targetBranches.length) { console.error(`Branch ${branchArg} is not an active branch.`); process.exit(1); }
  } else {
    const hq = branches.find((b) => b.is_headquarters) || [...branches].sort((a, b) => a.branch_id - b.branch_id)[0];
    targetBranches = [hq];
  }

  console.log(`Target branch(es): ${targetBranches.map((b) => `${b.branch_id} ${b.branch_name}`).join(", ")}`);
  console.log(`Articles in pack: ${ARTICLES.length}${dryRun ? "  (DRY RUN - nothing will be written)" : ""}\n`);

  const existingRes = await api("GET", "/api/v1/knowledge-base");
  const existing = new Set(
    (existingRes.json?.data || existingRes.json || []).map((a) => `${a.branch_id}::${String(a.title).trim().toLowerCase()}`)
  );

  let created = 0, skipped = 0, failed = 0;
  for (const branch of targetBranches) {
    for (const article of ARTICLES) {
      const key = `${branch.branch_id}::${article.title.trim().toLowerCase()}`;
      if (existing.has(key)) { skipped += 1; continue; }
      if (dryRun) { console.log(`  would create [${branch.branch_id}] ${article.title}`); created += 1; continue; }
      const r = await api("POST", "/api/v1/knowledge-base", {
        title: article.title,
        category: article.category,
        tags: article.tags,
        symptoms: article.symptoms,
        resolution: article.resolution,
        branch_id: branch.branch_id,
      });
      if (r.status === 201) { created += 1; }
      else { failed += 1; console.warn(`  FAIL [${branch.branch_id}] ${article.title}: ${r.status} ${r.json?.error || r.json?.message || ""}`); }
    }
  }

  console.log(`\nDone. created ${created}, skipped (already present) ${skipped}, failed ${failed}.`);
  console.log(`All seeded titles start with "${PREFIX}". To remove: delete those articles in the Knowledge Base module,`);
  console.log(`or DELETE FROM knowledge_base WHERE title LIKE '${PREFIX.replace(/'/g, "''")}%';`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
