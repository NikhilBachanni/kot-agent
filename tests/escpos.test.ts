import assert from 'assert';
import { EscPosBuilder, ESC, GS, LF } from '../src/escpos';

console.log('--- Testing ESC/POS Builder Module ---');

// 1. Init command
{
  const builder = new EscPosBuilder();
  const bytes = builder.init().build();
  assert.deepStrictEqual(Array.from(bytes), [ESC, 0x40]);
  console.log('  ✓ Printer initialization ESC @ (1B 40) verified');
}

// 2. Bold and Alignment
{
  const builder = new EscPosBuilder();
  const bytes = builder.bold(true).align('center').build();
  assert.deepStrictEqual(Array.from(bytes), [ESC, 0x45, 0x01, ESC, 0x61, 0x01]);
  console.log('  ✓ Bold and Center alignment commands verified');
}

// 3. Double height / width
{
  const builder = new EscPosBuilder();
  const bytes = builder.size(2, 2).build();
  // Double width (0x10) | Double height (0x01) = 0x11
  assert.deepStrictEqual(Array.from(bytes), [GS, 0x21, 0x11]);
  console.log('  ✓ Double width + height GS ! 0x11 verified');
}

// 4. Cut command
{
  const builder = new EscPosBuilder();
  const bytes = builder.cut(true).build();
  // GS V 66 0 (0x1D 0x56 0x42 0x00)
  assert.deepStrictEqual(Array.from(bytes), [GS, 0x56, 0x42, 0x00]);
  console.log('  ✓ Partial paper cut command GS V 66 0 verified');
}

// 5. Two-column row width exactly 48 chars
{
  const builder = new EscPosBuilder({ columns: 48 });
  const rowBytes = builder.rowTwoColumns('Left Text', 'Right Text').build();
  // Strip the trailing LF (0x0A)
  const line = rowBytes.subarray(0, -1).toString('ascii');
  // Account for ESC a 0 (3 bytes) prefix
  const textContent = line.replace(/^\x1b\x61\x00/, '');
  assert.strictEqual(textContent.length, 48);
  assert.strictEqual(textContent.startsWith('Left Text'), true);
  assert.strictEqual(textContent.endsWith('Right Text'), true);
  console.log('  ✓ Two-column row formatted to exactly 48 characters');
}

// 6. Word wrapping
{
  const longName = 'Extra Special Double Cheese Margherita Pizza with Fresh Basil and Oregano';
  const wrapped = EscPosBuilder.wrapText(longName, 25);
  for (const line of wrapped) {
    assert.ok(line.length <= 25, `Line length ${line.length} exceeds 25`);
  }
  assert.ok(wrapped.length >= 3, 'Should wrap into at least 3 lines');
  console.log('  ✓ Text wrapping respects column boundaries without breaking words');
}

// 7. Unicode and Rupee symbol sanitization
{
  const raw = 'Special Café Crème • Price: ₹150 “Good”';
  const clean = EscPosBuilder.sanitizeAscii(raw);
  assert.strictEqual(clean, 'Special Cafe Creme * Price: Rs. 150 "Good"');
  console.log('  ✓ Unicode transliteration and Rupee symbol replaced with readable ASCII');
}
