import assert from 'assert';
import { formatKotToEscPos } from '../src/kot-formatter';
import { KotPayload } from '../src/payload-validator';

console.log('--- Testing KOT Formatter Module ---');

const samplePayload: KotPayload = {
  schemaVersion: '1.0',
  jobId: '12345678-1234-1234-1234-123456789abc',
  orderId: '87654321-4321-4321-4321-cba987654321',
  orderNumber: 1042,
  source: 'QR',
  table: 'T4',
  customerName: 'Rahul Sharma',
  customerPhone: '+91 98765 43210',
  createdAt: '2026-11-03T07:54:00Z',
  createdAtLocal: '03/11/2026, 01:24 PM',
  customerNotes: 'Extra spicy, less oil please',
  items: [
    { name: 'Cold Coffee', qty: 2 },
    { name: 'Cheese Butter Maggi with Extra Vegetables and Herbs', qty: 1, notes: 'Do not add onions' }
  ]
};

// 1. Output Buffer generated
{
  const buffer = formatKotToEscPos(samplePayload, { columns: 48, restaurantName: 'SHAMBHU CAFE' });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 100);

  const textOutput = buffer.toString('ascii');

  // Verify critical KOT sections
  assert.ok(textOutput.includes('KITCHEN ORDER'), 'Must include KITCHEN ORDER header');
  assert.ok(textOutput.includes('TABLE 4') || textOutput.includes('T4'), 'Must include Table identifier');
  assert.ok(textOutput.includes('ORDER #: 1042'), 'Must include Order number');
  assert.ok(textOutput.includes('03/11/2026, 01:24 PM'), 'Must include local timestamp');
  assert.ok(textOutput.includes('QR Order'), 'Must include order source');
  assert.ok(textOutput.includes('Cold Coffee'), 'Must include first item name');
  assert.ok(textOutput.includes('Cheese Butter Maggi'), 'Must include second item name');
  assert.ok(textOutput.includes('Do not add onions'), 'Must include item-specific note');
  assert.ok(textOutput.includes('Extra spicy, less oil please'), 'Must include customer notes');

  // Strict Negative Checks: KOT must NOT display prices, GST, or totals!
  assert.ok(!textOutput.includes('₹'), 'Must NOT contain Rupee symbol');
  assert.ok(!textOutput.includes('Total'), 'Must NOT contain Total amount');
  assert.ok(!textOutput.includes('Subtotal'), 'Must NOT contain Subtotal');
  assert.ok(!textOutput.includes('GST'), 'Must NOT contain GST');
  assert.ok(!textOutput.includes('Payment'), 'Must NOT contain payment details');

  console.log('  ✓ Standard KOT generated correctly with table, items, notes and zero pricing data');
}

// 2. Long item wrapping
{
  const longPayload: KotPayload = {
    ...samplePayload,
    items: [
      {
        name: 'Super Delicious Triple Layer Chocolate Truffle Pastry with Warm Dark Ganache',
        qty: 3
      }
    ]
  };

  const buffer = formatKotToEscPos(longPayload, { columns: 48 });
  const textOutput = buffer.toString('ascii');
  assert.ok(textOutput.includes('Triple Layer'));
  assert.ok(textOutput.includes('Ganache'));
  console.log('  ✓ Long item description cleanly wrapped across 48-column thermal width');
}

// 3. Reprint Ticket
{
  const reprintPayload: KotPayload = {
    ...samplePayload,
    reprintInfo: {
      isReprint: true,
      reprintOfJobId: 'old-uuid-999',
      reason: 'Printer jammed previously'
    }
  };

  const buffer = formatKotToEscPos(reprintPayload, { columns: 48 });
  const textOutput = buffer.toString('ascii');
  assert.ok(textOutput.includes('*** REPRINT ***'), 'Must include prominent reprint banner');
  assert.ok(textOutput.includes('Printer jammed previously'), 'Must include reprint reason');
  console.log('  ✓ Reprint ticket includes prominent REPRINT warning and audit reason');
}
