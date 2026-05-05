# SessionBridge Agent — Windows Scheduled Task uninstaller (user-level)
# Run as current user:
#   powershell -ExecutionPolicy Bypass .\remove-agent.ps1

param(
    [string]$TaskName = "SessionBridgeAgent",

    [string]$InstallDir = "$env:LOCALAPPDATA\session-bridge",

    [switch]$KeepCode
)

$ErrorActionPreference = "Stop"

Write-Host "==> Uninstalling SessionBridge agent..." -ForegroundColor Cyan

# ── Remove scheduled task ────────────────────────────
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "  Scheduled task removed" -ForegroundColor Green
} else {
    Write-Host "  No scheduled task found" -ForegroundColor Yellow
}

# ── Remove agent code ─────────────────────────────────
if (-not $KeepCode -and (Test-Path $InstallDir)) {
    Remove-Item -Recurse -Force $InstallDir
    Write-Host "  Code removed: $InstallDir" -ForegroundColor Green
} elseif ($KeepCode) {
    Write-Host "  (keeping code at $InstallDir)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  SessionBridge agent uninstalled." -ForegroundColor Green
