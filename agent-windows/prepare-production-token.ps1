param ()

$templatePath = Join-Path $PSScriptRoot "agent-config.json"
$localPath = Join-Path $PSScriptRoot "agent-config.local.json"

if (-not (Test-Path $templatePath)) {
    throw "agent-config.json was not found."
}

$bytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $generator.GetBytes($bytes)
} finally {
    $generator.Dispose()
}
$token = -join ($bytes | ForEach-Object { $_.ToString("x2") })

$template = Get-Content $templatePath -Raw | ConvertFrom-Json
$privateConfig = [ordered]@{
    backendUrl = "https://backend-production-fc059.up.railway.app"
    agentToken = $token
    deviceName = $template.deviceName
    heartbeatIntervalSeconds = 30
    activityIntervalSeconds = 30
    screenshotEnabled = $false
}

[System.IO.File]::WriteAllText($localPath, ($privateConfig | ConvertTo-Json -Depth 5))
Set-Clipboard -Value $token

Write-Host "A strong monitoring token was generated and copied to the clipboard." -ForegroundColor Green
Write-Host "Paste it into Railway as MONITORING_AGENT_TOKEN, then return here."
Write-Host "The token was stored only in the Git-ignored agent-config.local.json file."
