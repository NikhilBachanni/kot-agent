# ==============================================================================
# PLATORIA PRINT AGENT — WINDOWS TASK SCHEDULER UNINSTALLER (POWERSHELL)
# ==============================================================================
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\remove-task-scheduler.ps1
# ==============================================================================

param (
    [string]$TaskName = "PlatoriaPrintAgent"
)

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " 🗑️  Platoria Print Agent - Task Scheduler Uninstaller  " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if (-not $existingTask) {
    Write-Host "ℹ️  Scheduled task '$TaskName' does not exist. Nothing to remove." -ForegroundColor Yellow
    exit 0
}

try {
    # Stop running instances first
    if ($existingTask.State -eq "Running") {
        Write-Host "Stopping running task '$TaskName'..." -ForegroundColor Yellow
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    # Unregister task
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    Write-Host "✅ Scheduled task '$TaskName' has been removed successfully." -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to remove scheduled task: $_" -ForegroundColor Red
    Write-Host "   Try running PowerShell as Administrator." -ForegroundColor Yellow
    exit 1
}
