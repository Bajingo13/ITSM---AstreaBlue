param ()

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Please run this script as Administrator." -ForegroundColor Red
    Exit
}

Write-Host "Uninstalling AstreaBlue Monitoring Agent..."

$svcScript = @"
const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'AstreaBlue Monitoring Agent',
  script: path.join(__dirname, 'agent.js'),
  workingDirectory: __dirname
});

svc.on('uninstall', function() {
  console.log('Service uninstalled successfully.');
});
svc.on('error', function(err) {
  console.error('Service error:', err);
});

svc.uninstall();
"@

$tempScriptPath = Join-Path $PSScriptRoot "_temp_uninstall.js"
$svcScript | Out-File -FilePath $tempScriptPath -Encoding utf8

node $tempScriptPath
Start-Sleep -Seconds 5
if (Test-Path $tempScriptPath) { Remove-Item $tempScriptPath -Force }

Write-Host "Uninstall Complete." -ForegroundColor Green
