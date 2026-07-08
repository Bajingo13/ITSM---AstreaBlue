#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$AgentDir = $PSScriptRoot
$ServiceName = 'AstreaBlue Monitoring Agent'

$service = Get-Service -DisplayName $ServiceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Stopped') {
    Stop-Service -Name $service.Name -Force
    $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
}

& node (Join-Path $AgentDir 'svc.js') uninstall
if ($LASTEXITCODE -ne 0) { throw 'Service uninstall failed.' }
Write-Host "Service '$ServiceName' was removed. Device identity and logs were preserved." -ForegroundColor Green
