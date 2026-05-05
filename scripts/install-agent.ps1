# SessionBridge Agent — Windows Scheduled Task installer (user-level)
# Run as current user (no admin required):
#   powershell -ExecutionPolicy Bypass .\install-agent.ps1 -RelayUrl "ws://10.0.0.1:8080"
#
# Registers the agent as a user scheduled task that starts at logon.
# Agent code installed to %LOCALAPPDATA%\session-bridge\

param(
    [Parameter(Mandatory=$true)]
    [string]$RelayUrl,

    [string]$ProjectDir = "$env:USERPROFILE",

    [string]$Label = "$env:COMPUTERNAME".ToLower(),

    [string]$DashboardPort = "9843",

    [string]$NodePath = "node",

    [string]$InstallDir = "$env:LOCALAPPDATA\session-bridge",

    [string]$TaskName = "SessionBridgeAgent"
)

$ErrorActionPreference = "Stop"

# ── Install agent code ──────────────────────────────
Write-Host "==> Installing agent to $InstallDir" -ForegroundColor Cyan
$null = New-Item -ItemType Directory -Path $InstallDir -Force

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Resolve-Path "$scriptDir\.."

# Copy source files (exclude node_modules, .next, .git)
robocopy "$projectDir" "$InstallDir" /E /XD node_modules .next .git /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
    Write-Error "Failed to copy project files"
    exit 1
}

# Install dependencies
Set-Location $InstallDir
npm install --production --no-audit --no-fund 2>&1 | Select-Object -Last 1

$logFile   = "$InstallDir\agent.log"
$pidFile   = "$InstallDir\agent.pid"
$entryPoint = "$InstallDir\dist\src\index.js"

# ── Agent run arguments ─────────────────────────────
$agentArgs = @(
    $entryPoint,
    "agent",
    "--relay", $RelayUrl,
    "--dir", $ProjectDir,
    "--label", $Label,
    "--dashboard-port", $DashboardPort,
    "--log-file", $logFile,
    "--pid-file", $pidFile
)

# ── Register scheduled task (user-level) ────────────
# First unregister if exists
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument ($agentArgs -join ' ') `
    -WorkingDirectory $InstallDir

$trigger = New-ScheduledTaskTrigger -AtLogon

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Host ""
Write-Host "  Agent installed successfully" -ForegroundColor Green
Write-Host "  Relay:    $RelayUrl"
Write-Host "  Dir:      $ProjectDir"
Write-Host "  Label:    $Label"
Write-Host "  Log:      $logFile"
Write-Host "  Dashboard: http://localhost:${DashboardPort}"
Write-Host ""
Write-Host "Start now: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Check:     Get-ScheduledTask -TaskName '$TaskName' | fl State"
