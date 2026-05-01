# SessionBridge Agent — Windows Scheduled Task installer
# Run as Administrator:  powershell -ExecutionPolicy Bypass ./install-agent.ps1
#
# Registers the agent as a scheduled task that starts on boot and
# restarts on failure. Logs are written to %PROGRAMDATA%\session-bridge\.

param(
    [Parameter(Mandatory=$true)]
    [string]$RelayUrl,

    [Parameter(Mandatory=$true)]
    [string]$ProjectDir,

    [string]$Label = "windows-$env:COMPUTERNAME".ToLower(),
    [string]$NodePath = "node",
    [string]$TaskName = "SessionBridgeAgent"
)

$ErrorActionPreference = "Stop"
$logDir = "$env:ProgramData\session-bridge"
$null = New-Item -ItemType Directory -Path $logDir -Force
$logFile = "$logDir\agent.log"
$pidFile = "$logDir\agent.pid"

$action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "dist/agent.js --relay $RelayUrl --dir $ProjectDir --label $Label --log-file $logFile --pid-file $pidFile" `
    -WorkingDirectory (Resolve-Path "$PSScriptRoot\..")

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force

Write-Host "✓ Task '$TaskName' registered." -ForegroundColor Green
Write-Host "  Relay: $RelayUrl"
Write-Host "  Dir:   $ProjectDir"
Write-Host "  Label: $Label"
Write-Host "  Log:   $logFile"
Write-Host ""
Write-Host "Start immediately: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Check status:      Get-ScheduledTask -TaskName '$TaskName' | fl *"
