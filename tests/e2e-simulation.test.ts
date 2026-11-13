import http from 'http';
import assert from 'assert';
import { CloudflareClient } from '../src/cloudflare-client';
import { SmartPosClient } from '../src/smartpos-client';
import { JobProcessor } from '../src/job-processor';
import { Logger } from '../src/logger';
import { AgentConfig } from '../src/config';

console.log('--- Testing End-to-End Simulation (Mocked Platoria & SmartPOS) ---');

const logger = new Logger('error', 'logs');

// 1. Setup Mock SmartPOS Bridge Server on localhost:8991
let smartposReceivedPrint = false;
let smartposReceivedBase64 = '';

const smartposServer = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/printers' || req.url === '/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(['TVS RP 3220 Star', 'Virtual PDF']));
    return;
  }

  if (req.method === 'POST' && req.url === '/print') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      smartposReceivedPrint = true;
      smartposReceivedBase64 = parsed.dataBase64;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Print job accepted by TVS RP 3220 Star' }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// 2. Setup Mock Platoria Cloudflare Worker on localhost:8992
let cloudflareClaimed = false;
let cloudflarePrintingReported = false;
let cloudflareAckSubmitted = false;

const cloudflareServer = http.createServer((req, res) => {
  // Check auth header
  const auth = req.headers['authorization'];
  if (auth !== 'Bearer test_e2e_token') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/print-agent/claim') {
    if (!cloudflareClaimed) {
      cloudflareClaimed = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          job: {
            id: 'e2e-job-999',
            orderId: 'e2e-order-888',
            orderNumber: 5555,
            jobType: 'KOT',
            source: 'QR',
            status: 'CLAIMED',
            attempts: 1,
            leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
            payload: {
              schemaVersion: '1.0',
              jobId: 'e2e-job-999',
              orderId: 'e2e-order-888',
              orderNumber: 5555,
              source: 'QR',
              table: 'T10',
              customerName: 'Kunal',
              customerPhone: '',
              createdAt: new Date().toISOString(),
              createdAtLocal: '03/11/2026, 02:30 PM',
              customerNotes: 'Make it extra crisp',
              items: [{ name: 'Butter Toast', qty: 2 }]
            }
          }
        })
      );
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, job: null, message: 'Queue is empty' }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/print-agent/printing') {
    cloudflarePrintingReported = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, jobId: 'e2e-job-999', status: 'PRINTING' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/print-agent/ack') {
    cloudflareAckSubmitted = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, jobId: 'e2e-job-999', status: 'SUBMITTED' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/print-agent/heartbeat') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end();
});

async function runE2e() {
  await new Promise<void>((resolve) => smartposServer.listen(8991, '127.0.0.1', () => resolve()));
  await new Promise<void>((resolve) => cloudflareServer.listen(8992, '127.0.0.1', () => resolve()));

  const config: AgentConfig = {
    platoriaApiUrl: 'http://127.0.0.1:8992',
    printAgentToken: 'test_e2e_token',
    printAgentId: 'e2e-agent',
    smartposBaseUrl: 'http://127.0.0.1:8991',
    smartposAutoPortDiscovery: false,
    smartposPorts: [8991],
    printerName: 'TVS RP 3220 Star',
    pollIntervalMs: 50,
    httpTimeoutMs: 2000,
    maxAttempts: 3,
    logLevel: 'error',
    logDir: 'logs',
    timezone: 'Asia/Kolkata'
  };

  const cloudflare = new CloudflareClient({
    baseUrl: config.platoriaApiUrl,
    token: config.printAgentToken,
    timeoutMs: config.httpTimeoutMs,
    logger
  });

  const smartpos = new SmartPosClient({
    baseUrl: config.smartposBaseUrl,
    autoPortDiscovery: false,
    timeoutMs: config.httpTimeoutMs,
    logger
  });

  const processor = new JobProcessor({
    config,
    cloudflare,
    smartpos,
    logger
  });

  // Execute one cycle
  await processor.pollAndProcess();

  // Verify assertions
  assert.strictEqual(cloudflareClaimed, true, 'Platoria claim endpoint must be called');
  assert.strictEqual(cloudflarePrintingReported, true, 'Platoria printing state must be reported');
  assert.strictEqual(smartposReceivedPrint, true, 'SmartPOS bridge must receive print request');
  assert.ok(smartposReceivedBase64.length > 50, 'SmartPOS must receive valid Base64 ESC/POS payload');
  assert.strictEqual(cloudflareAckSubmitted, true, 'Platoria SUBMITTED ack must be confirmed');

  // Verify decoded ESC/POS bytes contain KOT contents
  const decodedText = Buffer.from(smartposReceivedBase64, 'base64').toString('ascii');
  assert.ok(decodedText.includes('KOT - 5555') || decodedText.includes('5555'));
  assert.ok(!decodedText.includes('KITCHEN ORDER'));
  assert.ok(decodedText.includes('TABLE 10') || decodedText.includes('T10'));
  assert.ok(decodedText.includes('5555'));
  assert.ok(decodedText.includes('Butter Toast'));

  processor.stop();
  logger.close();

  await new Promise<void>((resolve) => smartposServer.close(() => resolve()));
  await new Promise<void>((resolve) => cloudflareServer.close(() => resolve()));

  console.log('  ✓ End-to-end simulated run passed: Claim -> Printing -> SmartPOS Print -> Ack SUBMITTED');
}

export { runE2e as runE2eTests };
