param([string]$OutputPath = (Join-Path (Split-Path $PSScriptRoot) "AstreaBlue-Native-Agent-Windows.zip"))

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build-native-agent.ps1")
$dist = Join-Path $PSScriptRoot "dist"
$staging = Join-Path $env:TEMP ("AstreaBlue-Native-Agent-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    Copy-Item (Join-Path $dist "AstreaBlue.Agent.Service.exe") $staging
    Copy-Item (Join-Path $dist "AstreaBlue.Agent.Service.exe.config") $staging
    Copy-Item (Join-Path $dist "AstreaBlue.ActivityCompanion.exe") $staging
    Copy-Item (Join-Path $dist "AstreaBlue.Agent.Updater.exe") $staging
    Copy-Item (Join-Path $PSScriptRoot "native-install.ps1") $staging
    Copy-Item (Join-Path $PSScriptRoot "native-repair.ps1") $staging
    Copy-Item (Join-Path $PSScriptRoot "native-diagnostics.ps1") $staging
    Copy-Item (Join-Path $PSScriptRoot "native-uninstall.ps1") $staging
    Copy-Item (Join-Path $PSScriptRoot "README.md") $staging
    Copy-Item (Join-Path $PSScriptRoot "PILOT_MIGRATION.md") $staging
    Copy-Item (Join-Path $PSScriptRoot "SIGNED_UPDATES.md") $staging
    Copy-Item (Join-Path (Split-Path $PSScriptRoot) "AGENT_DELIVERY_TRACKER.md") $staging
    if (Test-Path $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $OutputPath -Force
    Write-Host "Native agent package created: $OutputPath" -ForegroundColor Green
} finally {
    if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
