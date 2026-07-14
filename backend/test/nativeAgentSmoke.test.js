process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const routes = require("../src/routes/laptopMonitoring");

const execFileAsync = promisify(execFile);
const executable = path.resolve(__dirname, "../../agent-windows/native-agent/dist/AstreaBlue.Agent.Service.exe");
const canRun = process.platform === "win32" && fs.existsSync(executable);

test("native agent enrolls, protects its credential, and sends a bound heartbeat", { skip: !canRun }, async () => {
  let server;
  let codeId;
  let deviceId;
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "astreablue-native-agent-test-"));
  try {
    const branch = await db.query(`SELECT branch_id FROM branches ORDER BY branch_id LIMIT 1`);
    const actor = await db.query(`SELECT user_id FROM users ORDER BY user_id LIMIT 1`);
    assert.ok(branch.rows[0]?.branch_id);
    assert.ok(actor.rows[0]?.user_id);

    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api/v1/laptop-monitoring", routes);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: actor.rows[0].user_id, role: "Admin", branchId: branch.rows[0].branch_id }, process.env.JWT_SECRET || "astreablue_dev_secret_change_in_prod", { expiresIn: "5m" });
    const hostname = os.hostname();
    const codeResponse = await fetch(`${baseUrl}/api/v1/laptop-monitoring/enrollment-codes`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ intended_hostname: hostname, expires_in_minutes: 10 }),
    });
    assert.equal(codeResponse.status, 201);
    const code = (await codeResponse.json()).data;
    codeId = code.enrollment_code_id;

    const environment = { ...process.env, ASTREABLUE_AGENT_DATA_DIR: dataDirectory };
    const enrollment = await execFileAsync(executable, ["--enroll", "--backend", baseUrl, "--code", code.enrollment_code, "--name", "Native Agent Smoke Test"], { env: environment, windowsHide: true });
    assert.match(enrollment.stdout, /Enrollment successful/i);
    assert.ok(fs.existsSync(path.join(dataDirectory, "credential.bin")));
    assert.doesNotMatch(fs.readFileSync(path.join(dataDirectory, "credential.bin")).toString("utf8"), /ABDEV-/);

    await execFileAsync(executable, ["--heartbeat-once"], { env: environment, windowsHide: true });
    await execFileAsync(executable, ["--policy-once"], { env: environment, windowsHide: true });
    await execFileAsync(executable, ["--hardware-once"], { env: environment, windowsHide: true });
    await execFileAsync(executable, ["--software-once"], { env: environment, windowsHide: true, timeout: 120000 });
    await execFileAsync(executable, ["--update-once"], { env: environment, windowsHide: true });
    await assert.rejects(
      execFileAsync(executable, ["--configure-updates", "--manifest", `${baseUrl}/unsigned-manifest`, "--thumbprint", "TEST", "--channel", "pilot"], { env: environment, windowsHide: true }),
      /HTTPS/i
    );
    const identity = JSON.parse(fs.readFileSync(path.join(dataDirectory, "device.json"), "utf8").replace(/^\uFEFF/, ""));
    assert.match(identity.device_uuid, /^[0-9a-f-]{36}$/i);
    const device = await db.query(`SELECT device_id,status,enrollment_status,credential_last_seen_at FROM monitored_devices WHERE device_uuid=$1::uuid`, [identity.device_uuid]);
    assert.equal(device.rows[0]?.status, "Online");
    assert.equal(device.rows[0]?.enrollment_status, "Enrolled");
    assert.ok(device.rows[0]?.credential_last_seen_at);
    deviceId = device.rows[0].device_id;
    const policy = JSON.parse(fs.readFileSync(path.join(dataDirectory, "policy.json"), "utf8").replace(/^\uFEFF/, ""));
    assert.equal(policy.activity_monitoring_enabled, false);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM endpoint_hardware_inventory WHERE device_id=$1`, [deviceId])).rows[0].count > 0, true);
    assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM endpoint_software_scan_runs WHERE device_id=$1`, [deviceId])).rows[0].count > 0, true);
  } finally {
    if (!deviceId && fs.existsSync(path.join(dataDirectory, "device.json"))) {
      try {
        const identity = JSON.parse(fs.readFileSync(path.join(dataDirectory, "device.json"), "utf8").replace(/^\uFEFF/, ""));
        deviceId = (await db.query(`SELECT device_id FROM monitored_devices WHERE device_uuid=$1::uuid`, [identity.device_uuid])).rows[0]?.device_id;
      } catch {}
    }
    if (deviceId || codeId) await db.query(`DELETE FROM endpoint_enrollment_audit_logs WHERE device_id=$1 OR enrollment_code_id=$2`, [deviceId || null, codeId || null]);
    if (codeId) await db.query(`DELETE FROM endpoint_enrollment_codes WHERE enrollment_code_id=$1`, [codeId]);
    if (deviceId) await db.query(`DELETE FROM monitored_devices WHERE device_id=$1`, [deviceId]);
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
    await db.rawPool.end();
  }
});
