const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const configPath = path.join(__dirname, "agent-config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const backendUrl = String(config.backendUrl || "").replace(/\/$/, "");
const deviceName = String(config.deviceName || "").trim() || os.hostname();
const heartbeatInterval = Math.max(30, Number(config.heartbeatIntervalSeconds) || 60) * 1000;
const activityInterval = Math.max(30, Number(config.activityIntervalSeconds) || 60) * 1000;
const screenshotInterval = Math.max(activityInterval, 5 * 60 * 1000);

if (!backendUrl || !config.agentToken || String(config.agentToken).startsWith("replace-")) {
  throw new Error("Set backendUrl and agentToken in agent-config.json before starting the agent.");
}

async function post(pathname, body, multipart = false) {
  const response = await fetch(`${backendUrl}/api/v1/laptop-monitoring${pathname}`, {
    method: "POST",
    headers: { "x-agent-token": config.agentToken, ...(multipart ? {} : { "Content-Type": "application/json" }) },
    body: multipart ? body : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Request failed with HTTP ${response.status}`);
  if (result.warning) console.warn(`[AstreaBlue Agent] ${result.warning}`);
  return result;
}

async function get(pathname) {
  const response = await fetch(`${backendUrl}/api/v1/laptop-monitoring${pathname}`, { headers: { "x-agent-token": config.agentToken } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Request failed with HTTP ${response.status}`);
  return result;
}

async function heartbeat() {
  await post("/heartbeat", { hostname: deviceName, agent_version: "node-windows-mvp-1.0" });
  console.log(`[AstreaBlue Agent] heartbeat sent at ${new Date().toISOString()}`);
}

const activityScript = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AstreaUserActivity {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
}
'@
$handle = [AstreaUserActivity]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 512
[void][AstreaUserActivity]::GetWindowText($handle, $title, $title.Capacity)
$processId = 0
[void][AstreaUserActivity]::GetWindowThreadProcessId($handle, [ref]$processId)
$processName = try { (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { "Unknown" }
$lastInput = New-Object AstreaUserActivity+LASTINPUTINFO
$lastInput.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($lastInput)
[void][AstreaUserActivity]::GetLastInputInfo([ref]$lastInput)
$idleSeconds = [math]::Max(0, [math]::Floor(([Environment]::TickCount64 - $lastInput.dwTime) / 1000))
@{ app_name=$processName; window_title=$title.ToString(); idle_seconds=$idleSeconds } | ConvertTo-Json -Compress
`;

async function readActivity() {
  if (process.platform !== "win32") return { app_name: "Unsupported OS", window_title: "Windows agent requires Windows", idle_seconds: 0 };
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", activityScript], { windowsHide: true, timeout: 15000 });
  return JSON.parse(stdout.trim());
}

async function sendActivity() {
  const activity = await readActivity();
  await post("/activity", { hostname: deviceName, event_type: "active_window_sample", ...activity, url_domain: null, occurred_at: new Date().toISOString() });
  console.log(`[AstreaBlue Agent] activity sample sent at ${new Date().toISOString()}`);
}

async function captureScreenshot() {
  if (!config.screenshotEnabled || process.platform !== "win32") return;
  const permission = await get(`/screenshot-permission?hostname=${encodeURIComponent(deviceName)}`);
  if (!permission.data?.allowed) {
    console.warn("[AstreaBlue Agent] Screenshot skipped because explicit consent is not approved.");
    return;
  }
  const outputPath = path.join(os.tmpdir(), `astreablue-${Date.now()}.jpg`);
  const script = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${outputPath.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Jpeg); $g.Dispose(); $i.Dispose()`;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 30000 });
    const form = new FormData();
    form.append("hostname", deviceName);
    form.append("reason", "Consent-enabled scheduled agent capture");
    form.append("captured_at", new Date().toISOString());
    form.append("screenshot", new Blob([fs.readFileSync(outputPath)], { type: "image/jpeg" }), path.basename(outputPath));
    await post("/screenshot", form, true);
    console.log(`[AstreaBlue Agent] consent-gated screenshot submitted at ${new Date().toISOString()}`);
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
}

function safely(label, operation) {
  operation().catch((error) => console.error(`[AstreaBlue Agent] ${label} failed: ${error.message}`));
}

console.log("[AstreaBlue Agent] Starting visible, consent-aware monitoring agent.");
console.log("[AstreaBlue Agent] No keystrokes, passwords, microphone audio, or camera data are collected.");
if (config.screenshotEnabled) console.warn("[AstreaBlue Agent] Screenshot capture is ENABLED and requires explicit server-side consent.");
safely("heartbeat", heartbeat);
safely("activity", sendActivity);
setInterval(() => safely("heartbeat", heartbeat), heartbeatInterval);
setInterval(() => safely("activity", sendActivity), activityInterval);
if (config.screenshotEnabled) {
  safely("screenshot", captureScreenshot);
  setInterval(() => safely("screenshot", captureScreenshot), screenshotInterval);
}
