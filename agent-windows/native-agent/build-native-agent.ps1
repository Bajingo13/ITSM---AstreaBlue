param([string]$OutputDirectory = (Join-Path $PSScriptRoot "dist"))

$ErrorActionPreference = "Stop"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $compiler)) { $compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $compiler)) { throw ".NET Framework C# compiler was not found." }

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = Join-Path $OutputDirectory "AstreaBlue.Agent.Service.exe"
$companionOutput = Join-Path $OutputDirectory "AstreaBlue.ActivityCompanion.exe"
$updaterOutput = Join-Path $OutputDirectory "AstreaBlue.Agent.Updater.exe"
& $compiler /nologo /target:exe /optimize+ /platform:anycpu /out:$output `
  /reference:System.dll /reference:System.Core.dll /reference:System.Management.dll `
  /reference:System.Security.dll /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll `
  (Join-Path $PSScriptRoot "AstreaBlueAgent.cs")
if ($LASTEXITCODE -ne 0) { throw "Native agent compilation failed." }

& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /out:$companionOutput `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
  /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll `
  (Join-Path $PSScriptRoot "AstreaBlueActivityCompanion.cs")
if ($LASTEXITCODE -ne 0) { throw "Activity companion compilation failed." }

& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /out:$updaterOutput `
  /reference:System.dll /reference:System.Core.dll /reference:System.ServiceProcess.dll `
  (Join-Path $PSScriptRoot "AstreaBlueUpdater.cs")
if ($LASTEXITCODE -ne 0) { throw "Rollback updater compilation failed." }

Copy-Item (Join-Path $PSScriptRoot "AstreaBlueAgent.exe.config") "$output.config" -Force
Write-Host "Native agent built: $output" -ForegroundColor Green
Write-Host "Activity companion built: $companionOutput" -ForegroundColor Green
Write-Host "Rollback updater built: $updaterOutput" -ForegroundColor Green
& $output --version
