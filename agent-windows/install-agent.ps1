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

# Store machine credentials outside the tracked configuration template.
$configFile = Join-Path $PSScriptRoot "agent-config.local.json"
$templateConfigFile = Join-Path $PSScriptRoot "agent-config.json"
$config = @{}
if (Test-Path $configFile) {
    try {
        $config = Get-Content $configFile | ConvertFrom-Json
    } catch {
        # Ignore
    }
} elseif (Test-Path $templateConfigFile) {
    try {
        $config = Get-Content $templateConfigFile | ConvertFrom-Json
    } catch {
        # Ignore
    }
}

$backendUrl = $config.backendUrl
$agentToken = $config.agentToken
$enrollmentCode = $config.enrollmentCode
$deviceCredential = $config.deviceCredential
$deviceName = $config.deviceName

if (-not $backendUrl) {
    $backendUrl = Read-Host "Enter Backend URL (e.g. https://backend-production-fc059.up.railway.app)"
}
if (-not $deviceCredential -and -not $enrollmentCode -and (-not $agentToken -or $agentToken -eq "replace-me-with-real-token" -or $agentToken -eq "dev-monitoring-token")) {
    $enrollmentCode = Read-Host "Enter one-time Enrollment Code (recommended; leave blank only for legacy installation)"
    if (-not $enrollmentCode) {
        $agentToken = Read-Host "Enter legacy Agent Token"
    }
}
if (-not $deviceName) {
    $deviceName = Read-Host "Enter Optional Device Name (leave blank to use hostname)"
}

$newConfig = @{
    backendUrl = $backendUrl
    agentToken = $agentToken
    enrollmentCode = $enrollmentCode
    deviceCredential = $deviceCredential
    deviceName = $deviceName
    heartbeatIntervalSeconds = 30
    activityIntervalSeconds = 30
    screenshotEnabled = $false
}

[System.IO.File]::WriteAllText($configFile, ($newConfig | ConvertTo-Json -Depth 5))
Write-Host "Private machine config saved to agent-config.local.json."

# Create invisible launcher script
Write-Host "Configuring invisible startup..."
$vbsScript = @"
Set WshShell = CreateObject("WScript.Shell")
strPath = Wscript.ScriptFullName
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objFile = objFSO.GetFile(strPath)
strFolder = objFSO.GetParentFolderName(objFile)
WshShell.CurrentDirectory = strFolder
WshShell.Run "cmd.exe /c node agent.js", 0, False
"@
$vbsPath = Join-Path $PSScriptRoot "invisible.vbs"
[System.IO.File]::WriteAllText($vbsPath, $vbsScript)

# Add to HKLM Run so it starts in every user's Session 1 invisibly
Write-Host "Registering for startup (All Users)..."
$regPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $regPath -Name "AstreaBlueMonitoringAgent" -Value "wscript.exe `"$vbsPath`""

Write-Host "Starting agent now..."
Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`"" -WindowStyle Hidden

Write-Host "Installation Complete! Agent is running silently in the background." -ForegroundColor Green
