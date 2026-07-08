param ()

$zipName = "AstreaBlue-Agent-Windows.zip"
$sourcePath = $PSScriptRoot
$destinationZip = Join-Path (Split-Path $PSScriptRoot) $zipName

if (Test-Path $destinationZip) {
    Remove-Item $destinationZip -Force
}

$tempDir = Join-Path $env:TEMP "AstreaBlue-Zip-Temp"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

$agentFolder = Join-Path $tempDir "agent-windows"
New-Item -ItemType Directory -Path $agentFolder | Out-Null

$filesToInclude = @(
    "agent.js",
    "package.json",
    "agent-config.json",
    "install-agent.ps1",
    "uninstall-agent.ps1",
    "start-agent.ps1",
    "stop-agent.ps1",
    "README_INSTALL.md"
)

foreach ($file in $filesToInclude) {
    $sourceFile = Join-Path $sourcePath $file
    if (Test-Path $sourceFile) {
        Copy-Item $sourceFile -Destination $agentFolder
    } else {
        Write-Host "Warning: $file not found!" -ForegroundColor Yellow
    }
}

$lockFile = Join-Path $sourcePath "package-lock.json"
if (Test-Path $lockFile) {
    Copy-Item $lockFile -Destination $agentFolder
}

Compress-Archive -Path $agentFolder -DestinationPath $destinationZip -Force

Remove-Item $tempDir -Recurse -Force

Write-Host "ZIP package created successfully at: $destinationZip" -ForegroundColor Green
