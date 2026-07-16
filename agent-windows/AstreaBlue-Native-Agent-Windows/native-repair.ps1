param()

$ErrorActionPreference = "Stop"
$serviceName = "AstreaBlueMonitoringAgent"
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
if (-not (Test-Path (Join-Path $dataDirectory "credential.bin"))) { throw "No enrolled credential exists. Use native-install.ps1 with a new enrollment code." }

Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='AstreaBlue.ActivityCompanion.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null }
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item $sourceExe $targetExe -Force
Copy-Item $sourceCompanion $targetCompanion -Force
Copy-Item $sourceUpdater $targetUpdater -Force
if (Test-Path "$sourceExe.config") { Copy-Item "$sourceExe.config" "$targetExe.config" -Force }
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
Start-Process -FilePath $targetCompanion
Write-Host "AstreaBlue agent repair completed successfully." -ForegroundColor Green
