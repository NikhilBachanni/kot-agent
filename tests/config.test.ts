import assert from 'assert';
import { loadConfig, maskSecret, parsePortRange } from '../src/config';

console.log('--- Testing Config Module ---');

// 1. Valid config
{
  const valid = loadConfig({
    PLATORIA_API_URL: 'https://cafe.example.com',
    PRINT_AGENT_TOKEN: 'secret_token_12345678',
    PRINTER_NAME: 'TVS RP 3220 Star',
    POLL_INTERVAL_MS: '2000',
    SMARTPOS_PORT_RANGE: '8000-8005,8080'
  });

  assert.strictEqual(valid.platoriaApiUrl, 'https://cafe.example.com');
  assert.strictEqual(valid.printAgentToken, 'secret_token_12345678');
  assert.strictEqual(valid.printerName, 'TVS RP 3220 Star');
  assert.strictEqual(valid.pollIntervalMs, 2000);
  assert.strictEqual(valid.maxEmptyPollIntervalMs, 6000);
  assert.strictEqual(valid.emptyPollStepMs, 1000);
  assert.deepStrictEqual(valid.smartposPorts, [8000, 8001, 8002, 8003, 8004, 8005, 8080]);
  console.log('  ✓ Valid configuration parsed correctly');
}

// 2. Missing API URL
{
  assert.throws(
    () => {
      loadConfig({
        PLATORIA_API_URL: '',
        PRINT_AGENT_TOKEN: 'secret_token_12345678'
      });
    },
    /PLATORIA_API_URL is required/,
    'Should throw error on missing PLATORIA_API_URL'
  );
  console.log('  ✓ Missing PLATORIA_API_URL rejected');
}

// 3. Missing API Token
{
  assert.throws(
    () => {
      loadConfig({
        PLATORIA_API_URL: 'https://cafe.example.com',
        PRINT_AGENT_TOKEN: ''
      });
    },
    /PRINT_AGENT_TOKEN is required/,
    'Should throw error on missing PRINT_AGENT_TOKEN'
  );
  console.log('  ✓ Missing PRINT_AGENT_TOKEN rejected');
}

// 4. Placeholder token rejected
{
  assert.throws(
    () => {
      loadConfig({
        PLATORIA_API_URL: 'https://cafe.example.com',
        PRINT_AGENT_TOKEN: 'REPLACE_WITH_DEVICE_TOKEN'
      });
    },
    /PRINT_AGENT_TOKEN still has the placeholder value/,
    'Should throw error on placeholder token'
  );
  console.log('  ✓ Placeholder token rejected');
}

// 5. Secret masking
{
  assert.strictEqual(maskSecret('secret_12345678'), 'secr...5678');
  assert.strictEqual(maskSecret('short'), '****');
  assert.strictEqual(maskSecret(''), '[EMPTY]');
  console.log('  ✓ Secret masking works safely');
}

// 6. Port range parser
{
  const ports = parsePortRange('8003, 8005-8007');
  assert.deepStrictEqual(ports, [8003, 8005, 8006, 8007]);
  console.log('  ✓ Port range parsing handles comma and dash formats');
}
