import assert from 'assert';
import { validateClaimedJobPayload } from '../src/payload-validator';

console.log('--- Testing Payload Validator Module ---');

// 1. Valid payload
{
  const valid = validateClaimedJobPayload({
    schemaVersion: '1.0',
    jobId: 'e43b1234-5678-4321-9abc-def012345678',
    orderId: '6c2e3914-9999-4d62-a500-475e0325d74c',
    orderNumber: 1042,
    source: 'QR',
    table: 'T4',
    customerName: 'Rahul Sharma',
    customerPhone: '+91 98765 43210',
    createdAt: '2026-11-03T07:54:00Z',
    createdAtLocal: '03/11/2026, 01:24 PM',
    customerNotes: 'Extra spicy, less oil',
    items: [
      { name: 'Cold Coffee', qty: 2 },
      { name: 'Cheese Butter Maggi', qty: 1, notes: 'Extra cheese' }
    ]
  });

  assert.strictEqual(valid.valid, true);
  assert.strictEqual(valid.payload?.orderNumber, 1042);
  assert.strictEqual(valid.payload?.items.length, 2);
  console.log('  ✓ Valid KOT payload accepted');
}

// 2. Unsupported schema version
{
  const invalid = validateClaimedJobPayload({
    schemaVersion: '2.0',
    jobId: '123',
    orderId: 'abc',
    orderNumber: 1,
    source: 'QR',
    table: 'T1',
    items: [{ name: 'Chai', qty: 1 }]
  });

  assert.strictEqual(invalid.valid, false);
  assert.match(invalid.error || '', /Unsupported payload schemaVersion "2.0"/);
  console.log('  ✓ Unsupported schema version rejected');
}

// 3. Missing jobId or orderId
{
  const noJobId = validateClaimedJobPayload({
    schemaVersion: '1.0',
    jobId: '',
    orderId: 'abc',
    orderNumber: 1,
    source: 'QR',
    table: 'T1',
    items: [{ name: 'Chai', qty: 1 }]
  });

  assert.strictEqual(noJobId.valid, false);
  assert.match(noJobId.error || '', /Invalid or missing "jobId"/);
  console.log('  ✓ Missing jobId rejected');
}

// 4. Invalid order number
{
  const badOrderNum = validateClaimedJobPayload({
    schemaVersion: '1.0',
    jobId: '123',
    orderId: 'abc',
    orderNumber: -5,
    source: 'QR',
    table: 'T1',
    items: [{ name: 'Chai', qty: 1 }]
  });

  assert.strictEqual(badOrderNum.valid, false);
  assert.match(badOrderNum.error || '', /Invalid "orderNumber"/);
  console.log('  ✓ Non-positive order number rejected');
}

// 5. Empty items array
{
  const emptyItems = validateClaimedJobPayload({
    schemaVersion: '1.0',
    jobId: '123',
    orderId: 'abc',
    orderNumber: 10,
    source: 'POS',
    table: 'T1',
    items: []
  });

  assert.strictEqual(emptyItems.valid, false);
  assert.match(emptyItems.error || '', /must be a non-empty array/);
  console.log('  ✓ Empty items array rejected');
}

// 6. Invalid item quantity
{
  const badQty = validateClaimedJobPayload({
    schemaVersion: '1.0',
    jobId: '123',
    orderId: 'abc',
    orderNumber: 10,
    source: 'POS',
    table: 'T1',
    items: [{ name: 'Coffee', qty: 0 }]
  });

  assert.strictEqual(badQty.valid, false);
  assert.match(badQty.error || '', /invalid quantity/);
  console.log('  ✓ Item quantity zero or negative rejected');
}

// 7. Reprint information parsed correctly
{
  const reprint = validateClaimedJobPayload({
    schemaVersion: '1.0',
    jobId: '123',
    orderId: 'abc',
    orderNumber: 10,
    source: 'POS',
    table: 'T1',
    items: [{ name: 'Coffee', qty: 1 }],
    reprintInfo: {
      isReprint: true,
      reprintOfJobId: 'old-job-uuid',
      reason: 'Barista dropped ticket'
    }
  });

  assert.strictEqual(reprint.valid, true);
  assert.strictEqual(reprint.payload?.reprintInfo?.isReprint, true);
  assert.strictEqual(reprint.payload?.reprintInfo?.reason, 'Barista dropped ticket');
  console.log('  ✓ Reprint information verified and parsed');
}

// 8. Item add-ons parsed cleanly while staying schemaVersion 1.0 compatible
{
  const withAddons = validateClaimedJobPayload({
    schemaVersion: '1.0',
    jobId: 'job-addons-1',
    orderId: 'order-addons-1',
    orderNumber: 2050,
    source: 'POS',
    table: 'T2',
    items: [
      {
        name: 'Americano',
        qty: 2,
        addons: [
          { id: 'addon_irish', name: 'Irish Flavour', price: 40 },
          { name: '  Extra Shot  ' },
          { invalid: true }
        ],
        notes: '+ Irish Flavour, + Extra Shot'
      }
    ]
  });

  assert.strictEqual(withAddons.valid, true);
  assert.strictEqual(withAddons.payload?.items[0].addons?.length, 2);
  assert.deepStrictEqual(withAddons.payload?.items[0].addons?.[0], {
    id: 'addon_irish',
    name: 'Irish Flavour',
    price: 40
  });
  assert.strictEqual(withAddons.payload?.items[0].addons?.[1].name, 'Extra Shot');
  console.log('  ✓ Item add-ons parsed and normalized without breaking schemaVersion 1.0');
}
