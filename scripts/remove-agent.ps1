# SessionBridge Agent — Windows Scheduled Task uninstaller
# Run as Administrator:  powershell -ExecutionPolicy Bypass ./remove-agent.ps1

param(
    [string]$TaskName = "SessionBridgeAgent"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Task '$TaskName' not found. Nothing to remove." -ForegroundColor Yellow
    exit 0
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Write-Host "✓ Task '$TaskName' unregistered." -ForegroundColor Green
