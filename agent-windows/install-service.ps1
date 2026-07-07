#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$AgentDir = $PSScriptRoot
$LogDir = 'C:\ProgramData\AstreaBlue\MonitoringAgent\logs'
$ServiceName = 'AstreaBlue Monitoring Agent'
$ConfigFile = Join-Path $AgentDir 'agent-config.json'

Write-Host '[1/5] Checking Node.js...' -ForegroundColor Yellow
$nodeVersion = & node --version 2>&1
if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) { throw 'Node.js was not found. Install Node.js 18 or newer.' }
$major = [int]($nodeVersion -replace '^v(\d+)\..*$', '$1')
if ($major -lt 18) { throw "Node.js 18 or newer is required. Found $nodeVersion." }

Write-Host '[2/5] Verifying agent-config.json...' -ForegroundColor Yellow
if (-not (Test-Path -LiteralPath $ConfigFile)) { throw "Config not found: $ConfigFile" }
$cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
if (-not $cfg.backendUrl) { throw 'backendUrl is required in agent-config.json.' }
if (-not $cfg.agentToken -or $cfg.agentToken -like 'replace-*') { throw 'agentToken is required in agent-config.json.' }
Write-Host "  Backend: $($cfg.backendUrl)" -ForegroundColor Green

Write-Host '[3/5] Installing dependencies...' -ForegroundColor Yellow
Push-Location $AgentDir
try {
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
} finally {
    Pop-Location
}

Write-Host '[4/5] Creating data and log directories...' -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path 'C:\ProgramData\AstreaBlue' | Out-Null

Write-Host '[5/5] Installing Windows Service...' -ForegroundColor Yellow
& node (Join-Path $AgentDir 'svc.js') install
if ($LASTEXITCODE -ne 0) { throw 'Service installation failed.' }

$installedService = $null
for ($attempt = 0; $attempt -lt 20 -and -not $installedService; $attempt++) {
    Start-Sleep -Seconds 1
    $installedService = Get-Service -DisplayName $ServiceName -ErrorAction SilentlyContinue
}
if (-not $installedService) { throw 'Service registration did not complete in time.' }

Set-Service -Name $installedService.Name -StartupType Automatic
& sc.exe failure $installedService.Name reset= 86400 actions= restart/5000/restart/15000/restart/30000 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to configure service recovery actions.' }
if ($installedService.Status -ne 'Running') { Start-Service -Name $installedService.Name }

Write-Host "Service '$ServiceName' is installed, starts at boot, and restarts after crashes." -ForegroundColor Green
Write-Host "Logs: $LogDir" -ForegroundColor Cyan
