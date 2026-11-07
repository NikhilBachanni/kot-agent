import assert from 'assert';
import { SmartPosClient } from '../src/smartpos-client';
import { Logger } from '../src/logger';

export async function runSmartposTests() {
  console.log('--- Testing SmartPOS Client Module ---');

  const logger = new Logger('error', 'logs');
  const originalFetch = global.fetch;

  try {
    // 1. Bridge health check & port discovery on primary port
    {
      global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.includes('/printers')) {
          return new Response(JSON.stringify(['TVS RP 3220 Star', 'Microsoft Print to PDF']), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const client = new SmartPosClient({
        baseUrl: 'http://127.0.0.1:8003',
        timeoutMs: 3000,
        logger
      });

      const health = await client.discoverBridge();
      assert.strictEqual(health.ok, true);
      assert.strictEqual(health.printers.length, 2);
      assert.strictEqual(health.printers[0], 'TVS RP 3220 Star');
      console.log('  ✓ Bridge health check and printer enumeration on 8003 verified');
    }

    // 2. Candidate port discovery (when 8003 is down, but 8005 is running)
    {
      global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.includes(':8005/printers')) {
          return new Response(JSON.stringify({ printers: ['TVS RP 3220 Star'] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        throw new Error('Connection refused on 127.0.0.1');
      };

      const client = new SmartPosClient({
        baseUrl: 'http://127.0.0.1:8003',
        autoPortDiscovery: true,
        candidatePorts: [8003, 8004, 8005],
        timeoutMs: 3000,
        logger
      });

      const health = await client.discoverBridge();
      assert.strictEqual(health.ok, true);
      assert.strictEqual(client.getActiveBaseUrl(), 'http://127.0.0.1:8005');
      assert.strictEqual(health.printers[0], 'TVS RP 3220 Star');
      console.log('  ✓ Candidate port discovery scans and discovers bridge on port 8005');
    }

    // 3. Printer verification: found vs missing
    {
      global.fetch = async (): Promise<Response> => {
        return new Response(JSON.stringify(['TVS RP 3220 Star', 'Canon LBP2900']), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const client = new SmartPosClient({
        baseUrl: 'http://127.0.0.1:8003',
        logger
      });

      const match = await client.verifyPrinter('TVS RP 3220 Star');
      assert.strictEqual(match.available, true);

      const missing = await client.verifyPrinter('Epson TM-T88');
      assert.strictEqual(missing.available, false);
      console.log('  ✓ Printer verification accurately detects installed vs missing printers');
    }

    // 4. Successful print submission
    {
      let capturedBody: any;
      global.fetch = async (input, init): Promise<Response> => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ success: true, message: 'Spooler queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const client = new SmartPosClient({
        baseUrl: 'http://127.0.0.1:8003',
        logger
      });

      const sampleBytes = Buffer.from([0x1b, 0x40, 0x41, 0x42, 0x43]);
      const result = await client.printEscpos('TVS RP 3220 Star', sampleBytes);

      assert.strictEqual(result.ok, true);
      assert.strictEqual(capturedBody.printer, 'TVS RP 3220 Star');
      assert.strictEqual(capturedBody.dataBase64, sampleBytes.toString('base64'));
      assert.strictEqual(capturedBody.data, sampleBytes.toString('base64'));
      assert.strictEqual(capturedBody.type, 'raw');
      console.log('  ✓ Print request sends Base64 ESC/POS payload and accepts spooler confirmation');
    }

    // 5. Bridge rejects print request (definite failure)
    {
      global.fetch = async (): Promise<Response> => {
        return new Response(JSON.stringify({ success: false, error: 'Printer TVS RP 3220 Star is offline' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const client = new SmartPosClient({
        baseUrl: 'http://127.0.0.1:8003',
        logger
      });

      const result = await client.printEscpos('TVS RP 3220 Star', Buffer.from('test'));
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.isAmbiguous, false);
      assert.match(result.error || '', /offline/);
      console.log('  ✓ Bridge rejection marked as definite failure (not ambiguous)');
    }

    // 6. Ambiguous timeout after dispatch
    {
      global.fetch = async (): Promise<Response> => {
        const error: any = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      };

      const client = new SmartPosClient({
        baseUrl: 'http://127.0.0.1:8003',
        timeoutMs: 10,
        logger
      });

      const result = await client.printEscpos('TVS RP 3220 Star', Buffer.from('test'));
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.isAmbiguous, true);
      assert.match(result.error || '', /Physical print outcome is uncertain/);
      console.log('  ✓ Network timeout after submission correctly flagged as ambiguous (NEEDS_REVIEW)');
    }
  } finally {
    global.fetch = originalFetch;
    logger.close();
  }
}
