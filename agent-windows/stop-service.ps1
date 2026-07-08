#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$ServiceName = 'AstreaBlue Monitoring Agent'

$service = Get-Service -DisplayName $ServiceName -ErrorAction Stop
if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $service.Name -Force
    $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
}
Write-Host "Service '$ServiceName' is stopped." -ForegroundColor Green
Write-Host 'The device becomes Offline when its last heartbeat is more than 120 seconds old.' -ForegroundColor Cyan
