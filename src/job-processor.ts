/**
 * PLATORIA PRINT AGENT — JOB PROCESSOR
 * =====================================
 * Sequential polling and print execution state machine.
 * Enforces duplicate protection, lease renewal, and unambiguous acknowledgements.
 */

import { CloudflareClient } from './cloudflare-client';
import { SmartPosClient } from './smartpos-client';
import { validateClaimedJobPayload, ClaimedJob } from './payload-validator';
import { formatKotToEscPos } from './kot-formatter';
import { RetryPolicy } from './retry-policy';
import { Logger } from './logger';
import { AgentConfig } from './config';

export class JobProcessor {
  private config: AgentConfig;
  private cloudflare: CloudflareClient;
  private smartpos: SmartPosClient;
  private logger: Logger;
  private retryPolicy: RetryPolicy;

  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private loopTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(params: {
    config: AgentConfig;
    cloudflare: CloudflareClient;
    smartpos: SmartPosClient;
    logger: Logger;
  }) {
    this.config = params.config;
    this.cloudflare = params.cloudflare;
    this.smartpos = params.smartpos;
    this.logger = params.logger;
    this.retryPolicy = new RetryPolicy({
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      factor: 1.5,
      jitter: true
    });
  }

  /**
   * Starts sequential polling loop and background heartbeat
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    this.logger.info(`Starting Platoria Print Agent [${this.config.printAgentId}]`);
    this.logger.info(`Target Printer: "${this.config.printerName}" | Polling interval: ${this.config.pollIntervalMs}ms`);

    // Initial pre-flight check of local SmartPOS Bridge
    await this.verifyLocalPrinter();

    // Start heartbeat every 30 seconds
    this.startHeartbeat();

    // Kick off polling loop
    this.scheduleNextPoll(0);
  }

  /**
   * Pre-flight printer and bridge diagnostics
   */
  public async verifyLocalPrinter(): Promise<boolean> {
    this.logger.info('Performing pre-flight bridge and printer check...');
    try {
      const health = await this.smartpos.discoverBridge();
      if (!health.ok) {
        this.logger.warn(`⚠️ SmartPOS Print Bridge is not responding: ${health.error}`);
        return false;
      }

      this.logger.info(`✓ Connected to SmartPOS Print Bridge on ${health.url}`);

      const verification = await this.smartpos.verifyPrinter(this.config.printerName);
      if (verification.installedPrinters.length > 0) {
        this.logger.info(`Installed Windows Printers: [${verification.installedPrinters.join(', ')}]`);
        if (verification.available) {
          this.logger.info(`✓ Configured printer "${this.config.printerName}" is ONLINE and verified.`);
          return true;
        } else {
          this.logger.warn(
            `⚠️ Printer "${this.config.printerName}" was not found in installed printers. Please check printer name in Windows "Printers & scanners".`
          );
          return false;
        }
      } else {
        this.logger.info(`✓ Connected to bridge (direct printer submission enabled for "${this.config.printerName}").`);
        return true;
      }
    } catch (err: any) {
      this.logger.warn(`Error during printer pre-flight: ${err.message}`);
      return false;
    }
  }

  /**
   * Background heartbeat to notify Platoria of agent health
   */
  private startHeartbeat(): void {
    const sendBeat = async () => {
      if (!this.isRunning) return;
      try {
        await this.cloudflare.sendHeartbeat(this.config.printAgentId, 'ONLINE_READY');
        this.logger.debug('Heartbeat acknowledged by Platoria');
      } catch (err: any) {
        this.logger.debug(`Heartbeat non-fatal error: ${err.message}`);
      }
    };

    sendBeat();
    this.heartbeatTimer = setInterval(sendBeat, 30000);
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.isRunning) return;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
    }
    this.loopTimer = setTimeout(() => this.pollAndProcess(), delayMs);
  }

  /**
   * Single sequential processing cycle
   */
  public async pollAndProcess(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    let nextDelay = this.config.pollIntervalMs;

    try {
      // 1. Guard: Check if local bridge is reachable before claiming remote jobs
      // Never pull jobs off the cloud queue if the local printer bridge is down!
      const bridgeHealth = await this.smartpos.discoverBridge();
      if (!bridgeHealth.ok) {
        nextDelay = this.retryPolicy.nextDelayMs();
        this.logger.warn(
          `SmartPOS Print Bridge offline on 127.0.0.1. Pausing queue polling. Backoff: ${Math.round(nextDelay / 1000)}s`
        );
        return;
      }

      // 2. Claim next pending job from Platoria
      const claimResult = await this.cloudflare.claimJob(this.config.printAgentId);

      if (!claimResult.ok) {
        if (claimResult.retryAfterSeconds) {
          nextDelay = claimResult.retryAfterSeconds * 1000;
        } else {
          nextDelay = this.retryPolicy.nextDelayMs();
        }
        this.logger.warn(`Claim failed: ${claimResult.error || 'Server error'}. Retrying in ${Math.round(nextDelay / 1000)}s`);
        return;
      }

      // Reset backoff upon successful server communication
      this.retryPolicy.reset();

      if (!claimResult.job) {
        // Queue is empty, poll again after regular interval
        this.logger.debug('No pending KOT jobs. Waiting...');
        nextDelay = this.config.pollIntervalMs;
        return;
      }

      // 3. Process claimed job
      await this.processJob(claimResult.job);

      // If a job was just processed, check immediately for next job without delay
      nextDelay = 250;
    } catch (err: any) {
      nextDelay = this.retryPolicy.nextDelayMs();
      this.logger.error(`Error in polling loop: ${err.message}. Backing off for ${Math.round(nextDelay / 1000)}s`);
    } finally {
      this.isProcessing = false;
      this.scheduleNextPoll(nextDelay);
    }
  }

  /**
   * Processes a single claimed job
   */
  public async processJob(job: ClaimedJob): Promise<void> {
    const jobId = job.id;
    this.logger.info(`========================================================`);
    this.logger.info(`[JOB CLAIMED] KOT #${job.orderNumber} (Job ID: ${jobId}, Attempt: ${job.attempts})`);

    // Step A: Validate Payload & Schema Version
    const validation = validateClaimedJobPayload(job.payload);
    if (!validation.valid || !validation.payload) {
      const errMsg = `Payload validation rejected: ${validation.error}`;
      this.logger.error(errMsg);
      try {
        await this.cloudflare.acknowledgeJob(jobId, this.config.printAgentId, 'FAILED', errMsg);
      } catch (ackErr: any) {
        this.logger.error(`Failed to acknowledge validation failure: ${ackErr.message}`);
      }
      return;
    }

    const payload = validation.payload;
    this.logger.info(`Order Table: ${payload.table} | Source: ${payload.source} | Items: ${payload.items.length}`);

    // Step B: Report PRINTING to Platoria (extends lease & marks active transmission)
    try {
      await this.cloudflare.reportPrinting(jobId, this.config.printAgentId);
      this.logger.info(`State updated to PRINTING on server (Lease extended).`);
    } catch (printErr: any) {
      this.logger.warn(`Failed to report PRINTING to Platoria: ${printErr.message}. Continuing with local print.`);
    }

    // Step C: Format KOT into ESC/POS bytes
    let escposBytes: Buffer;
    try {
      escposBytes = formatKotToEscPos(payload, {
        columns: 48,
        restaurantName: 'SHAMBHU CAFE'
      });
      this.logger.info(`Generated ESC/POS binary stream (${escposBytes.length} bytes).`);
    } catch (formatErr: any) {
      const errMsg = `KOT ESC/POS formatting failed: ${formatErr.message}`;
      this.logger.error(errMsg);
      await this.cloudflare.acknowledgeJob(jobId, this.config.printAgentId, 'FAILED', errMsg);
      return;
    }

    // Step D: Send bytes to local SmartPOS Print Bridge
    this.logger.info(`Sending ${escposBytes.length} bytes to printer "${this.config.printerName}" via SmartPOS...`);
    const printResult = await this.smartpos.printEscpos(this.config.printerName, escposBytes);

    // Step E: Acknowledge outcome according to duplicate-safe protocol
    if (printResult.ok) {
      this.logger.info(`✓ [SUBMITTED] SmartPOS accepted KOT #${payload.orderNumber} for printing.`);
      try {
        await this.cloudflare.acknowledgeJob(jobId, this.config.printAgentId, 'SUBMITTED');
        this.logger.info(`✓ [ACK COMPLETED] Server acknowledged SUBMITTED.`);
      } catch (ackErr: any) {
        this.logger.error(`Critical: Failed to send SUBMITTED ack to server: ${ackErr.message}`);
      }
    } else if (printResult.isAmbiguous) {
      // Ambiguous: network timed out after request was sent to bridge!
      // Must NOT automatically reprint to prevent physical duplication.
      this.logger.warn(`⚠️ [AMBIGUOUS OUTCOME] Transmission uncertain: ${printResult.error}`);
      try {
        await this.cloudflare.acknowledgeJob(
          jobId,
          this.config.printAgentId,
          'NEEDS_REVIEW',
          printResult.error
        );
        this.logger.warn(`Job marked as NEEDS_REVIEW on server. Staff can check printer paper.`);
      } catch (ackErr: any) {
        this.logger.error(`Failed to acknowledge NEEDS_REVIEW: ${ackErr.message}`);
      }
    } else {
      // Definite failure before spooler accepted
      this.logger.error(`✗ [PRINT FAILED] SmartPOS bridge error: ${printResult.error}`);
      try {
        await this.cloudflare.acknowledgeJob(
          jobId,
          this.config.printAgentId,
          'FAILED',
          printResult.error
        );
        this.logger.info(`Reported FAILED to server.`);
      } catch (ackErr: any) {
        this.logger.error(`Failed to acknowledge FAILED status: ${ackErr.message}`);
      }
    }
  }

  /**
   * Graceful stop
   */
  public stop(): void {
    this.logger.info('Stopping Platoria Print Agent...');
    this.isRunning = false;

    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
