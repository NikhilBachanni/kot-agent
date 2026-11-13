/**
 * PLATORIA PRINT AGENT — COMPACT KOT FORMATTER
 * ============================================
 * Formats validated KotPayload into thermal ESC/POS bytes.
 * Calibrated specifically to match reference receipt layout:
 * - Centered Running Table header
 * - Date/Time in DD/MM/YY HH:mm
 * - KOT - <number>
 * - Dine In / Takeaway / Delivery
 * - Table No: <Table>
 * - Dashed divider
 * - Item (left) ... Qt (right)
 * - Zero pricing, zero fluff, no barcodes.
 */

import { EscPosBuilder } from "./escpos";
import { KotPayload } from "./payload-validator";

export interface KotFormatterOptions {
  columns?: number;
  restaurantName?: string; // Accepted for backwards compatibility
}

/**
 * Formats a KOT payload into raw ESC/POS Buffer matching reference thermal receipt
 */
export function formatKotToEscPos(
  payload: KotPayload,
  options: KotFormatterOptions = {}
): Buffer {
  const columns = options.columns || 48;
  const builder = new EscPosBuilder({ columns });

  // 1. Initialize printer
  builder.init();

  // 2. Reprint Banner (if applicable)
  if (payload.reprintInfo?.isReprint) {
    builder.align("center").bold(true).textLine("*** REPRINT ***");
    builder.normalSize();
    if (payload.reprintInfo.reason) {
      builder.textLine(`Reason: ${payload.reprintInfo.reason}`);
    }
    builder.divider("-");
  }

  // 3. Format Date & Time: DD/MM/YY HH:mm matching reference image (e.g. 13/11/26 20:53)
  let timeStr = "";
  try {
    const d = payload.createdAt ? new Date(payload.createdAt) : new Date();
    const formatted = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(d);
    // "13/11/26, 20:53" -> "13/11/26 20:53"
    timeStr = formatted.replace(",", "");
  } catch {
    timeStr = payload.createdAtLocal || payload.createdAt || "";
  }

  // 4. Determine Dining Mode & Running Table / Order Banner
  const rawNotes = payload.customerNotes || "";
  const rawTable = (payload.table || "").trim();

  let diningMode = "Dine In";
  let bannerTitle = "Running Table";

  if (/\[PICKUP\]|takeaway|pickup/i.test(rawNotes)) {
    diningMode = "Takeaway";
    bannerTitle = "Takeaway";
  } else if (/\[DELIVERY\]|delivery/i.test(rawNotes)) {
    diningMode = "Delivery";
    bannerTitle = "Delivery";
  } else if (!rawTable || rawTable.toUpperCase() === "COUNTER") {
    diningMode = "Takeaway";
    bannerTitle = "Takeaway";
  }

  // Normalize Table identifier (e.g. "4" -> "T4", "Table 4" -> "T4")
  let tableDisplay = "T1";
  if (/^t\d+$/i.test(rawTable)) {
    tableDisplay = rawTable.toUpperCase();
  } else if (/^\d+$/.test(rawTable)) {
    tableDisplay = `T${rawTable}`;
  } else if (/^table\s*(\w+)/i.test(rawTable)) {
    const match = rawTable.match(/^table\s*(\w+)/i);
    tableDisplay = `T${match ? match[1].toUpperCase() : ""}`;
  } else if (rawTable) {
    tableDisplay = rawTable;
  } else if (diningMode === "Takeaway") {
    tableDisplay = "Takeaway";
  } else if (diningMode === "Delivery") {
    tableDisplay = "Delivery";
  }

  // 5. Centered Header exactly matching reference receipt
  builder.align("center").bold(true);
  builder.textLine(bannerTitle);
  builder.textLine(timeStr);
  builder.textLine(`KOT - ${payload.orderNumber}`);
  builder.textLine(diningMode);
  builder.textLine(`Table No: ${tableDisplay}`);

  // 6. Dashed Divider
  builder.divider("-");

  // 7. Column Headers: Item (left) ... Qt (right)
  builder.align("left").bold(true);
  builder.rowTwoColumns("Item", "Qt");
  builder.divider("-");

  // 8. Items List
  const QT_WIDTH = 4;
  const ITEM_WIDTH = Math.max(12, columns - QT_WIDTH - 1);

  for (const item of payload.items) {
    const qtyStr = String(item.qty).trim();
    const nameLines = EscPosBuilder.wrapText(item.name, ITEM_WIDTH);

    // First line with item name (left) and quantity (right)
    builder.bold(true).rowTwoColumns(nameLines[0], qtyStr);

    // Subsequent lines of wrapped item name
    for (let i = 1; i < nameLines.length; i++) {
      builder.bold(true).textLine(nameLines[i]);
    }

    // Item-specific instructions/notes (if any)
    if (item.notes) {
      const noteLines = EscPosBuilder.wrapText(`* ${item.notes}`, ITEM_WIDTH);
      builder.bold(false);
      for (const nl of noteLines) {
        builder.textLine(`  ${nl}`);
      }
    }
  }

  // 9. Kitchen Special Instructions / Notes (Only when present)
  const cleanInstructions = rawNotes
    .replace(/\[PICKUP\]/gi, "")
    .replace(/\[DELIVERY\]/gi, "")
    .replace(/\[ADD-ON\]/gi, "")
    .trim();

  if (cleanInstructions) {
    builder.divider("-");
    builder.align("left").bold(true).textLine("Notes:");
    builder.bold(false);
    const instructionLines = EscPosBuilder.wrapText(cleanInstructions, columns - 2);
    for (const il of instructionLines) {
      builder.textLine(`  ${il}`);
    }
  }

  builder.divider("-");

  // Minimal paper feed and cut
  builder.feed(2);
  builder.cut(true);

  return builder.build();
}
