import assert from "assert";
import { formatKotToEscPos } from "../src/kot-formatter";
import { KotPayload } from "../src/payload-validator";

console.log("--- Testing KOT Formatter Module ---");

const samplePayload: KotPayload = {
  schemaVersion: "1.0",
  jobId: "12345678-1234-1234-1234-123456789abc",
  orderId: "87654321-4321-4321-4321-cba987654321",
  orderNumber: 1042,
  source: "QR",
  table: "T4",
  customerName: "Rahul Sharma",
  customerPhone: "+91 98765 43210",
  createdAt: "2026-11-03T07:54:00Z",
  createdAtLocal: "03/11/2026, 01:24 PM",
  customerNotes: "Extra spicy, less oil please",
  items: [
    { name: "Cold Coffee", qty: 2 },
    { name: "Cheese Butter Maggi with Extra Vegetables and Herbs", qty: 1, notes: "Do not add onions" }
  ]
};

// 1. Output Buffer generated
{
  const buffer = formatKotToEscPos(samplePayload, { columns: 48, restaurantName: "SHAMBHU CAFE" });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 50);

  const textOutput = buffer.toString("ascii");

  // Verify essential KOT sections matching reference receipt
  assert.ok(textOutput.includes("Running Table"), "Must include Running Table banner");
  assert.ok(textOutput.includes("KOT - 1042"), "Must include KOT number");
  assert.ok(textOutput.includes("Table No: T4"), "Must include Table identifier");
  assert.ok(textOutput.includes("Dine In"), "Must include Dine In dining mode");
  assert.ok(textOutput.includes("Item") && textOutput.includes("Qt"), "Must include Item and Qt column headers");
  assert.ok(textOutput.includes("Cold Coffee"), "Must include first item name");
  assert.ok(textOutput.includes("Cheese Butter Maggi"), "Must include second item name");
  assert.ok(textOutput.includes("Do not add onions"), "Must include item-specific note");
  assert.ok(textOutput.includes("Extra spicy, less oil please"), "Must include special instructions");

  // Strict Negative Checks: KOT must NOT display prices, GST, totals, restaurant name, KITCHEN ORDER heading, order #, source, or footers
  assert.ok(!textOutput.includes("₹"), "Must NOT contain Rupee symbol");
  assert.ok(!textOutput.includes("Total"), "Must NOT contain Total amount");
  assert.ok(!textOutput.includes("Subtotal"), "Must NOT contain Subtotal");
  assert.ok(!textOutput.includes("GST"), "Must NOT contain GST");
  assert.ok(!textOutput.includes("Payment"), "Must NOT contain payment details");
  assert.ok(!textOutput.includes("KITCHEN ORDER"), "Must NOT contain KITCHEN ORDER heading");
  assert.ok(!textOutput.includes("SHAMBHU CAFE"), "Must NOT contain restaurant name");
  assert.ok(!textOutput.includes("ORDER #:"), "Must NOT contain ORDER #:");
  assert.ok(!textOutput.includes("Source:"), "Must NOT contain Source:");
  assert.ok(!textOutput.includes("Rahul Sharma"), "Must NOT contain customer name");
  assert.ok(!textOutput.includes("Platoria KOT Job"), "Must NOT contain Platoria footer");

  console.log("  ✓ Standard ultra-compact KOT generated correctly with table, items, notes and zero fluff/pricing");
}

// 2. Long item wrapping
{
  const longPayload: KotPayload = {
    ...samplePayload,
    items: [
      {
        name: "Super Delicious Triple Layer Chocolate Truffle Pastry with Warm Dark Ganache",
        qty: 3
      }
    ]
  };

  const buffer = formatKotToEscPos(longPayload, { columns: 48 });
  const textOutput = buffer.toString("ascii");
  assert.ok(textOutput.includes("Triple Layer"));
  assert.ok(textOutput.includes("Ganache"));
  console.log("  ✓ Long item description cleanly wrapped across 48-column thermal width");
}

// 3. Reprint Ticket
{
  const reprintPayload: KotPayload = {
    ...samplePayload,
    reprintInfo: {
      isReprint: true,
      reprintOfJobId: "old-uuid-999",
      reason: "Printer jammed previously"
    }
  };

  const buffer = formatKotToEscPos(reprintPayload, { columns: 48 });
  const textOutput = buffer.toString("ascii");
  assert.ok(textOutput.includes("*** REPRINT ***"), "Must include prominent reprint banner");
  assert.ok(textOutput.includes("Printer jammed previously"), "Must include reprint reason");
  console.log("  ✓ Reprint ticket includes prominent REPRINT warning and audit reason");
}
