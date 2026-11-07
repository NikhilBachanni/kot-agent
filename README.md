# Platoria Windows Print Agent

A robust, enterprise-grade local Windows print agent for **Platoria**, engineered for automatic Kitchen Order Ticket (KOT) printing on the **TVS RP 3220 Star (80mm thermal paper)** via the local **SmartPOS Print Bridge**.

---

## 🏗️ Architecture & Flow

The agent runs as a dedicated background process on the restaurant's Windows PC. It requires **no inbound public ports**, **no local web server**, and **no third-party cloud relays**.

```
   ┌─────────────────────────────────────────────────────────────┐
   │                     Windows Restaurant PC                   │
   │                                                             │
   │  ┌──────────────────────┐    Outbound HTTPS (Polling)       │
   │  │                      │ ──────────────────────────────►   │
   │  │ Platoria Print Agent │   Platoria Cloudflare Worker API   │
   │  │                      │ ◄──────────────────────────────   │
   │  └──────────┬───────────┘    Bearer Token Authenticated     │
   │             │                                               │
   │             │ Local Loopback HTTP (127.0.0.1:8003)          │
   │             ▼ Base64 ESC/POS Bytes                          │
   │  ┌──────────────────────┐                                   │
   │  │ SmartPOS Print Bridge│                                   │
   │  └──────────┬───────────┘                                   │
   │             │ Windows Print Spooler                         │
   │             ▼                                               │
   │  ┌──────────────────────┐                                   │
   │  │  TVS RP 3220 Star    │ (USB Thermal 80mm KOT Printer)    │
   │  └──────────────────────┘                                   │
   └─────────────────────────────────────────────────────────────┘
```

### Lifecycle of a KOT Job:
1. **Pre-flight Check:** Agent confirms SmartPOS loopback bridge is online on `127.0.0.1:8003` (or auto-discovers listening port 8000–8010) and verifies `TVS RP 3220 Star` is present in Windows spooler.
2. **Claim (`POST /api/print-agent/claim`):** Claims one pending KOT job with a server lease.
3. **Payload Validation:** Enforces strict JSON schema validation (`schemaVersion: "1.0"`).
4. **Mark Printing (`POST /api/print-agent/jobs/:id/printing`):** Alerts server that printing is underway to extend lease and prevent duplicate claiming.
5. **ESC/POS Generation:** Formats ticket for 48 columns (80mm thermal paper, Font A):
   - Prominent Order # & Table identifier.
   - Clean tabular alignment: `QTY` and `ITEM`.
   - Modifiers & notes indented beneath items.
   - Customer instructions separated.
   - Zero prices, zero payment info, zero customer secrets.
   - Unicode & Rupee symbol sanitization to protect printer firmware from garbled text.
   - Partial paper cut command (`GS V 1`).
6. **Dispatch to SmartPOS Bridge (`POST /print`):** Delivers Base64 ESC/POS byte payload over loopback.
7. **Acknowledge Outcome (`POST /api/print-agent/jobs/:id/ack`):**
   - `SUBMITTED`: Bridge spooler confirmed acceptance.
   - `FAILED`: Bridge returned a hard rejection.
   - `NEEDS_REVIEW`: Timeout or ambiguous network drop after dispatch; avoids duplicate physical printing.

---

## 📁 Project Structure

```
printer agent/
├── .env.example                  # Environment configuration template
├── .gitignore                    # Git ignore rules (logs, dist, node_modules, .env)
├── package.json                  # Isolated Node.js package with zero heavy runtime deps
├── tsconfig.json                 # Strict TypeScript configuration
├── README.md                     # High-level architecture and developer guide
├── docs/
│   ├── WINDOWS_SETUP.md          # Step-by-step setup guide for the restaurant PC
│   └── TROUBLESHOOTING.md       # Diagnostic guide for common hardware/network issues
├── scripts/
│   ├── test-smartpos.ps1         # PowerShell diagnostic tool for bridge and printer
│   ├── install-task-scheduler.ps1# Registers agent as an auto-restarting Windows Task
│   └── remove-task-scheduler.ps1 # Safely unregisters the Windows Task
├── src/
│   ├── index.ts                  # Application entry point & single-instance lock
│   ├── config.ts                 # Validated environment configuration
│   ├── logger.ts                 # Rotating structured logger with PII & secret redactor
│   ├── retry-policy.ts           # Exponential backoff with jitter & Retry-After support
│   ├── payload-validator.ts      # Strict runtime schema validation
│   ├── escpos.ts                 # Binary ESC/POS builder (48-column word wrapping & cut)
│   ├── kot-formatter.ts          # Restaurant KOT layout generator (calibrated for TVS)
│   ├── cloudflare-client.ts      # Typed Platoria Cloudflare Worker API client
│   ├── smartpos-client.ts        # SmartPOS loopback HTTP client with port discovery
│   └── job-processor.ts          # Core sequential polling and processing state machine
└── tests/
    ├── config.test.ts
    ├── payload-validator.test.ts
    ├── escpos.test.ts
    ├── kot-formatter.test.ts
    ├── logger.test.ts
    ├── cloudflare-client.test.ts
    ├── smartpos-client.test.ts
    ├── job-processor.test.ts
    ├── e2e-simulation.test.ts     # Simulated end-to-end test with mocked Cloudflare + SmartPOS
    └── run-all.ts                # Unified test runner
```

---

## 🚀 Quick Start (Development & Production)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Tests
The agent includes a comprehensive test suite covering schema validation, ESC/POS wrapping, retry policies, secret masking, and simulated end-to-end execution:
```bash
npm test
```

### 3. Build Production Bundle
Compiles TypeScript into `dist/`:
```bash
npm run build
```

### 4. Configuration
Copy `.env.example` to `.env` and fill in your restaurant details:
```ini
PLATORIA_API_URL=https://shambhu-cafe.yourdomain.com
PRINT_AGENT_TOKEN=pla_sec_xxxxxxxxxxxxxxxxxxxx
PRINT_AGENT_ID=restaurant-kitchen-01
SMARTPOS_BASE_URL=http://127.0.0.1:8003
PRINTER_NAME=TVS RP 3220 Star
POLL_INTERVAL_MS=2000
HTTP_TIMEOUT_MS=10000
MAX_ATTEMPTS=3
LOG_LEVEL=info
TIMEZONE=Asia/Kolkata
```

### 5. Start the Agent
```bash
# In development (with live tsx execution)
npm run dev

# In production (runs compiled dist/index.js)
npm start
```

---

## 🔒 Safety & Resilience Features

- **Single Instance Lock:** Uses a `.agent.lock` file containing process PID and heartbeat to guarantee two processes cannot run simultaneously on the same machine.
- **Offline Protection:** If the SmartPOS Print Bridge is offline or USB is disconnected, the agent halts claiming jobs from Platoria and logs warnings with exponential backoff.
- **Ambiguous Timeout Safety:** If a network timeout occurs while waiting for SmartPOS spool confirmation, the agent marks the job `NEEDS_REVIEW` instead of retrying, preventing duplicate tickets in the kitchen.
- **Secret & PII Redaction:** Device tokens, Authorization headers, and customer phone numbers are sanitized before writing to logs.
- **Graceful Shutdown:** Intercepts `SIGINT` / `SIGTERM` to finish processing any in-flight job before releasing locks and exiting.

---

## 📜 Windows Task Scheduler Integration

To keep the agent running persistently without an open browser or terminal:
```powershell
# Install background task
powershell -ExecutionPolicy Bypass -File .\scripts\install-task-scheduler.ps1

# Check status
Get-ScheduledTask -TaskName "PlatoriaPrintAgent"

# Remove task
powershell -ExecutionPolicy Bypass -File .\scripts\remove-task-scheduler.ps1
```

See [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) and [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for full operational guides.
