/**
 * PLATORIA PRINT AGENT — CLOUDFLARE API CLIENT
 * =============================================
 * Typed client for Platoria Cloudflare Worker Print-Agent API.
 * Supports dynamic routing of /claim and /heartbeat between the main app
 * (in_app mode) and the dedicated Worker (dedicated_worker mode), while
 * keeping /config, /printing, and /ack on the main Platoria app.
 */

import { ClaimedJob } from './payload-validator';
import { Logger } from './logger';

export type TransportMode = 'in_app' | 'dedicated_worker';

export interface ClaimApiResponse {
  ok: boolean;
  job: ClaimedJob | null;
  message?: string;
  error?: string;
  activeMode?: TransportMode;
  retryAfterSeconds?: number;
}

export interface PrintingApiResponse {
  ok: boolean;
  jobId?: string;
  status?: string;
  error?: string;
}

export interface AckApiResponse {
  ok: boolean;
  jobId?: string;
  status?: string;
  acknowledgedAt?: string;
  error?: string;
}

export interface HeartbeatApiResponse {
  ok: boolean;
  agentId?: string;
  printerStatus?: string;
  activeMode?: TransportMode;
  worker?: string;
  serverTime?: string;
  error?: string;
}

export interface HealthApiResponse {
  ok: boolean;
  status?: string;
  worker?: string;
  activeMode?: TransportMode;
  queue?: Record<string, number>;
  timestamp?: string;
  error?: string;
}

export interface AgentConfigApiResponse {
  ok: boolean;
  mode: TransportMode;
  configuredMode?: TransportMode;
  dedicatedWorkerUrl?: string | null;
  routes?: {
    claimBaseUrl?: string | null;
    heartbeatBaseUrl?: string | null;
    printingPath?: string;
    ackPath?: string;
    claimPath?: string;
    heartbeatPath?: string;
  };
  pollConfigSeconds?: number;
  serverTime?: string;
  error?: string;
}

export class CloudflareClient {
  private mainBaseUrl: string;
  private token: string;
  private timeoutMs: number;
  private logger: Logger;

  private activeMode: TransportMode = 'in_app';
  private dedicatedWorkerUrl: string | null = null;
  private lastConfigFetchedAt: number = 0;
  private configTtlMs: number;
  private configRefreshPromise: Promise<void> | null = null;

  constructor(params: {
    baseUrl: string;
    token: string;
    timeoutMs: number;
    logger: Logger;
    configRefreshIntervalMs?: number;
  }) {
    this.mainBaseUrl = params.baseUrl.replace(/\/+$/, '');
    this.token = params.token;
    this.timeoutMs = params.timeoutMs;
    this.logger = params.logger;
    this.configTtlMs = Math.max(10000, params.configRefreshIntervalMs || 30000);
  }

  public getTransportState(): { mode: TransportMode; dedicatedWorkerUrl: string | null } {
    return {
      mode: this.activeMode,
      dedicatedWorkerUrl: this.dedicatedWorkerUrl
    };
  }

  private getClaimBaseUrl(): string {
    if (this.activeMode === 'dedicated_worker' && this.dedicatedWorkerUrl) {
      return this.dedicatedWorkerUrl;
    }
    return this.mainBaseUrl;
  }

  private getHeartbeatBaseUrl(): string {
    if (this.activeMode === 'dedicated_worker' && this.dedicatedWorkerUrl) {
      return this.dedicatedWorkerUrl;
    }
    return this.mainBaseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST';
      body?: any;
      timeoutMs?: number;
      baseUrl?: string;
    } = {}
  ): Promise<{ status: number; data: T; retryAfter?: string | null }> {
    const targetBase = (options.baseUrl || this.mainBaseUrl).replace(/\/+$/, '');
    const url = `${targetBase}${endpoint}`;
    const method = options.method || 'POST';
    const timeout = options.timeoutMs || this.timeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        'User-Agent': 'Platoria-Print-Agent/1.0 (Windows)'
      };

      const res = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      const retryAfter = res.headers.get('retry-after');

      let data: any;
      const text = await res.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { ok: false, error: `Malformed response from server (HTTP ${res.status}): ${text.slice(0, 150)}` };
      }

      return { status: res.status, data: data as T, retryAfter };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Request to Platoria API timed out after ${timeout}ms: ${method} ${endpoint}`);
      }
      throw new Error(`Network failure communicating with Platoria API: ${err.message || String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches active transport mode & dedicated Worker URL from the main Platoria app.
   * Never silently falls back from dedicated_worker to in_app on network/server failures.
   */
  public async fetchTransportConfig(): Promise<AgentConfigApiResponse> {
    const res = await this.request<AgentConfigApiResponse>('/api/print-agent/config', {
      method: 'GET',
      baseUrl: this.mainBaseUrl
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Authentication failed (HTTP ${res.status}): Please check PRINT_AGENT_TOKEN`);
    }

    if (res.status >= 500 || !res.data?.ok) {
      throw new Error(res.data?.error || `Failed to load transport config (HTTP ${res.status})`);
    }

    const rawWorkerUrl = (res.data.routes?.claimBaseUrl || res.data.dedicatedWorkerUrl || '').trim().replace(/\/+$/, '');
    const nextMode: TransportMode =
      res.data.mode === 'dedicated_worker' && rawWorkerUrl ? 'dedicated_worker' : 'in_app';

    const modeChanged = nextMode !== this.activeMode || rawWorkerUrl !== (this.dedicatedWorkerUrl || '');

    this.activeMode = nextMode;
    this.dedicatedWorkerUrl = rawWorkerUrl || null;
    this.lastConfigFetchedAt = Date.now();

    if (res.data.pollConfigSeconds && Number.isFinite(res.data.pollConfigSeconds)) {
      this.configTtlMs = Math.max(10000, Math.min(120000, Number(res.data.pollConfigSeconds) * 1000));
    }

    if (modeChanged) {
      this.logger.info(
        `[TRANSPORT CONFIG] Mode=${this.activeMode}${this.dedicatedWorkerUrl ? ` | DedicatedWorker=${this.dedicatedWorkerUrl}` : ''}`
      );
    }

    return res.data;
  }

  /**
   * Refreshes transport configuration when cache TTL expires or when forced (e.g. after HTTP 409).
   * Safe against concurrent refreshes and never downgrades dedicated_worker on transient errors.
   */
  public async ensureFreshConfig(force: boolean = false): Promise<void> {
    const isStale = this.lastConfigFetchedAt === 0 || Date.now() - this.lastConfigFetchedAt >= this.configTtlMs;
    if (!force && !isStale) {
      return;
    }

    if (this.configRefreshPromise) {
      return this.configRefreshPromise;
    }

    this.configRefreshPromise = (async () => {
      try {
        await this.fetchTransportConfig();
      } catch (err: any) {
        this.logger.warn(`Could not refresh transport config from main app (keeping mode=${this.activeMode}): ${err.message}`);
      } finally {
        this.configRefreshPromise = null;
      }
    })();

    return this.configRefreshPromise;
  }

  /**
   * Atomically claims the next pending KOT print job from the active transport endpoint
   */
  public async claimJob(agentId: string): Promise<ClaimApiResponse> {
    await this.ensureFreshConfig(false);

    const claimBaseUrl = this.getClaimBaseUrl();
    const res = await this.request<ClaimApiResponse>('/api/print-agent/claim', {
      method: 'POST',
      body: { agentId },
      baseUrl: claimBaseUrl
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Authentication failed (HTTP ${res.status}): Please check PRINT_AGENT_TOKEN`);
    }

    if (res.status === 409) {
      this.logger.warn(
        `Claim rejected due to transport mode mismatch (HTTP 409, server activeMode=${res.data?.activeMode || 'unknown'}). Refreshing transport config...`
      );
      await this.ensureFreshConfig(true);
      return {
        ok: false,
        job: null,
        activeMode: res.data?.activeMode,
        error: res.data?.error || 'Transport mode changed; refreshed configuration',
        retryAfterSeconds: 1
      };
    }

    if (res.status === 429) {
      const retrySec = res.retryAfter ? parseInt(res.retryAfter, 10) || 5 : 5;
      return { ok: false, job: null, error: 'Rate limited by server', retryAfterSeconds: retrySec };
    }

    if (res.status >= 500) {
      throw new Error(`Platoria server error (HTTP ${res.status}): ${res.data.error || 'Internal server error'}`);
    }

    return res.data;
  }

  /**
   * Reports that the local agent has started generating ESC/POS bytes and opening the spooler
   * Always targets the main Platoria app.
   */
  public async reportPrinting(jobId: string, agentId: string): Promise<PrintingApiResponse> {
    const res = await this.request<PrintingApiResponse>('/api/print-agent/printing', {
      method: 'POST',
      body: { jobId, agentId },
      baseUrl: this.mainBaseUrl
    });

    if (res.status === 409) {
      this.logger.warn(`Printing report rejected (409): ${res.data.error || 'Lease lost or state mismatch'}`);
    }

    return res.data;
  }

  /**
   * Acknowledges print outcome: SUBMITTED, FAILED, or NEEDS_REVIEW
   * Always targets the main Platoria app.
   */
  public async acknowledgeJob(
    jobId: string,
    agentId: string,
    status: 'SUBMITTED' | 'FAILED' | 'NEEDS_REVIEW',
    error?: string
  ): Promise<AckApiResponse> {
    const res = await this.request<AckApiResponse>('/api/print-agent/ack', {
      method: 'POST',
      body: {
        jobId,
        agentId,
        status,
        error: error ? error.slice(0, 500) : undefined
      },
      baseUrl: this.mainBaseUrl
    });

    return res.data;
  }

  /**
   * Sends lightweight heartbeat to the active transport endpoint (in_app or dedicated_worker)
   */
  public async sendHeartbeat(agentId: string, printerStatus: string = 'ONLINE_READY'): Promise<HeartbeatApiResponse> {
    await this.ensureFreshConfig(false);

    const res = await this.request<HeartbeatApiResponse>('/api/print-agent/heartbeat', {
      method: 'POST',
      body: { agentId, printerStatus },
      baseUrl: this.getHeartbeatBaseUrl()
    });

    if (res.status === 409 || (res.data?.activeMode && res.data.activeMode !== this.activeMode)) {
      await this.ensureFreshConfig(true);
    }

    return res.data;
  }

  /**
   * Health check against active transport endpoint
   */
  public async checkHealth(): Promise<HealthApiResponse> {
    const res = await this.request<HealthApiResponse>('/api/print-agent/health', {
      method: 'GET',
      baseUrl: this.getClaimBaseUrl()
    });
    return res.data;
  }
}
