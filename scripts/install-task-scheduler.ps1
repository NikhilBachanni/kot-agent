# ==============================================================================
# PLATORIA PRINT AGENT — WINDOWS TASK SCHEDULER INSTALLER (POWERSHELL)
# ==============================================================================
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-task-scheduler.ps1
#
# Description:
#   Creates a Windows Task Scheduler task named "PlatoriaPrintAgent" that starts
#   the agent automatically when the current user logs into Windows.
#   It runs the compiled Node.js application in background and restarts on error.
# ==============================================================================

param (
    [string]$TaskName = "PlatoriaPrintAgent",
    [string]$AgentDir = "$PSScriptRoot\..",
    [switch]$Force
)

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " ⚙️  Platoria Print Agent - Task Scheduler Installer   " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Resolve Absolute Paths
$resolvedAgentDir = (Resolve-Path $AgentDir).Path
Write-Host "Agent Directory: $resolvedAgentDir" -ForegroundColor Gray

$distEntry = Join-Path $resolvedAgentDir "dist\index.js"
if (-not (Test-Path $distEntry)) {
    Write-Host "❌ Error: dist\index.js not found!" -ForegroundColor Red
    Write-Host "   Please compile the agent first by running:" -ForegroundColor Yellow
    Write-Host "     npm run build" -ForegroundColor White
    exit 1
}

$envFile = Join-Path $resolvedAgentDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "⚠️ Warning: .env file not found in $resolvedAgentDir!" -ForegroundColor Yellow
    Write-Host "   Please copy .env.example to .env and configure your device token." -ForegroundColor Yellow
}

# 2. Check for Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "❌ Error: Node.js was not found in PATH." -ForegroundColor Red
    Write-Host "   Please install Node.js LTS (v18+) and try again." -ForegroundColor Yellow
    exit 1
}
$nodePath = $nodeCmd.Source
Write-Host "Node Executable: $nodePath" -ForegroundColor Green

# 3. Check if Task Already Exists
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    if ($Force) {
        Write-Host "Existing task '$TaskName' found. Overwriting (-Force specified)..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    } else {
        Write-Host "⚠️ Task '$TaskName' already exists!" -ForegroundColor Yellow
        Write-Host "   Run with -Force to overwrite or run .\scripts\remove-task-scheduler.ps1 first." -ForegroundColor Yellow
        exit 0
    }
}

# 4. Build Action, Trigger, and Settings
$action = New-ScheduledTaskAction `
    -Execute $nodePath `
    -Argument "`"$distEntry`"" `
    -WorkingDirectory $resolvedAgentDir

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -Priority 4

# 5. Register Task
try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "Platoria Restaurant Windows KOT Print Agent for TVS RP 3220 Star" `
        -ErrorAction Stop | Out-Null

    Write-Host ""
    Write-Host "✅ Task '$TaskName' installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  • Start the agent now:   Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
    Write-Host "  • View status:           Get-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
    Write-Host "  • View logs:             Get-Content $resolvedAgentDir\logs\agent-*.log -Tail 50 -Wait" -ForegroundColor White
    Write-Host "  • Stop the agent:        Stop-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
    Write-Host "  • Uninstall:             .\scripts\remove-task-scheduler.ps1" -ForegroundColor White
} catch {
    Write-Host "❌ Failed to register scheduled task: $_" -ForegroundColor Red
    Write-Host "   Try running PowerShell as Administrator if permission was denied." -ForegroundColor Yellow
    exit 1
}
