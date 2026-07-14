/**
 * AstreaBlue Windows Monitoring Agent
 *
 * Collects foreground application, window title, and idle-time samples.
 * Does NOT collect: keystrokes, passwords, microphone audio, camera data.
 * Screenshots require explicit server-side consent per device.
 *
 * Log files are written to:
 *   C:\ProgramData\AstreaBlue\MonitoringAgent\logs\agent-YYYY-MM-DD.log
 *
 * Run via invisible.vbs + HKLM Run registry entry.
 * Run manually:    node agent.js        (dev / troubleshooting)
 */

'use strict';

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto  = require('crypto');
const si      = require('systeminformation');

const execFileAsync = promisify(execFile);

// ─── Config ───────────────────────────────────────────────────────────────────
const localConfigPath = path.join(__dirname, 'agent-config.local.json');
const templateConfigPath = path.join(__dirname, 'agent-config.json');
const configPath = fs.existsSync(localConfigPath) ? localConfigPath : templateConfigPath;
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error('[AstreaBlue Agent] Failed to read agent-config.json:', err.message);
  process.exit(1);
}

const backendUrl       = String(config.backendUrl  || '').replace(/\/$/, '');
const enrollmentCode   = String(config.enrollmentCode || '').trim();
let deviceCredential   = String(config.deviceCredential || '').trim();
const legacyAgentToken = String(config.agentToken || '').trim();
const deviceName       = String(config.deviceName  || '').trim() || os.hostname();
const heartbeatMs      = Math.max(30, Number(config.heartbeatIntervalSeconds) || 60) * 1000;
const activityMs       = Math.max(30, Number(config.activityIntervalSeconds)  || 60) * 1000;
const screenshotMs     = Math.max(activityMs, 5 * 60 * 1000);
const screenshotEnabled = Boolean(config.screenshotEnabled);
const heartbeatEndpoint = `${backendUrl}/api/v1/laptop-monitoring/heartbeat`;
const activityEndpoint = `${backendUrl}/api/v1/laptop-monitoring/activity`;
const softwareInventoryEndpoint = `${backendUrl}/api/v1/laptop-monitoring/software-inventory`;

const validLegacyToken = legacyAgentToken && !legacyAgentToken.startsWith('replace-') && legacyAgentToken !== 'dev-monitoring-token';
if (!backendUrl || (!deviceCredential && !enrollmentCode && !validLegacyToken)) {
  console.error('[AstreaBlue Agent] ERROR: Set backendUrl and either enrollmentCode, deviceCredential, or a migration agentToken before starting.');
  process.exit(1);
}

// ─── File Logger ──────────────────────────────────────────────────────────────
const LOG_DIR = 'C:\\ProgramData\\AstreaBlue\\MonitoringAgent\\logs';

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (_) {
    // If log dir creation fails, fall through to console-only logging
  }
}

function logFilePath() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `agent-${today}.log`);
}

function writeLog(level, message) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}\n`;
  // Always write to console (captured by node-windows into service logs)
  process.stdout.write(line);
  // Also write to daily rotating file
  try {
    fs.appendFileSync(logFilePath(), line, 'utf8');
  } catch (_) {
    // Best-effort — do not crash the agent if log write fails
  }
}

const log  = (msg) => writeLog('INFO', msg);
const warn = (msg) => writeLog('WARN', msg);
const err  = (msg) => writeLog('ERROR', msg);

ensureLogDir();

const DEVICE_DIR = process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'AstreaBlue')
  : path.join(os.homedir(), '.astreablue');
const DEVICE_FILE = path.join(DEVICE_DIR, 'device.json');

function loadOrCreateDeviceIdentity() {
  try {
    const existing = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
    if (typeof existing.device_uuid === 'string' && /^[0-9a-f-]{36}$/i.test(existing.device_uuid)) return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') warn(`Device identity read failed; creating a new identity only if safe: ${error.message}`);
  }
  fs.mkdirSync(DEVICE_DIR, { recursive: true });
  const identity = {
    device_uuid: crypto.randomUUID(),
    hostname: os.hostname(),
    device_name: deviceName,
    agent_version: 'astreablue-run-1.4',
    created_at: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(DEVICE_FILE, `${JSON.stringify(identity, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return identity;
  } catch (error) {
    if (error.code === 'EEXIST') return JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
    throw error;
  }
}

let deviceIdentity;
try {
  deviceIdentity = loadOrCreateDeviceIdentity();
} catch (identityError) {
  err(`Cannot load permanent device identity at ${DEVICE_FILE}: ${identityError.message}`);
  process.exit(1);
}
const deviceUuid = deviceIdentity.device_uuid;

function activeAgentToken() {
  return deviceCredential || (validLegacyToken ? legacyAgentToken : '');
}

function saveEnrolledCredential(credential) {
  const privateConfig = {
    ...config,
    backendUrl,
    enrollmentCode: '',
    deviceCredential: credential,
    agentToken: '',
  };
  fs.writeFileSync(localConfigPath, `${JSON.stringify(privateConfig, null, 2)}\n`, 'utf8');
  config = privateConfig;
  deviceCredential = credential;
}

async function ensureAgentCredential() {
  if (deviceCredential || validLegacyToken) return true;
  try {
    const response = await fetch(`${backendUrl}/api/v1/laptop-monitoring/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enrollment_code: enrollmentCode,
        device_uuid: deviceUuid,
        hostname: os.hostname(),
        device_name: deviceName,
        agent_version: 'astreablue-run-1.4',
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.data?.device_credential) throw new Error(result.message || `HTTP ${response.status}`);
    saveEnrolledCredential(result.data.device_credential);
    log(`Device enrollment SUCCESS | deviceId=${result.data.device_id ?? 'unknown'}`);
    return true;
  } catch (error) {
    err(`Device enrollment FAILURE | error=${error.message}`);
    return false;
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function post(pathname, body, multipart = false) {
  const response = await fetch(`${backendUrl}/api/v1/laptop-monitoring${pathname}`, {
    method:  'POST',
    headers: {
      'x-agent-token': activeAgentToken(),
      ...(multipart ? {} : { 'Content-Type': 'application/json' }),
    },
    body: multipart ? body : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
  if (result.warning) warn(result.warning);
  return result;
}

async function get(pathname) {
  const response = await fetch(`${backendUrl}/api/v1/laptop-monitoring${pathname}`, {
    headers: { 'x-agent-token': activeAgentToken() },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
  return result;
}

// ─── Policy Management ────────────────────────────────────────────────────────
const POLICY_FILE = path.join(DEVICE_DIR, 'policy.json');
let cachedPolicy = {
  heartbeat_enabled: true,
  telemetry_enabled: true,
  hardware_inventory_enabled: true,
  software_inventory_enabled: true,
  policy_sync_enabled: true,
  activity_monitoring_enabled: false,
  screenshot_monitoring_enabled: false,
  browser_monitoring_enabled: false,
  usb_monitoring_enabled: false,
  location_tracking_enabled: false,
  auto_incident_enabled: false,
};

function loadCachedPolicy() {
  try {
    if (fs.existsSync(POLICY_FILE)) {
      const existing = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'));
      cachedPolicy = { ...cachedPolicy, ...existing };
    }
  } catch (error) {
    warn(`Failed to load cached policy: ${error.message}`);
  }
}

function saveCachedPolicy(policy) {
  try {
    fs.writeFileSync(POLICY_FILE, JSON.stringify(policy, null, 2), 'utf8');
  } catch (error) {
    warn(`Failed to save cached policy: ${error.message}`);
  }
}

async function fetchPolicy() {
  try {
    const result = await get(`/policy/latest?device_uuid=${encodeURIComponent(deviceUuid)}`);
    if (result.success && result.data) {
      cachedPolicy = { ...cachedPolicy, ...result.data };
      saveCachedPolicy(cachedPolicy);
      log(`Policy sync SUCCESS | version=${cachedPolicy.policy_version || 'unknown'}`);
    }
  } catch (error) {
    warn(`Policy sync FAILURE | Using cached policy. error=${error.message}`);
  }
}

loadCachedPolicy();

// ─── Heartbeat ────────────────────────────────────────────────────────────────
async function heartbeat() {
  try {
    const result = await post('/heartbeat', {
      device_uuid: deviceUuid,
      hostname: os.hostname(),
      device_name: deviceName,
      agent_version: 'astreablue-run-1.4',
      logged_in_user: os.userInfo().username,
      timestamp: new Date().toISOString(),
    });
    log(`Heartbeat SUCCESS | endpoint=${heartbeatEndpoint} | deviceName=${deviceName} | deviceId=${result.data?.device_id ?? 'unknown'}`);
    return true;
  } catch (e) {
    err(`Heartbeat FAILURE | endpoint=${heartbeatEndpoint} | deviceName=${deviceName} | error=${e.message}`);
    return false;
  }
}

// ─── Activity Sampling (PowerShell — Windows only) ───────────────────────────
// Reads the foreground window title + process name + idle time via Win32 APIs.
// No keystrokes are read. Window titles are sent as-is; avoid enabling on
// devices where titles may contain sensitive data (consult your privacy policy).
const ACTIVITY_SCRIPT = `
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
$title  = New-Object System.Text.StringBuilder 512
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
  if (process.platform !== 'win32') {
    return { app_name: 'Unsupported OS', window_title: 'Windows agent requires Windows', idle_seconds: 0 };
  }
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ACTIVITY_SCRIPT],
    { windowsHide: true, timeout: 15000 }
  );
  return JSON.parse(stdout.trim());
}

async function sendActivity() {
  if (!cachedPolicy.activity_monitoring_enabled) {
    warn('Activity skipped — effective policy does not enable activity monitoring.');
    return;
  }
  try {
    const activity = await readActivity();
    await post('/activity', {
      device_uuid: deviceUuid,
      hostname:    deviceName,
      event_type:  'active_window_sample',
      ...activity,
      url_domain:  null,
      occurred_at: new Date().toISOString(),
    });
    log(`Activity SUCCESS | endpoint=${activityEndpoint} | deviceName=${deviceName} | app=${activity.app_name || 'Unknown'} | idle=${activity.idle_seconds}s`);
  } catch (e) {
    err(`Activity FAILURE | endpoint=${activityEndpoint} | deviceName=${deviceName} | error=${e.message}`);
  }
}

// ─── Screenshot (disabled by default, requires server-side consent) ───────────
async function captureScreenshot() {
  if (!screenshotEnabled || process.platform !== 'win32' || !cachedPolicy.screenshot_monitoring_enabled) return;
  try {
    const permission = await get(`/screenshot-permission?device_uuid=${encodeURIComponent(deviceUuid)}`);
    if (!permission.data?.allowed) {
      warn('Screenshot skipped — explicit server-side consent not approved for this device.');
      return;
    }
    const outputPath = path.join(os.tmpdir(), `astreablue-${Date.now()}.jpg`);
    const captureScript = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${outputPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Jpeg); $g.Dispose(); $i.Dispose()`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', captureScript], { windowsHide: true, timeout: 30000 });
    const form = new FormData();
    form.append('hostname',    deviceName);
    form.append('device_uuid', deviceUuid);
    form.append('reason',      'Consent-enabled scheduled agent capture');
    form.append('captured_at', new Date().toISOString());
    form.append('screenshot',  new Blob([fs.readFileSync(outputPath)], { type: 'image/jpeg' }), path.basename(outputPath));
    await post('/screenshot', form, true);
    log('Screenshot submitted (consent-gated).');
  } catch (e) {
    err(`Screenshot FAILED: ${e.message}`);
  } finally {
    // Clean up temp file regardless of upload result
    try { fs.rmSync(path.join(os.tmpdir(), `astreablue-*.jpg`), { force: true }); } catch (_) {}
  }
}

// ============================================================================
async function sendHardwareInventory() {
  try {
    const [system, osInfo, cpu, mem, disk, net] = await Promise.all([
      si.system(),
      si.osInfo(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkInterfaces()
    ]);

    const primaryDisk = disk[0] || {};
    const defaultNet = (Array.isArray(net) ? net : [net]).find(n => !n.internal && n.mac) || net[0] || {};

    const payload = {
      device_uuid: deviceUuid,
      manufacturer: system.manufacturer,
      model: system.model,
      serial_number: system.serial,
      cpu_name: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      total_ram_gb: (mem.total / (1024 ** 3)).toFixed(2),
      os_name: osInfo.distro,
      os_version: osInfo.release,
      os_build: osInfo.build,
      architecture: osInfo.arch,
      disk_total_gb: primaryDisk.size ? (primaryDisk.size / (1024 ** 3)).toFixed(2) : null,
      disk_free_gb: primaryDisk.available ? (primaryDisk.available / (1024 ** 3)).toFixed(2) : null,
      mac_address: defaultNet.mac,
      ip_address: defaultNet.ip4
    };

    await post('/hardware-inventory', payload);
    log(`Hardware Inventory SUCCESS | Sent hardware specifications to AstreaBlue.`);
  } catch (e) {
    err(`Hardware Inventory FAILURE | error=${e.message}`);
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
const SOFTWARE_INVENTORY_SCRIPT = `
$paths = @(
  @{ Path='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; Source='registry:hklm' },
  @{ Path='HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; Source='registry:hklm-wow6432' },
  @{ Path='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; Source='registry:hkcu' }
)
$items = New-Object System.Collections.Generic.List[object]
foreach ($entry in $paths) {
  try {
    Get-ItemProperty -Path $entry.Path -ErrorAction Stop | ForEach-Object {
      $name = [string]$_.DisplayName
      if (-not [string]::IsNullOrWhiteSpace($name)) {
        $items.Add([pscustomobject]@{
          software_name = $name.Trim()
          version = if ($_.DisplayVersion) { [string]$_.DisplayVersion } else { $null }
          publisher = if ($_.Publisher) { [string]$_.Publisher } else { $null }
          install_date = if ($_.InstallDate) { [string]$_.InstallDate } else { $null }
          install_location = if ($_.InstallLocation) { [string]$_.InstallLocation } else { $null }
          source = $entry.Source
        })
      }
    }
  } catch {}
}
$items | Sort-Object software_name, publisher -Unique | ConvertTo-Json -Compress -Depth 3
`;

async function readSoftwareInventory() {
  if (process.platform !== 'win32') return [];
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', SOFTWARE_INVENTORY_SCRIPT],
    { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function sendSoftwareInventory() {
  const scanStartedAt = new Date().toISOString();
  try {
    const software = await readSoftwareInventory();
    await post('/software-inventory', {
      device_uuid: deviceUuid,
      hostname: os.hostname(),
      scan_started_at: scanStartedAt,
      scan_completed_at: new Date().toISOString(),
      software,
    });
    log(`Software Inventory SUCCESS | endpoint=${softwareInventoryEndpoint} | records=${software.length}`);
  } catch (e) {
    err(`Software Inventory FAILURE | endpoint=${softwareInventoryEndpoint} | error=${e.message}`);
  }
}

log('='.repeat(60));
log(`AstreaBlue Monitoring Agent starting — v1.1`);
log(`Device:   ${deviceName}`);
log(`Device UUID: ${deviceUuid}`);
log(`Hostname: ${os.hostname()}`);
log(`Backend:  ${backendUrl}`);
log(`Heartbeat endpoint: ${heartbeatEndpoint}`);
log(`Activity endpoint:  ${activityEndpoint}`);
log(`Software inventory endpoint: ${softwareInventoryEndpoint}`);
log(`Heartbeat every ${heartbeatMs / 1000}s | Activity every ${activityMs / 1000}s`);
log('Privacy:  No keystrokes, passwords, microphone, or camera data collected.');
if (screenshotEnabled) warn('Screenshot capture ENABLED — requires explicit server-side consent per device.');
log('='.repeat(60));

// Enroll first when a one-time code is present, then start the normal loops.
let monitoringLoopsStarted = false;
async function startMonitoringLoops() {
  if (monitoringLoopsStarted) return;
  if (!(await ensureAgentCredential())) {
    setTimeout(startMonitoringLoops, 60 * 1000);
    return;
  }
  monitoringLoopsStarted = true;
  const registered = await heartbeat();
  if (registered) {
    await fetchPolicy();
    sendActivity();
    sendHardwareInventory();
    sendSoftwareInventory();
  }
  setInterval(heartbeat, heartbeatMs);
  setInterval(fetchPolicy, 60 * 1000);
  setInterval(sendActivity, activityMs);
  setInterval(sendHardwareInventory, 24 * 60 * 60 * 1000);
  setInterval(sendSoftwareInventory, 24 * 60 * 60 * 1000);
  if (screenshotEnabled) {
    captureScreenshot();
    setInterval(captureScreenshot, screenshotMs);
  }
}

startMonitoringLoops();
