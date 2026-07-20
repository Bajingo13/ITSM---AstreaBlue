param(
    [string]$BackendUrl = "https://backend-production-fc059.up.railway.app",
    [string]$EnrollmentCode,
    [string]$DeviceName = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"
$serviceName = "AstreaBlueMonitoringAgent"
$legacyServiceName = "astreabluemonitoringagent.exe"
$installDirectory = Join-Path $env:ProgramFiles "AstreaBlue\Monitoring Agent"
$dataDirectory = Join-Path $env:ProgramData "AstreaBlue\MonitoringAgent"
$sourceExe = Join-Path $PSScriptRoot "AstreaBlue.Agent.Service.exe"
$sourceCompanion = Join-Path $PSScriptRoot "AstreaBlue.ActivityCompanion.exe"
$sourceUpdater = Join-Path $PSScriptRoot "AstreaBlue.Agent.Updater.exe"
$targetExe = Join-Path $installDirectory "AstreaBlue.Agent.Service.exe"
$targetCompanion = Join-Path $installDirectory "AstreaBlue.ActivityCompanion.exe"
$targetUpdater = Join-Path $installDirectory "AstreaBlue.Agent.Updater.exe"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Run repair from PowerShell as Administrator." }
if (-not (Test-Path $sourceExe)) { throw "AstreaBlue.Agent.Service.exe is missing from the package." }
if (-not (Test-Path $sourceCompanion)) { throw "AstreaBlue.ActivityCompanion.exe is missing from the package." }
if (-not (Test-Path $sourceUpdater)) { throw "AstreaBlue.Agent.Updater.exe is missing from the package." }
$credentialPath = Join-Path $dataDirectory "credential.bin"
$configPath = Join-Path $dataDirectory "config.json"
$forceEnrollment = -not [string]::IsNullOrWhiteSpace($EnrollmentCode)
$requiresEnrollment = $forceEnrollment -or -not (Test-Path $credentialPath) -or -not (Test-Path $configPath)
if ($requiresEnrollment -and -not $EnrollmentCode) {
    throw "The native service is installed but not enrolled. Generate a one-time enrollment code, then run native-repair.ps1 -EnrollmentCode <code>."
}
if ($requiresEnrollment -and $BackendUrl -notmatch '^https://') { throw "Production enrollment requires an HTTPS backend URL." }

Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='AstreaBlue.ActivityCompanion.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null }
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item $sourceExe $targetExe -Force
Copy-Item $sourceCompanion $targetCompanion -Force
Copy-Item $sourceUpdater $targetUpdater -Force
if (Test-Path "$sourceExe.config") { Copy-Item "$sourceExe.config" "$targetExe.config" -Force }
if ($requiresEnrollment) {
    & $targetExe --enroll --backend $BackendUrl --code $EnrollmentCode --name $DeviceName
    if ($LASTEXITCODE -ne 0) { throw "Native agent enrollment failed. Generate a new one-time code and retry repair." }
}

# A successful native repair owns endpoint collection from this point forward.
# Remove the retired Node.js pilot startup to prevent duplicate heartbeats and split inventory state.
Stop-Service -Name $legacyServiceName -Force -ErrorAction SilentlyContinue
& sc.exe delete $legacyServiceName 2>$null | Out-Null
Remove-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "AstreaBlueMonitoringAgent" -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*agent-windows*agent.js*' } |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null }

& icacls.exe $dataDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
Set-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "AstreaBlueActivityCompanion" -Value "`"$targetCompanion`""

$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $existingService) {
    New-Service -Name $serviceName -BinaryPathName "`"$targetExe`"" -StartupType Automatic -DisplayName "AstreaBlue Monitoring Agent" -Description "AstreaBlue ITSM consent-aware endpoint monitoring agent." | Out-Null
} else {
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName" -Name ImagePath -Value "`"$targetExe`""
    Set-Service -Name $serviceName -StartupType Automatic
}
& sc.exe description $serviceName "AstreaBlue ITSM consent-aware endpoint monitoring agent." | Out-Null
& sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/60000/restart/300000 | Out-Null
& sc.exe failureflag $serviceName 1 | Out-Null
Start-Service -Name $serviceName
Start-Sleep -Seconds 3
& $targetExe --diagnostics
if ($LASTEXITCODE -ne 0) { throw "Repair completed but diagnostics failed." }
& $targetExe --heartbeat-once
if ($LASTEXITCODE -ne 0) { throw "Repair completed but the enrolled device credential failed backend authentication." }
Start-Process -FilePath $targetCompanion
Write-Host "AstreaBlue agent repair completed successfully." -ForegroundColor Green
