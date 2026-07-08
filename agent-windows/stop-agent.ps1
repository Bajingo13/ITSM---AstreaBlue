param ()

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Please run this script as Administrator." -ForegroundColor Red
    Exit
}

Stop-Service -Name "AstreaBlue Monitoring Agent" -ErrorAction Stop
Write-Host "Service stopped." -ForegroundColor Green
