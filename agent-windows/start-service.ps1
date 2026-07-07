#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$ServiceName = 'AstreaBlue Monitoring Agent'

$service = Get-Service -DisplayName $ServiceName -ErrorAction Stop
if ($service.Status -ne 'Running') {
    Start-Service -Name $service.Name
    $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(20))
}
Write-Host "Service '$ServiceName' is running." -ForegroundColor Green
