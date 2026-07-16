param()

$serviceName = "AstreaBlueMonitoringAgent"
$targetExe = Join-Path $env:ProgramFiles "AstreaBlue\Monitoring Agent\AstreaBlue.Agent.Service.exe"
$logDirectory = Join-Path $env:ProgramData "AstreaBlue\MonitoringAgent\logs"

Write-Host "AstreaBlue Native Agent Diagnostics" -ForegroundColor Cyan
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) { Write-Host "Service: $($service.Status) ($($service.StartType))" } else { Write-Host "Service: Not installed" -ForegroundColor Yellow }
if (Test-Path $targetExe) { & $targetExe --diagnostics } else { Write-Host "Executable: Missing at $targetExe" -ForegroundColor Red }
$latestLog = Get-ChildItem $logDirectory -Filter 'agent-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latestLog) { Write-Host "Latest log: $($latestLog.FullName)"; Get-Content $latestLog.FullName -Tail 20 }
