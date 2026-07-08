param ()

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Please run this script as Administrator." -ForegroundColor Red
    Exit
}

Write-Host "=========================================="
Write-Host "AstreaBlue Monitoring Agent Installer"
Write-Host "=========================================="

# Verify Node.js
try {
    $nodeVersion = (node -v 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Node not found" }
    Write-Host "Found Node.js version $nodeVersion"
} catch {
    Write-Host "Node.js LTS is required. Install it first from nodejs.org or use the future bundled installer." -ForegroundColor Red
    Exit
}

# Run npm install
Write-Host "Installing dependencies..."
npm install --silent
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install dependencies." -ForegroundColor Red
    Exit
}

# Config
$configFile = Join-Path $PSScriptRoot "agent-config.json"
$config = @{}
if (Test-Path $configFile) {
    try {
        $config = Get-Content $configFile | ConvertFrom-Json
    } catch {
        # Ignore
    }
}

$backendUrl = $config.backendUrl
$agentToken = $config.agentToken
$deviceName = $config.deviceName

if (-not $backendUrl) {
    $backendUrl = Read-Host "Enter Backend URL (e.g. https://backend-production-fc059.up.railway.app)"
}
if (-not $agentToken -or $agentToken -eq "replace-me-with-real-token") {
    $agentToken = Read-Host "Enter Agent Token"
}
if (-not $deviceName) {
    $deviceName = Read-Host "Enter Optional Device Name (leave blank to use hostname)"
}

$newConfig = @{
    backendUrl = $backendUrl
    agentToken = $agentToken
    deviceName = $deviceName
    heartbeatIntervalSeconds = 30
    activityIntervalSeconds = 30
    screenshotEnabled = $false
}

$newConfig | ConvertTo-Json -Depth 5 | Out-File -FilePath $configFile -Encoding utf8
Write-Host "Config saved."

# Install Windows Service
Write-Host "Installing Windows Service..."

$svcScript = @"
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'AstreaBlue Monitoring Agent',
  description: 'AstreaBlue ITSM consent-aware endpoint monitoring agent.',
  script: path.join(__dirname, 'agent.js'),
  workingDirectory: __dirname,
  logpath: 'C:\\ProgramData\\AstreaBlue\\MonitoringAgent\\logs',
  maxRestarts: 5,
  wait: 60,
  grow: 0.25,
  abortOnError: false
});

svc.on('install', function() {
  console.log('Service installed. Starting...');
  svc.start();
});
svc.on('start', function() {
  console.log('Service started successfully.');
});
svc.on('error', function(err) {
  console.error('Service error:', err);
});

svc.install();
"@

$tempScriptPath = Join-Path $PSScriptRoot "_temp_install.js"
$svcScript | Out-File -FilePath $tempScriptPath -Encoding utf8

node $tempScriptPath
Start-Sleep -Seconds 5
if (Test-Path $tempScriptPath) { Remove-Item $tempScriptPath -Force }

Write-Host "Installation Complete! Service is running." -ForegroundColor Green
