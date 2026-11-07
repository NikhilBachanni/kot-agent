# Platoria Print Agent — Troubleshooting & Diagnostics Guide

This document provides resolutions for operational issues encountered while running the Platoria Print Agent with a TVS RP 3220 Star printer on Windows.

---

## 1. Fast Diagnostic Checklist

Run this 30-second checklist in PowerShell first:

```powershell
# 1. Run the bridge diagnostics script
powershell -ExecutionPolicy Bypass -File .\scripts\test-smartpos.ps1

# 2. Inspect the latest agent log file
Get-Content .\logs\agent-*.log -Tail 50
```

---

## 2. Common Issues & Solutions

### A. Authentication Errors (`401 Unauthorized` or `403 Forbidden`)

**Symptom:**
Log output:
```
[ERROR] Failed to claim job: Platoria API error: 401 Unauthorized
```

**Cause:**
- `PRINT_AGENT_TOKEN` in `.env` does not match the token configured in the Platoria Cloudflare Worker or restaurant settings.
- The token was generated for a different branch/restaurant ID.

**Solution:**
1. Open Platoria Web Admin > Settings > Hardware / Printing.
2. Verify or regenerate the Print Agent Device Token.
3. Update `PRINT_AGENT_TOKEN` in `.env`.
4. Restart the agent:
   ```powershell
   Stop-ScheduledTask -TaskName "PlatoriaPrintAgent"
   Start-ScheduledTask -TaskName "PlatoriaPrintAgent"
   ```

---

### B. SmartPOS Print Bridge Offline or Port Mismatch

**Symptom:**
Log output:
```
[WARN] Pre-flight check failed: SmartPOS Print Bridge is offline. Backing off...
```
Or claiming jobs is paused.

**Cause:**
- SmartPOS Print Bridge application is not running.
- SmartPOS selected a dynamic port instead of `8003`.
- Windows Firewall blocked loopback access (rare).

**Solution:**
1. Ensure the SmartPOS Print Bridge application is running in the Windows System Tray (near the clock).
2. Run `.\scripts\test-smartpos.ps1`. The script automatically scans ports `8000` through `8010` to locate the listening port.
3. If discovered on another port (e.g., `8005`), update `SMARTPOS_BASE_URL` in `.env`:
   ```ini
   SMARTPOS_BASE_URL=http://127.0.0.1:8005
   ```
4. Restart the agent. Note: The agent also incorporates built-in dynamic port auto-discovery at startup.

---

### C. Printer Not Found (`PRINTER_NOT_FOUND`)

**Symptom:**
Log output:
```
[ERROR] Printer "TVS RP 3220 Star" not found in SmartPOS printer list.
```

**Cause:**
- The USB cable is unplugged or the printer power switch is OFF.
- The Windows printer driver name differs from `PRINTER_NAME` in `.env` (e.g. `TVS RP-3220` vs `TVS RP 3220 Star`).

**Solution:**
1. Check that the TVS printer has a solid blue power light and is connected via USB.
2. Run:
   ```powershell
   Get-Printer | Select-Object Name, PortName, PrinterStatus
   ```
3. Copy the exact `Name` string returned by Windows.
4. Set that exact string in `.env`:
   ```ini
   PRINTER_NAME=TVS RP 3220 Star
   ```
5. Restart the agent.

---

### D. Ambiguous Print State (`NEEDS_REVIEW`)

**Symptom:**
Log output:
```
[WARN] Job <id> dispatch resulted in ambiguous timeout. Acknowledged as NEEDS_REVIEW to prevent duplicate printing.
```

**Cause:**
Physical printing cannot be 100% verified once bytes are queued into the Windows spooler if the bridge drops the connection before returning HTTP 200, or if the agent network connection drops during acknowledgment.
To protect the restaurant from printing the same order twice (wasting kitchen ingredients), the agent flags the job as `NEEDS_REVIEW`.

**Resolution Workflow:**
1. Look at the kitchen physical printer: Did the ticket print?
2. Open Platoria Moderator POS > Live Orders.
3. If the paper ticket printed: Click **Mark as Printed** in POS.
4. If paper did not print: Click **Reprint KOT** from the order action menu. A reprint job will be dispatched with a prominent `*** REPRINT ***` header on the ticket.

---

### E. Single Instance Lock Conflict (`.agent.lock`)

**Symptom:**
Agent exits on startup with:
```
[FATAL] Another instance of Platoria Print Agent is already running (PID: xxxx). Exiting.
```

**Cause:**
- An instance is already running in background (e.g., via Task Scheduler or another terminal).
- A previous crash left a stale lock file.

**Solution:**
1. Check if node is running:
   ```powershell
   Get-Process -Name node
   ```
2. If another instance is running and you want to stop it:
   ```powershell
   Stop-Process -Name node -Force
   ```
3. If no other node process is running, delete the lock file:
   ```powershell
   Remove-Item .\.agent.lock -Force
   ```
4. Restart the agent.

---

### F. Paper Out, Paper Jam, or Cover Open

**Symptom:**
TVS RP 3220 Star beeps with an orange/red error LED flashing.

**Solution:**
1. Open the top cover of the TVS printer.
2. Check if the paper roll is depleted or misaligned.
3. Insert a fresh 80mm roll with the paper feeding from the bottom upwards.
4. Firmly close the cover until it clicks. The status LED will turn solid blue.
5. Pending print jobs in the Windows spooler will automatically flush and print.

---

### G. Text Formatting or Special Characters

**Design & Safety Rule:**
- The TVS RP 3220 Star uses standard ESC/POS Font A (48 columns across 80mm width).
- Prices, totals, and customer payment details are intentionally **NEVER** printed on KOTs.
- Special currency symbols (such as the Rupee symbol `₹`) and unsupported Unicode characters are sanitized to `Rs.` or plain ASCII text by `src/escpos.ts` before reaching the printer. This guarantees no corrupt or garbled binary text is spit out by the printer.

---

## 3. Log Inspection & Privacy

All agent logs are saved daily in:
```
printer agent/logs/agent-YYYY-MM-DD.log
```

- **Security Guarantee:** Device tokens, `Authorization: Bearer` headers, customer phone numbers, and customer access tokens are masked using regex filters before writing to disk or console.
- **Log Rotation:** A new log file is automatically created every midnight local time. Old log files can be archived or deleted periodically without affecting the agent.
