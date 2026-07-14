param([switch]$PurgeIdentity)

$ErrorActionPreference = "Stop"
$serviceName = "AstreaBlueMonitoringAgent"
$installDirectory = Join-Path $env:ProgramFiles "AstreaBlue\Monitoring Agent"
$dataDirectory = Join-Path $env:ProgramData "AstreaBlue\MonitoringAgent"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Run uninstall from PowerShell as Administrator." }

Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
& sc.exe delete $serviceName 2>$null | Out-Null
Remove-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "AstreaBlueActivityCompanion" -ErrorAction SilentlyContinue
Get-Process -Name "AstreaBlue.ActivityCompanion" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $installDirectory) { Remove-Item -LiteralPath $installDirectory -Recurse -Force }
if ($PurgeIdentity -and (Test-Path $dataDirectory)) {
    Remove-Item -LiteralPath $dataDirectory -Recurse -Force
    Write-Host "Agent, protected credential, logs, and local device identity were removed." -ForegroundColor Yellow
} else {
    Write-Host "Agent removed. Device identity, credential, and logs were preserved for repair/reinstallation." -ForegroundColor Green
}
