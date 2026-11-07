import assert from 'assert';
import { Logger } from '../src/logger';

console.log('--- Testing Logger Module ---');

const SECRET_TOKEN = 'super_secret_device_token_999';
const logger = new Logger('debug', 'logs', SECRET_TOKEN);

// 1. Redact device token
{
  const sanitized = logger.sanitize(`Connected using token ${SECRET_TOKEN} successfully`);
  assert.strictEqual(sanitized, 'Connected using token [REDACTED_DEVICE_TOKEN] successfully');
  assert.ok(!sanitized.includes(SECRET_TOKEN));
  console.log('  ✓ Dedicated device token completely redacted');
}

// 2. Redact Authorization Bearer header
{
  const sanitized = logger.sanitize('Sending request with Authorization: Bearer abc123def456');
  assert.strictEqual(sanitized, 'Sending request with Authorization: Bearer [REDACTED_TOKEN]');
  console.log('  ✓ Bearer authorization header completely redacted');
}

// 3. Redact Indian mobile phone numbers
{
  const sanitized = logger.sanitize('Order placed for customer with phone +91 98765 43210');
  assert.strictEqual(sanitized, 'Order placed for customer with phone +91 ***** 43210');
  console.log('  ✓ Customer phone numbers masked to protect personal information');
}

logger.close();
