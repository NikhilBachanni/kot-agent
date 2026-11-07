# ==============================================================================
# PLATORIA PRINT AGENT — SMARTPOS PRINT BRIDGE DIAGNOSTIC SCRIPT (POWERSHELL)
# ==============================================================================
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-smartpos.ps1
# ==============================================================================

param (
    [string]$BaseUrl = "http://127.0.0.1:8003",
    [string]$PrinterName = "TVS RP 3220 Star",
    [switch]$SendTestPrint
)

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " 🖨️  Platoria SmartPOS Print Bridge Diagnostics       " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Test Bridge Connectivity
Write-Host "[1/4] Testing connection to SmartPOS Print Bridge on $BaseUrl ..." -ForegroundColor Yellow

$connected = $false
$detectedPrinters = @()

$endpoints = @("/printers", "/status", "/health", "/")

foreach ($ep in $endpoints) {
    $testUrl = "$BaseUrl$ep"
    try {
        $response = Invoke-RestMethod -Uri $testUrl -Method Get -TimeoutSec 3 -ErrorAction Stop
        Write-Host "  ✓ Response received on $testUrl" -ForegroundColor Green
        $connected = $true

        if ($response -is [System.Array]) {
            $detectedPrinters = $response
        } elseif ($response.printers) {
            $detectedPrinters = $response.printers
        }
        break
    } catch {
        # continue trying
    }
}

if (-not $connected) {
    Write-Host "  ✗ Could not connect to SmartPOS on $BaseUrl." -ForegroundColor Red
    Write-Host "    Scanning candidate ports (8000-8010) ..." -ForegroundColor Yellow
    
    foreach ($port in 8000..8010) {
        $candidateUrl = "http://127.0.0.1:$port/printers"
        try {
            $candidateRes = Invoke-RestMethod -Uri $candidateUrl -Method Get -TimeoutSec 1 -ErrorAction Stop
            Write-Host "  ✓ Discovered SmartPOS on http://127.0.0.1:$port" -ForegroundColor Green
            $BaseUrl = "http://127.0.0.1:$port"
            $connected = $true
            if ($candidateRes -is [System.Array]) {
                $detectedPrinters = $candidateRes
            }
            break
        } catch {}
    }
}

if (-not $connected) {
    Write-Host ""
    Write-Host "ERROR: SmartPOS Print Bridge is not responding on 127.0.0.1." -ForegroundColor Red
    Write-Host "Please check that SmartPOS Print Bridge is installed and running in the Windows System Tray." -ForegroundColor Yellow
    exit 1
}

# 2. Check Installed Printers
Write-Host ""
Write-Host "[2/4] Querying available Windows printers via SmartPOS..." -ForegroundColor Yellow

if ($detectedPrinters.Count -gt 0) {
    Write-Host "  Installed printers found:" -ForegroundColor Cyan
    foreach ($p in $detectedPrinters) {
        Write-Host "    - $p" -ForegroundColor White
    }
} else {
    Write-Host "  Bridge responded without an enumerated printer list (direct printer targeting enabled)." -ForegroundColor Gray
}

# 3. Verify Target Printer
Write-Host ""
Write-Host "[3/4] Verifying configured printer '$PrinterName'..." -ForegroundColor Yellow

$printerMatched = $false
foreach ($p in $detectedPrinters) {
    if ($p.ToString().Trim().ToLower() -eq $PrinterName.Trim().ToLower()) {
        $printerMatched = $true
        break
    }
}

if ($printerMatched) {
    Write-Host "  ✓ Printer '$PrinterName' is verified and available!" -ForegroundColor Green
} else {
    Write-Host "  ⚠️ Printer '$PrinterName' was not matched in the list." -ForegroundColor Yellow
    Write-Host "     Please ensure the name in .env matches Windows 'Printers & scanners' exactly." -ForegroundColor Yellow
}

# 4. Optional Test Print
if ($SendTestPrint) {
    Write-Host ""
    Write-Host "[4/4] Sending test ESC/POS receipt to '$PrinterName'..." -ForegroundColor Yellow
    
    # Build minimal ESC/POS bytes: ESC @ (Init) + Text + LF + Feed + Cut
    $escInit = [byte]0x1b, [byte]0x40
    $center = [byte]0x1b, [byte]0x61, [byte]0x01
    $boldOn = [byte]0x1b, [byte]0x45, [byte]0x01
    $boldOff = [byte]0x1b, [byte]0x45, [byte]0x00
    $feedAndCut = [byte]0x1b, [byte]0x64, [byte]0x04, [byte]0x1d, [byte]0x56, [byte]0x42, [byte]0x00
    
    $headerText = [System.Text.Encoding]::ASCII.GetBytes("================================================`nPLATORIA PRINT AGENT TEST`nTVS RP 3220 Star 80mm`n================================================`nBridge: $BaseUrl`nDate: $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')`nStatus: OPERATIONAL`n================================================`n")
    
    $allBytes = $escInit + $center + $boldOn + $headerText + $boldOff + $feedAndCut
    $base64Data = [Convert]::ToBase64String($allBytes)
    
    $payload = @{
        printer = $PrinterName
        data = $base64Data
        dataBase64 = $base64Data
        type = "raw"
        raw = $true
    } | ConvertTo-Json
    
    try {
        $printUrl = "$BaseUrl/print"
        $printRes = Invoke-RestMethod -Uri $printUrl -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 5
        Write-Host "  ✓ SmartPOS bridge accepted test print!" -ForegroundColor Green
        Write-Host "    Response: $($printRes | ConvertTo-Json -Compress)" -ForegroundColor Gray
    } catch {
        Write-Host "  ✗ Print failed: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host ""
    Write-Host "[4/4] Skipping physical test print. (Use -SendTestPrint flag to send test print)." -ForegroundColor Gray
}

Write-Host ""
Write-Host "Diagnostic complete." -ForegroundColor Cyan
