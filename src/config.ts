/**
 * PLATORIA PRINT AGENT — CONFIGURATION MODULE
 * ============================================
 * Loads and validates local environment variables.
 * Safe redaction helpers for logs and diagnostics.
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Attempt to load .env from current working directory or application directory
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../.env')
];

for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

export interface AgentConfig {
  platoriaApiUrl: string;
  printAgentToken: string;
  printAgentId: string;
  smartposBaseUrl: string;
  smartposAutoPortDiscovery: boolean;
  smartposPorts: number[];
  printerName: string;
  pollIntervalMs: number;
  maxEmptyPollIntervalMs: number;
  emptyPollStepMs: number;
  httpTimeoutMs: number;
  maxAttempts: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logDir: string;
  timezone: string;
}

/**
 * Parse port range string like "8000-8010" or "8003,8004,8005"
 */
export function parsePortRange(raw: string | undefined): number[] {
  if (!raw || !raw.trim()) {
    return [8003, 8000, 8080, 8888];
  }

  const ports = new Set<number>();
  const parts = raw.split(',').map((p) => p.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map((s) => parseInt(s.trim(), 10));
      if (!isNaN(startStr) && !isNaN(endStr) && startStr <= endStr) {
        for (let p = Math.max(1, startStr); p <= Math.min(65535, endStr); p++) {
          ports.add(p);
        }
      }
    } else {
      const port = parseInt(part, 10);
      if (!isNaN(port) && port >= 1 && port <= 65535) {
        ports.add(port);
      }
    }
  }

  return Array.from(ports).sort((a, b) => a - b);
}

/**
 * Mask sensitive device token for safe logging
 * Example: "secret_12345678" -> "secr...5678"
 */
export function maskSecret(secret: string | undefined): string {
  if (!secret) return '[EMPTY]';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

/**
 * Validates and loads application configuration
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const errors: string[] = [];

  const platoriaApiUrl = (env.PLATORIA_API_URL || '').trim().replace(/\/+$/, '');
  if (!platoriaApiUrl) {
    errors.push('PLATORIA_API_URL is required (e.g. https://your-cafe.workers.dev)');
  } else if (!platoriaApiUrl.startsWith('http://') && !platoriaApiUrl.startsWith('https://')) {
    errors.push('PLATORIA_API_URL must start with http:// or https://');
  }

  const printAgentToken = (env.PRINT_AGENT_TOKEN || '').trim();
  if (!printAgentToken) {
    errors.push('PRINT_AGENT_TOKEN is required. Set it to match the Cloudflare Worker secret.');
  } else if (printAgentToken === 'REPLACE_WITH_DEVICE_TOKEN') {
    errors.push('PRINT_AGENT_TOKEN still has the placeholder value. Please set your real device token.');
  }

  const printerName = (env.PRINTER_NAME || 'TVS RP 3220 Star').trim();
  if (!printerName) {
    errors.push('PRINTER_NAME is required (e.g. TVS RP 3220 Star)');
  }

  const printAgentId = (env.PRINT_AGENT_ID || `win-pc-${process.env.COMPUTERNAME || 'pos-01'}`).trim();

  const smartposBaseUrl = (env.SMARTPOS_BASE_URL || 'http://127.0.0.1:8003').trim().replace(/\/+$/, '');
  const smartposAutoPortDiscovery = env.SMARTPOS_AUTO_PORT_DISCOVERY !== 'false';
  const smartposPorts = parsePortRange(env.SMARTPOS_PORT_RANGE || '8000-8010');

  const pollIntervalMs = Math.max(500, parseInt(env.POLL_INTERVAL_MS || '2000', 10) || 2000);
  const maxEmptyPollIntervalMs = Math.max(
    pollIntervalMs,
    parseInt(env.MAX_EMPTY_POLL_INTERVAL_MS || '6000', 10) || 6000
  );
  const emptyPollStepMs = Math.max(250, parseInt(env.EMPTY_POLL_STEP_MS || '1000', 10) || 1000);
  const httpTimeoutMs = Math.max(2000, parseInt(env.HTTP_TIMEOUT_MS || '10000', 10) || 10000);
  const maxAttempts = Math.max(1, parseInt(env.MAX_ATTEMPTS || '3', 10) || 3);

  const rawLogLevel = (env.LOG_LEVEL || 'info').toLowerCase();
  const logLevel: AgentConfig['logLevel'] = ['debug', 'info', 'warn', 'error'].includes(rawLogLevel)
    ? (rawLogLevel as AgentConfig['logLevel'])
    : 'info';

  const logDir = (env.LOG_DIR || 'logs').trim();
  const timezone = (env.TIMEZONE || 'Asia/Kolkata').trim();

  if (errors.length > 0) {
    const formattedErrors = errors.map((e) => `  - ${e}`).join('\n');
    throw new Error(
      `Configuration error:\n${formattedErrors}\n\nPlease check your .env file in the platoria-print-agent folder.`
    );
  }

  return {
    platoriaApiUrl,
    printAgentToken,
    printAgentId,
    smartposBaseUrl,
    smartposAutoPortDiscovery,
    smartposPorts,
    printerName,
    pollIntervalMs,
    maxEmptyPollIntervalMs,
    emptyPollStepMs,
    httpTimeoutMs,
    maxAttempts,
    logLevel,
    logDir,
    timezone
  };
}
