param ()

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Please run this script as Administrator." -ForegroundColor Red
    Exit
}

Write-Host "Uninstalling AstreaBlue Monitoring Agent..."

# 1. Stop and delete old Windows Service if it exists
net stop "AstreaBlue Monitoring Agent" 2>$null
sc.exe delete astreabluemonitoringagent.exe 2>$null

# 2. Remove HKLM Run Key
$regPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
Remove-ItemProperty -Path $regPath -Name "AstreaBlueMonitoringAgent" -ErrorAction SilentlyContinue

# 3. Kill running agent processes
Write-Host "Stopping running agent processes..."
Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%node agent.js%'" | Invoke-CimMethod -MethodName Terminate 2>$null

Write-Host "Uninstall Complete." -ForegroundColor Green
