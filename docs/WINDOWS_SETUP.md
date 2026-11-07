# Platoria Windows Print Agent — Setup & Deployment Guide

This guide walks through configuring and running the **Platoria Windows Print Agent** on the restaurant's Windows PC connected to a **TVS RP 3220 Star (80mm Thermal Printer)** via USB.

---

## 1. System Requirements

- **Operating System:** Windows 10, Windows 11, or Windows Server 2019+ (64-bit).
- **Runtime:** Node.js LTS (v18.0.0 or higher).
- **Physical Printer:** TVS RP 3220 Star 80mm Thermal Receipt/KOT Printer.
- **Connection:** USB cable to Windows PC.
- **Driver:** Official TVS RP 3220 Star Windows Driver installed and visible in `Settings > Bluetooth & devices > Printers & scanners`.
- **Local Print Bridge:** **SmartPOS Print Bridge** installed and running on `127.0.0.1:8003` (or any port between 8000–8010).

---

## 2. Printer & Driver Setup

1. Connect the TVS RP 3220 Star to a USB port on the Windows PC and power it ON.
2. Load 80mm thermal receipt paper roll. Press the FEED button to ensure paper feeds smoothly.
3. Open Windows **Printers & Scanners**:
   - Verify that **"TVS RP 3220 Star"** (or your designated driver name) appears in the list.
   - Click the printer, open **Printer properties**, and click **Print Test Page**.
   - Ensure the Windows test page prints correctly.
4. Note the exact printer name shown in Windows (e.g. `TVS RP 3220 Star`). You will put this in `.env`.

---

## 3. SmartPOS Print Bridge Verification

The Platoria Print Agent does not send raw USB ioctl commands directly to kernel drivers; it communicates locally via the **SmartPOS Print Bridge HTTP loopback API** on `http://127.0.0.1:8003`.

1. Ensure the SmartPOS Print Bridge application is launched on the PC (typically minimized in the Windows System Tray).
2. Open PowerShell and run the diagnostic script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\test-smartpos.ps1
   ```
3. The script will:
   - Ping `http://127.0.0.1:8003` (and scan ports 8000–8010 if needed).
   - Enumerate all installed Windows printers detected by the bridge.
   - Verify that your configured printer (`TVS RP 3220 Star`) is visible to the bridge.
   - (Optional) Send a test receipt ticket if you pass `-SendTestPrint`.

---

## 4. Installing and Configuring the Agent

1. **Extract or clone** the `printer agent` directory to a permanent path on the PC (e.g., `C:\Platoria\printer-agent`).
2. Open PowerShell or Command Prompt in that folder:
   ```powershell
   cd C:\Platoria\printer-agent
   ```
3. Install dependencies:
   ```powershell
   npm install
   ```
4. Build the TypeScript codebase:
   ```powershell
   npm run build
   ```
5. Create your production `.env` file from `.env.example`:
   ```powershell
   copy .env.example .env
   ```
6. Open `.env` in Notepad and set your restaurant credentials:
   ```ini
   # Cloudflare Worker URL for your production Platoria instance
   PLATORIA_API_URL=https://shambhu-cafe.yourdomain.com

   # The dedicated secret device token generated in Platoria Admin Settings
   PRINT_AGENT_TOKEN=pla_sec_xxxxxxxxxxxxxxxxxxxx

   # Unique identifier for this terminal/PC
   PRINT_AGENT_ID=counter-pos-01

   # SmartPOS Print Bridge loopback URL
   SMARTPOS_BASE_URL=http://127.0.0.1:8003

   # Exact printer name as registered in Windows Printers & Scanners
   PRINTER_NAME=TVS RP 3220 Star

   # Queue polling interval in milliseconds (default: 2000 ms)
   POLL_INTERVAL_MS=2000

   # HTTP request timeout
   HTTP_TIMEOUT_MS=10000

   # Maximum retry attempts before marking a job failed
   MAX_ATTEMPTS=3

   # Log level: debug, info, warn, error
   LOG_LEVEL=info

   # Local restaurant timezone
   TIMEZONE=Asia/Kolkata
   ```

---

## 5. Running the Agent Interactively (Test Mode)

Before configuring background startup, test the agent interactively in your terminal:

```powershell
npm start
```

You should see startup diagnostic logs:
```
======================================================
  PLATORIA WINDOWS PRINT AGENT v1.0.0
======================================================
Platoria API:    https://shambhu-cafe.yourdomain.com
Agent ID:        counter-pos-01
SmartPOS Bridge: http://127.0.0.1:8003
Target Printer:  TVS RP 3220 Star
Poll Interval:   2000 ms
Single instance lock acquired: C:\Platoria\printer-agent\.agent.lock
[INFO] Pre-flight check: SmartPOS Print Bridge is healthy on http://127.0.0.1:8003
[INFO] Printer "TVS RP 3220 Star" verified in Windows spooler.
[INFO] Starting sequential KOT polling loop...
```

Place an order from the Platoria POS or customer QR menu. You should observe:
1. `Claimed job <id> (Attempt 1)`
2. `Job <id> marked PRINTING on server`
3. `ESC/POS byte stream generated (xxx bytes, 48 cols)`
4. `Dispatched to SmartPOS loopback bridge`
5. `Acknowledged SUBMITTED to Platoria`
6. Physical KOT printed and cut on the TVS RP 3220 Star!

Press `Ctrl + C` to gracefully stop the agent.

---

## 6. Automatic Background Startup via Windows Task Scheduler

To ensure KOTs print automatically after the PC restarts or a cashier logs in, register the agent as a Windows Scheduled Task:

1. Run the installer script in an Administrator PowerShell prompt:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-task-scheduler.ps1
   ```
2. The script will:
   - Validate `node` and `dist\index.js`.
   - Register a task named **`PlatoriaPrintAgent`**.
   - Configure it to trigger **At User Logon**.
   - Enable automatic restart if interrupted.
3. Manage the scheduled task with standard PowerShell commands:
   ```powershell
   # Start task
   Start-ScheduledTask -TaskName "PlatoriaPrintAgent"

   # Check status
   Get-ScheduledTask -TaskName "PlatoriaPrintAgent"

   # Stop task
   Stop-ScheduledTask -TaskName "PlatoriaPrintAgent"

   # View live log output
   Get-Content .\logs\agent-*.log -Tail 30 -Wait
   ```

4. To uninstall the background task:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\remove-task-scheduler.ps1
   ```
