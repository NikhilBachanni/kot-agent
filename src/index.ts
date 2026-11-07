/**
 * PLATORIA PRINT AGENT — ENTRY POINT
 * ===================================
 * Main application launcher with single-instance lock and graceful shutdown.
 */

import fs from 'fs';
import path from 'path';
import { loadConfig, maskSecret } from './config';
import { Logger } from './logger';
import { CloudflareClient } from './cloudflare-client';
import { SmartPosClient } from './smartpos-client';
import { JobProcessor } from './job-processor';

const LOCKFILE = path.resolve(process.cwd(), '.agent.lock');

/**
 * Ensures only one instance of the print agent runs on the PC
 */
function acquireSingleInstanceLock(logger: Logger): boolean {
  try {
    if (fs.existsSync(LOCKFILE)) {
      const content = fs.readFileSync(LOCKFILE, 'utf8').trim();
      const existingPid = parseInt(content, 10);

      if (!isNaN(existingPid)) {
        try {
          // Check if process with PID is actually running
          process.kill(existingPid, 0);
          logger.error(
            `Another instance of Platoria Print Agent is already running (PID: ${existingPid}). Exiting to prevent duplicate printing.`
          );
          return false;
        } catch {
          // Process not running, stale lock file
          logger.warn(`Removing stale lockfile from PID ${existingPid}`);
          try {
            fs.unlinkSync(LOCKFILE);
          } catch {}
        }
      }
    }

    fs.writeFileSync(LOCKFILE, String(process.pid), 'utf8');

    // Clean up lockfile on exit
    const cleanup = () => {
      try {
        if (fs.existsSync(LOCKFILE)) {
          const content = fs.readFileSync(LOCKFILE, 'utf8').trim();
          if (content === String(process.pid)) {
            fs.unlinkSync(LOCKFILE);
          }
        }
      } catch {}
    };

    process.on('exit', cleanup);
    return true;
  } catch (err: any) {
    logger.error(`Failed to manage single-instance lock: ${err.message}`);
    return true; // continue if filesystem allows
  }
}

async function main() {
  console.log('========================================================');
  console.log('       PLATORIA LOCAL WINDOWS PRINT AGENT (v1.0)        ');
  console.log('       TVS RP 3220 Star 80mm ESC/POS Thermal Bridge     ');
  console.log('========================================================\n');

  // 1. Load & validate configuration
  let config;
  try {
    config = loadConfig();
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  // 2. Initialize logger with token redaction
  const logger = new Logger(config.logLevel, config.logDir, config.printAgentToken);

  // 3. Single-instance protection
  if (!acquireSingleInstanceLock(logger)) {
    process.exit(1);
  }

  logger.info(`Starting with Agent ID: ${config.printAgentId}`);
  logger.info(`Platoria Server: ${config.platoriaApiUrl}`);
  logger.info(`Device Token: ${maskSecret(config.printAgentToken)}`);
  logger.info(`SmartPOS Target: ${config.smartposBaseUrl} (Auto-discovery: ${config.smartposAutoPortDiscovery})`);
  logger.info(`Target Printer: "${config.printerName}"`);
  logger.info(`Timezone: ${config.timezone} | Log Level: ${config.logLevel}`);

  // 4. Initialize clients
  const cloudflare = new CloudflareClient({
    baseUrl: config.platoriaApiUrl,
    token: config.printAgentToken,
    timeoutMs: config.httpTimeoutMs,
    logger
  });

  const smartpos = new SmartPosClient({
    baseUrl: config.smartposBaseUrl,
    autoPortDiscovery: config.smartposAutoPortDiscovery,
    candidatePorts: config.smartposPorts,
    timeoutMs: config.httpTimeoutMs,
    logger
  });

  const processor = new JobProcessor({
    config,
    cloudflare,
    smartpos,
    logger
  });

  // 5. Clean shutdown handling
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down cleanly...`);
    processor.stop();
    logger.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err.message}`, err);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${reason}`);
  });

  // 6. Launch processor
  await processor.start();
}

main().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
