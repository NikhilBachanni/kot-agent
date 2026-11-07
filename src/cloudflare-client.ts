/**
 * PLATORIA PRINT AGENT — CLOUDFLARE API CLIENT
 * =============================================
 * Typed client for Platoria Cloudflare Worker Print-Agent API.
 * Conforms to docs/PRINT_AGENT_PROTOCOL.md.
 */

import { ClaimedJob } from './payload-validator';
import { Logger } from './logger';

export interface ClaimApiResponse {
  ok: boolean;
  job: ClaimedJob | null;
  message?: string;
  error?: string;
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
  serverTime?: string;
  error?: string;
}

export interface HealthApiResponse {
  ok: boolean;
  status?: string;
  queue?: Record<string, number>;
  timestamp?: string;
  error?: string;
}

export class CloudflareClient {
  private baseUrl: string;
  private token: string;
  private timeoutMs: number;
  private logger: Logger;

  constructor(params: {
    baseUrl: string;
    token: string;
    timeoutMs: number;
    logger: Logger;
  }) {
    this.baseUrl = params.baseUrl.replace(/\/+$/, '');
    this.token = params.token;
    this.timeoutMs = params.timeoutMs;
    this.logger = params.logger;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST';
      body?: any;
      timeoutMs?: number;
    } = {}
  ): Promise<{ status: number; data: T; retryAfter?: string | null }> {
    const url = `${this.baseUrl}${endpoint}`;
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
   * Atomically claims the next pending KOT print job
   */
  public async claimJob(agentId: string): Promise<ClaimApiResponse> {
    const res = await this.request<ClaimApiResponse>('/api/print-agent/claim', {
      method: 'POST',
      body: { agentId }
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Authentication failed (HTTP ${res.status}): Please check PRINT_AGENT_TOKEN`);
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
   */
  public async reportPrinting(jobId: string, agentId: string): Promise<PrintingApiResponse> {
    const res = await this.request<PrintingApiResponse>('/api/print-agent/printing', {
      method: 'POST',
      body: { jobId, agentId }
    });

    if (res.status === 409) {
      this.logger.warn(`Printing report rejected (409): ${res.data.error || 'Lease lost or state mismatch'}`);
    }

    return res.data;
  }

  /**
   * Acknowledges print outcome: SUBMITTED, FAILED, or NEEDS_REVIEW
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
      }
    });

    return res.data;
  }

  /**
   * Sends heartbeat
   */
  public async sendHeartbeat(agentId: string, printerStatus: string = 'ONLINE_READY'): Promise<HeartbeatApiResponse> {
    const res = await this.request<HeartbeatApiResponse>('/api/print-agent/heartbeat', {
      method: 'POST',
      body: { agentId, printerStatus }
    });
    return res.data;
  }

  /**
   * Health check
   */
  public async checkHealth(): Promise<HealthApiResponse> {
    const res = await this.request<HealthApiResponse>('/api/print-agent/health', {
      method: 'GET'
    });
    return res.data;
  }
}
