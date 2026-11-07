/**
 * PLATORIA PRINT AGENT — PAYLOAD VALIDATOR MODULE
 * ================================================
 * Validates KOT job payload structure and schema version.
 * Conforms to docs/PRINT_AGENT_PROTOCOL.md specification.
 */

export const SUPPORTED_SCHEMA_VERSION = '1.0';

export interface KotItem {
  name: string;
  qty: number;
  notes?: string;
}

export interface KotReprintInfo {
  isReprint: boolean;
  reprintOfJobId?: string;
  reason?: string;
}

export interface KotPayload {
  schemaVersion: '1.0';
  jobId: string;
  orderId: string;
  orderNumber: number;
  source: 'QR' | 'POS';
  table: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  createdAtLocal: string;
  customerNotes?: string;
  items: KotItem[];
  reprintInfo?: KotReprintInfo;
}

export interface ClaimedJob {
  id: string;
  orderId: string;
  orderNumber: number;
  jobType: string;
  source: string;
  status: string;
  payload: KotPayload;
  attempts: number;
  leaseExpiresAt: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  payload?: KotPayload;
}

/**
 * Validates a claimed KOT payload against schema version and required fields
 */
export function validateClaimedJobPayload(rawPayload: unknown): ValidationResult {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { valid: false, error: 'Job payload must be a non-null JSON object' };
  }

  const p = rawPayload as Record<string, any>;

  if (p.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return {
      valid: false,
      error: `Unsupported payload schemaVersion "${p.schemaVersion}". Supported version is "${SUPPORTED_SCHEMA_VERSION}".`
    };
  }

  if (typeof p.jobId !== 'string' || !p.jobId.trim()) {
    return { valid: false, error: 'Invalid or missing "jobId" in payload' };
  }

  if (typeof p.orderId !== 'string' || !p.orderId.trim()) {
    return { valid: false, error: 'Invalid or missing "orderId" in payload' };
  }

  const orderNum = Number(p.orderNumber);
  if (isNaN(orderNum) || orderNum <= 0) {
    return { valid: false, error: `Invalid "orderNumber": expected positive number, got ${p.orderNumber}` };
  }

  if (p.source !== 'QR' && p.source !== 'POS') {
    return { valid: false, error: `Invalid "source": expected "QR" or "POS", got "${p.source}"` };
  }

  if (typeof p.table !== 'string') {
    return { valid: false, error: 'Missing or non-string "table" in payload' };
  }

  if (!Array.isArray(p.items) || p.items.length === 0) {
    return { valid: false, error: 'Payload "items" must be a non-empty array' };
  }

  const validatedItems: KotItem[] = [];
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i];
    if (!item || typeof item !== 'object') {
      return { valid: false, error: `Item at index ${i} is not a valid object` };
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
      return { valid: false, error: `Item at index ${i} is missing a valid "name"` };
    }
    const qty = Number(item.qty);
    if (isNaN(qty) || qty <= 0) {
      return { valid: false, error: `Item "${item.name}" has invalid quantity: ${item.qty}` };
    }

    validatedItems.push({
      name: item.name.trim(),
      qty: Math.floor(qty),
      notes: typeof item.notes === 'string' && item.notes.trim() ? item.notes.trim() : undefined
    });
  }

  let reprintInfo: KotReprintInfo | undefined;
  if (p.reprintInfo && typeof p.reprintInfo === 'object') {
    reprintInfo = {
      isReprint: Boolean(p.reprintInfo.isReprint),
      reprintOfJobId: typeof p.reprintInfo.reprintOfJobId === 'string' ? p.reprintInfo.reprintOfJobId : undefined,
      reason: typeof p.reprintInfo.reason === 'string' ? p.reprintInfo.reason : undefined
    };
  }

  const validatedPayload: KotPayload = {
    schemaVersion: '1.0',
    jobId: p.jobId.trim(),
    orderId: p.orderId.trim(),
    orderNumber: orderNum,
    source: p.source,
    table: String(p.table).trim(),
    customerName: String(p.customerName || 'Guest').trim(),
    customerPhone: String(p.customerPhone || '').trim(),
    createdAt: String(p.createdAt || new Date().toISOString()),
    createdAtLocal: String(p.createdAtLocal || '').trim(),
    customerNotes: typeof p.customerNotes === 'string' && p.customerNotes.trim() ? p.customerNotes.trim() : undefined,
    items: validatedItems,
    reprintInfo
  };

  return { valid: true, payload: validatedPayload };
}
