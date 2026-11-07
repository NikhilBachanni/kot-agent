# Platoria On-Site Deployment & Setup Guide
## Automatic TVS RP 3220 Star KOT Printing via SmartPOS Print Bridge

> **Target Audience:** Field Engineers, Delivery Leads, and POS System Administrators.  
> **Target Hardware:** TVS RP 3220 Star (80mm Thermal Printer) USB-connected to a Windows PC.  
> **Goal:** 100% automated Kitchen Order Ticket (KOT) printing the exact instant a customer places an order on their phone — with **zero manual clicks** or moderator actions.

---

## 🏗️ How Automatic Printing Works (No Moderator Required)

```
   Customer's Phone                 Cloudflare Worker (Platoria)           Windows PC (Restaurant Counter)
  ┌─────────────────┐             ┌─────────────────────────────┐        ┌───────────────────────────────────┐
  │ Scans Table QR  │             │ Next.js App Router Worker   │        │ Platoria Print Agent (Background) │
  │ & Taps "Order"  │────────────►│ Atomic Order Creation RPC   │        │ Polling /api/print-agent/claim    │
  └─────────────────┘  POST /api  │ Inserts 'PENDING' Print Job │◄───────│ Outbound HTTPS every 2 seconds    │
                       /orders    └─────────────────────────────┘        └─────────────────┬─────────────────┘
                                                                                           │ Loopback HTTP
                                                                                           ▼ (127.0.0.1:8003)
                                                                         ┌───────────────────────────────────┐
                                                                         │ SmartPOS Print Bridge             │
                                                                         └─────────────────┬─────────────────┘
                                                                                           │ Windows Spooler
                                                                                           ▼
                                                                         ┌───────────────────────────────────┐
                                                                         │ TVS RP 3220 Star 80mm Printer     │
                                                                         │ 🖨️ Physical KOT Prints & Cuts!    │
                                                                         └───────────────────────────────────┘
```

1. Customer places order on mobile.
2. Cloud database (`Neon PostgreSQL`) atomically creates the order **and** inserts a `PENDING` print job into `print_jobs`.
3. The local **Platoria Print Agent** on the Windows PC polls the server every 2 seconds.
4. The agent claims the job, converts it into binary **ESC/POS** bytes, and sends it to the local **SmartPOS Print Bridge** over `http://127.0.0.1:8003`.
5. SmartPOS pushes the bytes to the TVS printer driver.
6. **Ticket instantly prints and cuts in the kitchen!**

---

## 🎒 Pre-Delivery Checklist (What to Bring to the Restaurant)

Copy these files onto a **USB Flash Drive** before heading out:

1. **Node.js LTS (v18 or v20+) Windows Installer:**  
   Download the `.msi` from [nodejs.org](https://nodejs.org).
2. **TVS RP 3220 Star Windows Driver:**  
   The official TVS driver installer `.exe` from TVS Electronics.
3. **SmartPOS Print Bridge Installer / Zip:**  
   The SmartPOS Print Bridge Windows setup or executable folder.
4. **Platoria Print Agent Folder:**  
   Copy the entire `printer agent` directory from this repository (including `dist/`, `scripts/`, `package.json`, and `.env.example`).
5. **Hardware:**
   - TVS RP 3220 Star thermal printer.
   - Power adapter (24V DC) and power cord.
   - USB cable (Type-A to Type-B).
   - 2+ rolls of **80mm thermal paper**.
   - Your smartphone (to test placing live orders via table QR code).

---

## 📍 Step 1: Physical Printer Setup & Driver Installation

### 1.1 Connect Hardware
1. Place the TVS RP 3220 Star on a sturdy surface near the PC and power outlet.
2. Plug the 24V power adapter into the back of the printer and into the wall outlet.
3. Connect the **USB Type-B** plug into the back of the printer and the **USB Type-A** into the Windows PC (preferably a rear motherboard USB port).
4. **Load Paper:** Press the cover-open latch on the right side. Place the 80mm thermal paper roll inside so the paper feeds **from the bottom up**. Pull 2 inches of paper out and press the lid down firmly until it clicks.
5. Turn the power switch **ON** (front right). The power LED should glow solid **BLUE**.
6. Press the **FEED** button once — paper should advance smoothly.

---

### 1.2 Install the TVS Windows Driver
1. On the Windows PC, plug in your USB flash drive and run the **TVS RP 3220 Star Driver Installer**.
2. Select **USB Port** when prompted (e.g. `USB001` or auto-detect).
3. Complete the installation wizard.
4. Open Windows Start menu -> type **Printers & Scanners** -> press Enter.
5. Verify that **`TVS RP 3220 Star`** is listed.
   > **CRITICAL:** Note the *exact* name as displayed in Windows (e.g., `TVS RP 3220 Star`). If Windows named it `TVS RP-3220`, write that down — the agent configuration must match character-for-character!

---

### 1.3 Verify Print Properties & Default Paper Size
1. Click **TVS RP 3220 Star** -> **Printer Properties** (or right-click printer).
2. On the **General** tab, click **Print Test Page**.
   - *The TVS printer should print the Windows test page and cut.*
3. On the **Device Settings / Advanced** tab:
   - Paper Size: Set to **`80mm x Receipt`** (or `80mm x 297mm`).
   - Cutter / Paper Cut: Set to **`Partial Cut`** or **`Doc / Page End Cut`**.
4. Click **Apply** -> **OK**.

---

## 📍 Step 2: SmartPOS Print Bridge Setup

**What is SmartPOS Print Bridge?**  
It is a local loopback service running on the Windows PC that exposes an HTTP API on `http://127.0.0.1:8003`. It allows background processes to send raw ESC/POS bytes directly to the Windows printer spooler without popping up print dialogs.

### 2.1 Install & Run SmartPOS
1. From your USB drive, install or extract **SmartPOS Print Bridge**.
2. Launch the application (`SmartPOS.exe` or `SmartPOS Print Bridge`).
3. It will minimize into the **Windows System Tray** (bottom-right near the clock).
4. Right-click the tray icon to verify status shows **Running** or **Active**.

---

### 2.2 Verify Bridge Connectivity via PowerShell
Open PowerShell as Administrator and run the built-in diagnostic script located in the agent's `scripts/` folder:

```powershell
cd C:\Platoria\printer-agent
powershell -ExecutionPolicy Bypass -File .\scripts\test-smartpos.ps1
```

The script will automatically:
1. Ping `http://127.0.0.1:8003`.
2. Scan candidate ports `8000–8010` if 8003 is busy.
3. List all Windows printers recognized by SmartPOS.
4. Verify `TVS RP 3220 Star` is present.
5. (Optional) Run with `-SendTestPrint` to spit out an immediate diagnostic ticket:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\test-smartpos.ps1 -SendTestPrint
   ```

*If the test receipt prints, SmartPOS is 100% operational.*

---

## 📍 Step 3: Configure Cloudflare Worker Credentials

The agent must authenticate with your production Platoria Cloudflare Worker.

1. Ensure the secret `PRINT_AGENT_TOKEN` is configured on your production Cloudflare Worker.
   - If deploying via Cloudflare Dashboard: **Workers & Pages** -> your Platoria Worker -> **Settings** -> **Variables and Secrets** -> Add `PRINT_AGENT_TOKEN` (e.g. `shambhu_secret_agent_token_2026`).
   - Or via Wrangler:
     ```bash
     npx wrangler secret put PRINT_AGENT_TOKEN
     ```
2. Keep this token secret. You will paste it into the Windows `.env` file in the next step.

---

## 📍 Step 4: Installing & Configuring the Print Agent

### 4.1 Copy Folder & Install Runtime
1. Copy the `printer agent` folder to a permanent path on the Windows PC, for example:
   ```
   C:\Platoria\printer-agent\
   ```
2. If Node.js is not yet installed on the PC, run the **Node.js LTS installer** from your USB drive and restart PowerShell.
3. Verify Node.js is in PATH:
   ```powershell
   node -v
   npm -v
   ```

---

### 4.2 Configure the `.env` File
In `C:\Platoria\printer-agent`:
1. Copy `.env.example` to `.env`:
   ```powershell
   copy .env.example .env
   ```
2. Open `.env` in Notepad:
   ```powershell
   notepad .env
   ```
3. Set your production values:

```ini
# Production URL of your Platoria Cloudflare Worker
PLATORIA_API_URL=https://shambhu-cafe.yourdomain.com

# Device token matching PRINT_AGENT_TOKEN on Cloudflare
PRINT_AGENT_TOKEN=shambhu_secret_agent_token_2026

# Unique terminal identifier
PRINT_AGENT_ID=counter-pos-01

# SmartPOS loopback URL (default: 8003)
SMARTPOS_BASE_URL=http://127.0.0.1:8003

# Exact Windows printer name verified in Step 1
PRINTER_NAME=TVS RP 3220 Star

# Queue polling frequency in milliseconds (2000 = 2 seconds)
POLL_INTERVAL_MS=2000

# Network timeout
HTTP_TIMEOUT_MS=10000

# Retries
MAX_ATTEMPTS=3

# Logging
LOG_LEVEL=info
TIMEZONE=Asia/Kolkata
```
4. Save and close Notepad.

---

### 4.3 Build & Test Interactively
Compile the TypeScript code (if running from fresh source):
```powershell
cd C:\Platoria\printer-agent
npm install
npm run build
```

Now, launch the agent interactively in your terminal to verify live connectivity:
```powershell
npm start
```

You should see:
```
======================================================
  PLATORIA WINDOWS PRINT AGENT v1.0.0
======================================================
Platoria API:    https://shambhu-cafe.yourdomain.com
Agent ID:        counter-pos-01
SmartPOS Bridge: http://127.0.0.1:8003
Target Printer:  TVS RP 3220 Star
Poll Interval:   2000 ms
[INFO] Pre-flight check: SmartPOS Print Bridge is healthy on http://127.0.0.1:8003
[INFO] Printer "TVS RP 3220 Star" verified in Windows spooler.
[INFO] Starting sequential KOT polling loop...
```

*The agent is now actively listening for orders!*

---

## 📍 Step 5: Test Automatic KOT Printing (Live Verification)

Do not close the PowerShell window yet. Conduct a live test order:

1. Open your phone camera and scan any Table QR code (e.g. Table `T1`).
2. Add dishes to cart (e.g. 1 Masala Dosa, 2 Cold Coffee).
3. Add a note: `"Extra spicy, less ice"`.
4. Tap **Place Order**.
5. **Watch the Windows Terminal:**
   ```
   [INFO] Claimed job d4e2... for Order #1042 (Attempt 1)
   [INFO] Job d4e2... marked PRINTING on server
   [INFO] Formatting ESC/POS 80mm KOT (Table: T1, 3 units)...
   [INFO] Dispatching 284 bytes to SmartPOS bridge (TVS RP 3220 Star)...
   [INFO] SmartPOS spooler accepted job d4e2...
   [INFO] Acknowledged SUBMITTED to Platoria
   ```
6. **Look at the TVS Printer:**
   - The printer immediately outputs the KOT ticket.
   - Large bold header: `SHAMBHU CAFE`, `KOT - #1042`, `Table No: T1`.
   - Items cleanly aligned: `Masala Dosa  1`, `Cold Coffee  2`.
   - Special instructions box printed at bottom.
   - Partial cut executes automatically!
   - **No moderator or staff had to touch any computer or screen.**

Press `Ctrl + C` in the PowerShell window to stop interactive testing.

---

## 📍 Step 6: Configure Windows Task Scheduler (Permanent Autostart)

To ensure the agent stays running 24/7 and automatically starts when the restaurant PC boots or a cashier logs in:

1. Open PowerShell **as Administrator**.
2. Run the provided registration script:
   ```powershell
   cd C:\Platoria\printer-agent
   powershell -ExecutionPolicy Bypass -File .\scripts\install-task-scheduler.ps1
   ```
3. The script will:
   - Validate `node.exe` and `dist\index.js`.
   - Register a Windows Scheduled Task named **`PlatoriaPrintAgent`**.
   - Configure trigger: **At User Logon**.
   - Enable **automatic restart** every 1 minute if killed or crashed.
   - Start the task immediately.

### Useful Management Commands:
```powershell
# Check task status
Get-ScheduledTask -TaskName "PlatoriaPrintAgent"

# View real-time agent logs
Get-Content C:\Platoria\printer-agent\logs\agent-*.log -Tail 30 -Wait

# Stop the background agent
Stop-ScheduledTask -TaskName "PlatoriaPrintAgent"

# Restart the background agent
Start-ScheduledTask -TaskName "PlatoriaPrintAgent"

# Uninstall the scheduled task completely
powershell -ExecutionPolicy Bypass -File .\scripts\remove-task-scheduler.ps1
```

---

## 📍 Step 7: SmartPOS Autostart (Add to Windows Startup)

To ensure the SmartPOS Print Bridge also runs automatically when Windows turns on:

1. Press `Win + R` on the keyboard to open the Run box.
2. Type `shell:startup` and press Enter. This opens the Windows Startup folder:
   ```
   C:\Users\<Username>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
   ```
3. Right-click the **SmartPOS Print Bridge** desktop shortcut or executable -> select **Copy**.
4. In the Startup folder -> right-click empty space -> select **Paste shortcut**.
5. Now, whenever the PC boots up, SmartPOS Print Bridge launches silently into the system tray.

---

## 🚨 Troubleshooting Common On-Site Issues

| Issue / Error | Probable Cause | Fix / Resolution |
| :--- | :--- | :--- |
| **`401 Unauthorized` in logs** | `PRINT_AGENT_TOKEN` mismatch | Check `.env`. Ensure the token exactly matches `PRINT_AGENT_TOKEN` in Cloudflare Worker secrets. |
| **`SmartPOS Print Bridge is offline`** | Bridge app is not running | Launch SmartPOS from desktop or startup menu. Verify its icon is visible in the system tray. |
| **`Bridge running on port 8005 instead of 8003`** | Port 8003 was occupied | Run `.\scripts\test-smartpos.ps1`. The script scans 8000–8010. If found on 8005, update `SMARTPOS_BASE_URL=http://127.0.0.1:8005` in `.env`. |
| **`PRINTER_NOT_FOUND`** | Printer name mismatch | In Windows, open *Printers & Scanners*. Copy the exact name (e.g., `TVS RP 3220 Star`) and paste into `PRINTER_NAME=` in `.env`. |
| **TVS Printer beeps with red light** | Paper roll out or lid unlatched | Open printer lid, verify paper roll feeds from bottom, close lid firmly until both sides click. Red light will turn solid blue. |
| **KOT prints text but doesn't cut** | Cutter disabled in driver | Open Printer Properties -> *Device Settings* -> Set *Paper Cut* to **Doc / Page End Cut**. |
| **`Another instance is already running (.agent.lock)`** | Task Scheduler + Terminal running simultaneously | Stop the interactive terminal or stop the task: `Stop-ScheduledTask -TaskName "PlatoriaPrintAgent"`. Delete `.agent.lock` if process was killed. |

---

## 📋 Handover Checklist for the Restaurant Owner

Before leaving the restaurant, verify:
- [ ] TVS printer power switch is ON, paper loaded, solid blue light.
- [ ] Windows test page printed successfully.
- [ ] SmartPOS Print Bridge running in Windows system tray.
- [ ] SmartPOS shortcut placed in `shell:startup`.
- [ ] Platoria Print Agent registered in Windows Task Scheduler (`Get-ScheduledTask`).
- [ ] Customer QR test order placed from phone -> KOT printed & cut within 2–3 seconds without cashier touching the POS.
- [ ] Cashier shown how to check paper roll replacement.
