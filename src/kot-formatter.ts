/**
 * PLATORIA PRINT AGENT — KOT FORMATTER
 * =====================================
 * Formats validated KotPayload into thermal ESC/POS bytes.
 * Calibrated for TVS RP 3220 Star (80mm thermal paper, 48 columns).
 * Conforms to docs/PRINT_AGENT_PROTOCOL.md layout requirements.
 */

import { EscPosBuilder } from './escpos';
import { KotPayload } from './payload-validator';

export interface KotFormatterOptions {
  columns?: number;
  restaurantName?: string;
}

/**
 * Formats a KOT payload into raw ESC/POS Buffer
 */
export function formatKotToEscPos(
  payload: KotPayload,
  options: KotFormatterOptions = {}
): Buffer {
  const columns = options.columns || 48;
  const builder = new EscPosBuilder({ columns });

  // 1. Initialize printer
  builder.init();

  // 2. Header: Restaurant Name / Kitchen Order
  builder.align('center').bold(true);
  if (options.restaurantName) {
    builder.size(1, 1).textLine(options.restaurantName.toUpperCase());
  }

  // Header Box
  builder.divider('=');
  builder.size(2, 2).textLine('KITCHEN ORDER');
  builder.normalSize();

  // Prominent Table / Counter identifier
  const rawTable = payload.table.trim();
  let tableDisplay = rawTable;
  if (/^\d+$/.test(rawTable)) {
    tableDisplay = `TABLE ${rawTable}`;
  } else if (/^t\d+$/i.test(rawTable)) {
    tableDisplay = `TABLE ${rawTable.toUpperCase().replace(/^T/, '')}`;
  } else {
    tableDisplay = rawTable.toUpperCase();
  }

  builder.size(2, 1).textLine(`[ ${tableDisplay} ]`);
  builder.normalSize();
  builder.divider('=');

  // 3. Reprint Banner (if applicable)
  if (payload.reprintInfo?.isReprint) {
    builder.align('center').bold(true).size(2, 1).textLine('*** REPRINT ***');
    builder.normalSize();
    if (payload.reprintInfo.reason) {
      builder.textLine(`Reason: ${payload.reprintInfo.reason}`);
    }
    builder.divider('*');
  }

  // 4. Order Metadata (Left & Right aligned)
  builder.align('left').bold(false);
  const timeStr = payload.createdAtLocal || payload.createdAt;
  const sourceStr = payload.source === 'POS' ? 'POS Order' : 'QR Order';

  builder.bold(true).size(2, 1).textLine(`ORDER #: ${payload.orderNumber}`);
  builder.normalSize().bold(false);

  builder.rowTwoColumns(`Time: ${timeStr}`, `Source: ${sourceStr}`);

  if (payload.customerName && payload.customerName.toLowerCase() !== 'guest') {
    builder.textLine(`Customer: ${payload.customerName}`);
  }

  builder.divider('-');

  // 5. Items Header
  // QTY is 5 chars (e.g. "QTY  "), ITEM is 43 chars
  builder.bold(true).textLine('QTY   ITEM DESCRIPTION');
  builder.divider('-');
  builder.bold(false);

  // 6. Items List
  const QTY_COL_WIDTH = 5;
  const ITEM_COL_WIDTH = columns - QTY_COL_WIDTH - 1; // 48 - 5 - 1 = 42 chars

  for (const item of payload.items) {
    const qtyStr = String(item.qty).padStart(3, ' ') + '  ';
    const nameLines = EscPosBuilder.wrapText(item.name, ITEM_COL_WIDTH);

    // First line with quantity
    builder.bold(true).text(qtyStr).textLine(nameLines[0]);

    // Subsequent lines indented
    for (let i = 1; i < nameLines.length; i++) {
      builder.text(' '.repeat(QTY_COL_WIDTH)).textLine(nameLines[i]);
    }

    // Item-specific notes (if any)
    if (item.notes) {
      const noteLines = EscPosBuilder.wrapText(`* ${item.notes}`, ITEM_COL_WIDTH);
      builder.bold(false);
      for (const nl of noteLines) {
        builder.text(' '.repeat(QTY_COL_WIDTH)).textLine(nl);
      }
    }
  }

  // 7. Overall Customer Notes / Kitchen Instructions
  if (payload.customerNotes && payload.customerNotes.trim()) {
    builder.divider('-');
    builder.bold(true).textLine('SPECIAL INSTRUCTIONS:');
    builder.bold(false);
    const instructionLines = EscPosBuilder.wrapText(payload.customerNotes, columns - 2);
    for (const il of instructionLines) {
      builder.textLine(`  ${il}`);
    }
  }

  // 8. Footer & Cut
  builder.divider('=');
  builder.align('center').textLine(`-- Platoria KOT Job: ${payload.jobId.slice(0, 8)} --`);

  // Feed 4 lines to clear the print head and partial cut
  builder.feed(4);
  builder.cut(true);

  return builder.build();
}
