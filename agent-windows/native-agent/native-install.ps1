param(
    [string]$BackendUrl = "https://backend-production-fc059.up.railway.app",
    [string]$EnrollmentCode,
    [string]$DeviceName = $env:COMPUTERNAME,
    [string]$UpdateManifestUrl,
    [string]$TrustedSignerThumbprint,
    [ValidateSet("pilot", "stable")][string]$UpdateChannel = "stable"
)

$ErrorActionPreference = "Stop"
$serviceName = "AstreaBlueMonitoringAgent"
$legacyServiceName = "astreabluemonitoringagent.exe"
$installDirectory = Join-Path $env:ProgramFiles "AstreaBlue\Monitoring Agent"
$dataDirectory = Join-Path $env:ProgramData "AstreaBlue\MonitoringAgent"
$sourceExe = Join-Path $PSScriptRoot "AstreaBlue.Agent.Service.exe"
$sourceCompanion = Join-Path $PSScriptRoot "AstreaBlue.ActivityCompanion.exe"
$sourceUpdater = Join-Path $PSScriptRoot "AstreaBlue.Agent.Updater.exe"
$sourceConfig = "$sourceExe.config"
$targetExe = Join-Path $installDirectory "AstreaBlue.Agent.Service.exe"
$targetCompanion = Join-Path $installDirectory "AstreaBlue.ActivityCompanion.exe"
$targetUpdater = Join-Path $installDirectory "AstreaBlue.Agent.Updater.exe"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Run this installer from PowerShell as Administrator." }
if (-not (Test-Path $sourceExe)) { throw "AstreaBlue.Agent.Service.exe is missing from the package." }
if (-not (Test-Path $sourceCompanion)) { throw "AstreaBlue.ActivityCompanion.exe is missing from the package." }
if (-not (Test-Path $sourceUpdater)) { throw "AstreaBlue.Agent.Updater.exe is missing from the package." }
if ([bool]$UpdateManifestUrl -xor [bool]$TrustedSignerThumbprint) { throw "UpdateManifestUrl and TrustedSignerThumbprint must be provided together." }
if (-not $EnrollmentCode) { $EnrollmentCode = Read-Host "Enter the one-time enrollment code from Endpoint Management > Administration" }
if (-not $EnrollmentCode) { throw "A one-time enrollment code is required." }
if ($BackendUrl -notmatch '^https://') { throw "Production enrollment requires an HTTPS backend URL." }

Write-Host "Installing the AstreaBlue native Windows agent..." -ForegroundColor Cyan
Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='AstreaBlue.ActivityCompanion.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null }

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
Copy-Item $sourceExe $targetExe -Force
Copy-Item $sourceCompanion $targetCompanion -Force
Copy-Item $sourceUpdater $targetUpdater -Force
if (Test-Path $sourceConfig) { Copy-Item $sourceConfig "$targetExe.config" -Force }

& $targetExe --enroll --backend $BackendUrl --code $EnrollmentCode --name $DeviceName
if ($LASTEXITCODE -ne 0) { throw "Device enrollment failed. No service was installed; create a new enrollment code and retry." }
if ($UpdateManifestUrl) {
    & $targetExe --configure-updates --manifest $UpdateManifestUrl --thumbprint $TrustedSignerThumbprint --channel $UpdateChannel
    if ($LASTEXITCODE -ne 0) { throw "Signed update configuration failed." }
}

# Retire the pilot process only after native enrollment succeeds, preserving rollback if enrollment fails.
Stop-Service -Name $legacyServiceName -Force -ErrorAction SilentlyContinue
& sc.exe delete $legacyServiceName 2>$null | Out-Null
Remove-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "AstreaBlueMonitoringAgent" -ErrorAction SilentlyContinue
Set-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "AstreaBlueActivityCompanion" -Value "`"$targetCompanion`""
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*agent-windows*agent.js*' } |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null }

# Device identity and DPAPI credential must be readable only by LocalSystem and local Administrators.
& icacls.exe $dataDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null

$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    $serviceOutput = & sc.exe config $serviceName "binPath= `"$targetExe`"" "start= auto" "obj= LocalSystem" "DisplayName= AstreaBlue Monitoring Agent" 2>&1
} else {
    $serviceOutput = & sc.exe create $serviceName "binPath= `"$targetExe`"" "start= auto" "obj= LocalSystem" "DisplayName= AstreaBlue Monitoring Agent" 2>&1
}
if ($LASTEXITCODE -ne 0) { throw "Windows service registration failed: $($serviceOutput -join ' ')" }
& sc.exe description $serviceName "AstreaBlue ITSM consent-aware endpoint monitoring agent." | Out-Null
& sc.exe failure $serviceName "reset= 86400" "actions= restart/60000/restart/60000/restart/300000" | Out-Null
& sc.exe failureflag $serviceName 1 | Out-Null
Start-Service -Name $serviceName
Start-Sleep -Seconds 3

& $targetExe --diagnostics
if ($LASTEXITCODE -ne 0) { throw "The service was installed, but its first diagnostics check failed." }
Write-Host "Installation complete. The native agent is running without Node.js." -ForegroundColor Green
