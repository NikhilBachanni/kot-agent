import assert from 'assert';
import { CloudflareClient } from '../src/cloudflare-client';
import { Logger } from '../src/logger';

export async function runCloudflareTests() {
  console.log('--- Testing Cloudflare Client Module ---');

  const logger = new Logger('error', 'logs');
  const originalFetch = global.fetch;

  try {
    // 1. Bearer token sent in header and Claim job succeeds
    {
      let capturedHeaders: HeadersInit | undefined;
      let capturedUrl: string | undefined;

      global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        capturedUrl = String(input);
        capturedHeaders = init?.headers;

        const mockJob = {
          id: 'job-123',
          orderId: 'order-abc',
          orderNumber: 101,
          jobType: 'KOT',
          source: 'QR',
          status: 'CLAIMED',
          attempts: 1,
          leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          payload: {
            schemaVersion: '1.0',
            jobId: 'job-123',
            orderId: 'order-abc',
            orderNumber: 101,
            source: 'QR',
            table: 'T1',
            customerName: 'Guest',
            customerPhone: '',
            createdAt: new Date().toISOString(),
            createdAtLocal: '03/11/2026, 01:00 PM',
            items: [{ name: 'Chai', qty: 2 }]
          }
        };

        return new Response(JSON.stringify({ ok: true, job: mockJob }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const client = new CloudflareClient({
        baseUrl: 'https://cafe.example.com',
        token: 'test_token_xyz',
        timeoutMs: 5000,
        logger
      });

      const res = await client.claimJob('test-agent-1');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.job?.id, 'job-123');
      assert.strictEqual(capturedUrl, 'https://cafe.example.com/api/print-agent/claim');
      assert.strictEqual((capturedHeaders as Record<string, string>)['Authorization'], 'Bearer test_token_xyz');
      console.log('  ✓ Claim request sends Bearer token and parses job response');
    }

    // 2. Empty queue response
    {
      global.fetch = async (): Promise<Response> => {
        return new Response(JSON.stringify({ ok: true, job: null, message: 'Queue is empty' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const client = new CloudflareClient({
        baseUrl: 'https://cafe.example.com',
        token: 'test_token_xyz',
        timeoutMs: 5000,
        logger
      });

      const res = await client.claimJob('test-agent-1');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.job, null);
      console.log('  ✓ Empty queue returns null job safely');
    }

    // 3. HTTP 401 Unauthorized
    {
      global.fetch = async (): Promise<Response> => {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized: Invalid token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const client = new CloudflareClient({
        baseUrl: 'https://cafe.example.com',
        token: 'wrong_token',
        timeoutMs: 5000,
        logger
      });

      await assert.rejects(
        async () => {
          await client.claimJob('test-agent-1');
        },
        /Authentication failed \(HTTP 401\)/,
        'Should throw descriptive Auth error'
      );
      console.log('  ✓ HTTP 401 throws actionable authentication error');
    }

    // 4. Report Printing
    {
      let capturedBody: any;
      global.fetch = async (_url, init): Promise<Response> => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, jobId: 'job-123', status: 'PRINTING' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const client = new CloudflareClient({
        baseUrl: 'https://cafe.example.com',
        token: 'test_token_xyz',
        timeoutMs: 5000,
        logger
      });

      const res = await client.reportPrinting('job-123', 'test-agent-1');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(capturedBody.jobId, 'job-123');
      assert.strictEqual(capturedBody.agentId, 'test-agent-1');
      console.log('  ✓ Report printing sends correct jobId and agentId');
    }

    // 5. Acknowledge SUBMITTED
    {
      let capturedBody: any;
      global.fetch = async (_url, init): Promise<Response> => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, jobId: 'job-123', status: 'SUBMITTED' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const client = new CloudflareClient({
        baseUrl: 'https://cafe.example.com',
        token: 'test_token_xyz',
        timeoutMs: 5000,
        logger
      });

      const res = await client.acknowledgeJob('job-123', 'test-agent-1', 'SUBMITTED');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(capturedBody.status, 'SUBMITTED');
      console.log('  ✓ Acknowledge SUBMITTED sent correctly');
    }

    // 6. Network Timeout
    {
      global.fetch = async (): Promise<Response> => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const error: any = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      };

      const client = new CloudflareClient({
        baseUrl: 'https://cafe.example.com',
        token: 'test_token_xyz',
        timeoutMs: 10,
        logger
      });

      await assert.rejects(
        async () => {
          await client.claimJob('test-agent-1');
        },
        /timed out after 10ms/,
        'Should throw timeout error'
      );
      console.log('  ✓ AbortController timeout handled with clear error');
    }

    // 7. Dynamic dedicated_worker routing, config caching, no silent fallback, and 409 refresh
    {
      const calls: Array<{ url: string; method: string }> = [];
      let currentMode: 'dedicated_worker' | 'in_app' = 'dedicated_worker';
      let workerFail = false;

      global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        const method = init?.method || 'POST';
        calls.push({ url, method });

        if (url === 'https://cafe.example.com/api/print-agent/config') {
          return new Response(
            JSON.stringify({
              ok: true,
              mode: currentMode,
              dedicatedWorkerUrl: 'https://platoria-print-agent.workers.dev',
              routes: {
                claimBaseUrl: currentMode === 'dedicated_worker' ? 'https://platoria-print-agent.workers.dev' : null,
                heartbeatBaseUrl: currentMode === 'dedicated_worker' ? 'https://platoria-print-agent.workers.dev' : null
              },
              pollConfigSeconds: 30
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url === 'https://platoria-print-agent.workers.dev/api/print-agent/claim') {
          if (workerFail) {
            throw new Error('Dedicated worker unreachable');
          }
          if (currentMode !== 'dedicated_worker') {
            return new Response(
              JSON.stringify({ ok: false, error: 'Standby', activeMode: currentMode, job: null }),
              { status: 409, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({ ok: true, job: null, message: 'Queue is empty' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url === 'https://platoria-print-agent.workers.dev/api/print-agent/heartbeat') {
          return new Response(
            JSON.stringify({ ok: true, agentId: 'test-agent-1', activeMode: currentMode }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url === 'https://cafe.example.com/api/print-agent/claim') {
          return new Response(
            JSON.stringify({ ok: true, job: null, message: 'Queue is empty' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const client = new CloudflareClient({
        baseUrl: 'https://cafe.example.com',
        token: 'test_token_xyz',
        timeoutMs: 5000,
        configRefreshIntervalMs: 30000,
        logger
      });

      // Rapid consecutive polls should cache /config and only hit dedicated worker for claim + heartbeat
      await client.claimJob('test-agent-1');
      await client.claimJob('test-agent-1');
      await client.sendHeartbeat('test-agent-1', 'ONLINE_READY');
      await client.reportPrinting('job-1', 'test-agent-1');
      await client.acknowledgeJob('job-1', 'test-agent-1', 'SUBMITTED');

      const configCalls = calls.filter((c) => c.url.endsWith('/api/print-agent/config'));
      assert.strictEqual(configCalls.length, 1, 'Config must be cached across rapid polling cycles');
      assert.strictEqual(
        calls.filter((c) => c.url === 'https://platoria-print-agent.workers.dev/api/print-agent/claim').length,
        2
      );
      assert.strictEqual(
        calls.filter((c) => c.url === 'https://platoria-print-agent.workers.dev/api/print-agent/heartbeat').length,
        1
      );
      assert.strictEqual(
        calls.filter((c) => c.url === 'https://cafe.example.com/api/print-agent/printing').length,
        1
      );
      assert.strictEqual(
        calls.filter((c) => c.url === 'https://cafe.example.com/api/print-agent/ack').length,
        1
      );

      // Dedicated worker failure must NOT silently fall back to main app
      workerFail = true;
      await assert.rejects(
        async () => client.claimJob('test-agent-1'),
        /Dedicated worker unreachable/
      );
      assert.strictEqual(
        calls.filter((c) => c.url === 'https://cafe.example.com/api/print-agent/claim').length,
        0,
        'Must NEVER silently fall back to main app claim on worker error'
      );

      // Admin rolls back mode -> 409 triggers forced config refresh and routes next claim to in_app
      workerFail = false;
      currentMode = 'in_app';
      const conflictRes = await client.claimJob('test-agent-1');
      assert.strictEqual(conflictRes.ok, false);
      assert.strictEqual(client.getTransportState().mode, 'in_app');

      await client.claimJob('test-agent-1');
      assert.strictEqual(
        calls.filter((c) => c.url === 'https://cafe.example.com/api/print-agent/claim').length,
        1
      );
      console.log('  ✓ Dedicated worker routing, config caching, no-silent-fallback, and 409 refresh verified');
    }
  } finally {
    global.fetch = originalFetch;
    logger.close();
  }
}
