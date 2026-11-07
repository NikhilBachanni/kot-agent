import assert from 'assert';
import { JobProcessor } from '../src/job-processor';
import { CloudflareClient } from '../src/cloudflare-client';
import { SmartPosClient } from '../src/smartpos-client';
import { Logger } from '../src/logger';
import { AgentConfig } from '../src/config';

export async function runJobProcessorTests() {
  console.log('--- Testing Job Processor Module ---');

  const mockConfig: AgentConfig = {
    platoriaApiUrl: 'https://cafe.example.com',
    printAgentToken: 'test_token',
    printAgentId: 'agent-01',
    smartposBaseUrl: 'http://127.0.0.1:8003',
    smartposAutoPortDiscovery: false,
    smartposPorts: [8003],
    printerName: 'TVS RP 3220 Star',
    pollIntervalMs: 100,
    httpTimeoutMs: 1000,
    maxAttempts: 3,
    logLevel: 'error',
    logDir: 'logs',
    timezone: 'Asia/Kolkata'
  };

  const logger = new Logger('error', 'logs');

  try {
    // 1. Happy path: Claim -> Validate -> Report Printing -> Submit -> Ack SUBMITTED
    {
      const events: string[] = [];

      const mockCloudflare = {
        claimJob: async () => {
          events.push('claim');
          return {
            ok: true,
            job: {
              id: 'job-101',
              orderId: 'order-101',
              orderNumber: 101,
              jobType: 'KOT',
              source: 'QR',
              status: 'CLAIMED',
              attempts: 1,
              leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
              payload: {
                schemaVersion: '1.0',
                jobId: 'job-101',
                orderId: 'order-101',
                orderNumber: 101,
                source: 'QR',
                table: 'T2',
                customerName: 'Aman',
                customerPhone: '',
                createdAt: new Date().toISOString(),
                createdAtLocal: '03/11/2026, 02:00 PM',
                items: [{ name: 'Masala Tea', qty: 2 }]
              }
            }
          };
        },
        reportPrinting: async (jobId: string) => {
          events.push(`printing:${jobId}`);
          return { ok: true, jobId, status: 'PRINTING' };
        },
        acknowledgeJob: async (jobId: string, _agentId: string, status: string) => {
          events.push(`ack:${jobId}:${status}`);
          return { ok: true, jobId, status };
        },
        sendHeartbeat: async () => ({ ok: true }),
        checkHealth: async () => ({ ok: true })
      } as unknown as CloudflareClient;

      const mockSmartpos = {
        discoverBridge: async () => ({ ok: true, url: 'http://127.0.0.1:8003', printers: ['TVS RP 3220 Star'] }),
        verifyPrinter: async () => ({ available: true, installedPrinters: ['TVS RP 3220 Star'] }),
        printEscpos: async () => {
          events.push('smartpos_print');
          return { ok: true, message: 'Spooler accepted' };
        }
      } as unknown as SmartPosClient;

      const processor = new JobProcessor({
        config: mockConfig,
        cloudflare: mockCloudflare,
        smartpos: mockSmartpos,
        logger
      });

      await processor.pollAndProcess();

      assert.deepStrictEqual(events, [
        'claim',
        'printing:job-101',
        'smartpos_print',
        'ack:job-101:SUBMITTED'
      ]);
      console.log('  ✓ Happy path executed: Claim -> Printing -> SmartPOS Print -> Ack SUBMITTED');
    }

    // 2. Ambiguous timeout path: Reports NEEDS_REVIEW (never duplicate!)
    {
      const events: string[] = [];

      const mockCloudflare = {
        claimJob: async () => ({
          ok: true,
          job: {
            id: 'job-102',
            orderId: 'order-102',
            orderNumber: 102,
            jobType: 'KOT',
            source: 'POS',
            status: 'CLAIMED',
            attempts: 1,
            leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
            payload: {
              schemaVersion: '1.0',
              jobId: 'job-102',
              orderId: 'order-102',
              orderNumber: 102,
              source: 'POS',
              table: 'Pickup',
              customerName: 'Guest',
              customerPhone: '',
              createdAt: new Date().toISOString(),
              createdAtLocal: '03/11/2026, 02:00 PM',
              items: [{ name: 'Cold Coffee', qty: 1 }]
            }
          }
        }),
        reportPrinting: async (jobId: string) => {
          events.push(`printing:${jobId}`);
          return { ok: true, jobId, status: 'PRINTING' };
        },
        acknowledgeJob: async (jobId: string, _agentId: string, status: string) => {
          events.push(`ack:${jobId}:${status}`);
          return { ok: true, jobId, status };
        }
      } as unknown as CloudflareClient;

      const mockSmartpos = {
        discoverBridge: async () => ({ ok: true, url: 'http://127.0.0.1:8003', printers: [] }),
        printEscpos: async () => {
          events.push('smartpos_timeout');
          return { ok: false, isAmbiguous: true, error: 'Socket timeout after dispatch' };
        }
      } as unknown as SmartPosClient;

      const processor = new JobProcessor({
        config: mockConfig,
        cloudflare: mockCloudflare,
        smartpos: mockSmartpos,
        logger
      });

      await processor.pollAndProcess();

      assert.deepStrictEqual(events, [
        'printing:job-102',
        'smartpos_timeout',
        'ack:job-102:NEEDS_REVIEW'
      ]);
      console.log('  ✓ Ambiguous transmission transitions to NEEDS_REVIEW (duplicate print prevented)');
    }

    // 3. SmartPOS offline: Pauses polling without claiming jobs
    {
      let claimCalled = false;

      const mockCloudflare = {
        claimJob: async () => {
          claimCalled = true;
          return { ok: true, job: null };
        }
      } as unknown as CloudflareClient;

      const mockSmartpos = {
        discoverBridge: async () => ({ ok: false, url: 'http://127.0.0.1:8003', printers: [], error: 'Offline' })
      } as unknown as SmartPosClient;

      const processor = new JobProcessor({
        config: mockConfig,
        cloudflare: mockCloudflare,
        smartpos: mockSmartpos,
        logger
      });

      await processor.pollAndProcess();

      assert.strictEqual(claimCalled, false, 'Should not claim jobs when printer bridge is offline');
      console.log('  ✓ Pre-flight check halts claiming when local printer bridge is down');
    }
  } finally {
    logger.close();
  }
}
