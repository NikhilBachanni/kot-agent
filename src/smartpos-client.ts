/**
 * PLATORIA PRINT AGENT — SMARTPOS PRINT BRIDGE CLIENT
 * ====================================================
 * Communicates with the local Windows SmartPOS Print Bridge on 127.0.0.1.
 * Supports configurable base URL, automatic port discovery, and printer verification.
 */

import { Logger } from './logger';

export interface SmartPosPrintResult {
  ok: boolean;
  isAmbiguous?: boolean;
  message?: string;
  error?: string;
  rawResponse?: any;
}

export interface SmartPosHealthResult {
  ok: boolean;
  url: string;
  printers: string[];
  error?: string;
}

export class SmartPosClient {
  private activeBaseUrl: string;
  private candidatePorts: number[];
  private autoPortDiscovery: boolean;
  private timeoutMs: number;
  private logger: Logger;

  constructor(params: {
    baseUrl: string;
    autoPortDiscovery?: boolean;
    candidatePorts?: number[];
    timeoutMs?: number;
    logger: Logger;
  }) {
    this.activeBaseUrl = params.baseUrl.replace(/\/+$/, '');
    this.autoPortDiscovery = params.autoPortDiscovery ?? true;
    this.candidatePorts = params.candidatePorts && params.candidatePorts.length > 0
      ? params.candidatePorts
      : [8003, 8000, 8080, 8888, 9100];
    this.timeoutMs = params.timeoutMs ?? 6000;
    this.logger = params.logger;
  }

  public getActiveBaseUrl(): string {
    return this.activeBaseUrl;
  }

  /**
   * Internal fetch helper with timeout
   */
  private async request(
    url: string,
    options: {
      method?: 'GET' | 'POST';
      body?: any;
      timeoutMs?: number;
    } = {}
  ): Promise<{ status: number; text: string; data?: any }> {
    const method = options.method || 'GET';
    const timeout = options.timeoutMs || this.timeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*'
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      const text = await res.text();
      let data: any = undefined;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {}

      return { status: res.status, text, data };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Queries bridge health and printer list on a specific base URL
   */
  private async testBridgeUrl(baseUrl: string): Promise<SmartPosHealthResult> {
    const endpoints = ['/printers', '/status', '/health', '/'];

    for (const ep of endpoints) {
      try {
        const res = await this.request(`${baseUrl}${ep}`, { method: 'GET', timeoutMs: 2000 });
        if (res.status >= 200 && res.status < 300) {
          let printers: string[] = [];

          if (Array.isArray(res.data)) {
            printers = res.data.map((p) => (typeof p === 'string' ? p : p.name || JSON.stringify(p)));
          } else if (res.data && typeof res.data === 'object') {
            if (Array.isArray(res.data.printers)) {
              printers = res.data.printers.map((p: any) => (typeof p === 'string' ? p : p.name || ''));
            } else if (Array.isArray(res.data.data)) {
              printers = res.data.data.map((p: any) => (typeof p === 'string' ? p : p.name || ''));
            }
          }

          return { ok: true, url: baseUrl, printers };
        }
      } catch {
        // Continue trying endpoints or ports
      }
    }

    return { ok: false, url: baseUrl, printers: [], error: `No response on ${baseUrl}` };
  }

  /**
   * Discovers the actual listening SmartPOS bridge port
   */
  public async discoverBridge(): Promise<SmartPosHealthResult> {
    // 1. First test configured activeBaseUrl
    this.logger.debug(`Testing primary SmartPOS URL: ${this.activeBaseUrl}`);
    const primaryTest = await this.testBridgeUrl(this.activeBaseUrl);
    if (primaryTest.ok) {
      return primaryTest;
    }

    // 2. If auto-discovery enabled, scan candidate ports
    if (this.autoPortDiscovery) {
      this.logger.info(`Primary SmartPOS URL ${this.activeBaseUrl} not responding. Scanning candidate ports...`);
      for (const port of this.candidatePorts) {
        const candidateUrl = `http://127.0.0.1:${port}`;
        if (candidateUrl === this.activeBaseUrl) continue;

        const result = await this.testBridgeUrl(candidateUrl);
        if (result.ok) {
          this.logger.info(`✓ Discovered SmartPOS Print Bridge on ${candidateUrl}`);
          this.activeBaseUrl = candidateUrl;
          return result;
        }
      }
    }

    return {
      ok: false,
      url: this.activeBaseUrl,
      printers: [],
      error: `SmartPOS Print Bridge is not responding on 127.0.0.1. Please ensure SmartPOS Print Bridge is installed and running.`
    };
  }

  /**
   * Verifies if the configured Windows printer exists
   */
  public async verifyPrinter(printerName: string): Promise<{ available: boolean; installedPrinters: string[] }> {
    const health = await this.discoverBridge();
    if (!health.ok) {
      return { available: false, installedPrinters: [] };
    }

    if (health.printers.length === 0) {
      // Bridge responded but didn't return a list (some bridges accept direct names without enumeration)
      return { available: true, installedPrinters: [] };
    }

    const targetLower = printerName.toLowerCase().trim();
    const match = health.printers.find((p) => p.toLowerCase().trim() === targetLower);

    return {
      available: Boolean(match),
      installedPrinters: health.printers
    };
  }

  /**
   * Submits ESC/POS binary data to the local Windows printer via SmartPOS
   */
  public async printEscpos(printerName: string, bytes: Buffer): Promise<SmartPosPrintResult> {
    const base64Data = bytes.toString('base64');
    const url = `${this.activeBaseUrl}/print`;

    // Standard cross-compatible SmartPOS print request payload
    const body = {
      printer: printerName,
      data: base64Data,
      dataBase64: base64Data,
      type: 'raw',
      raw: true
    };

    let dispatchStarted = false;

    try {
      dispatchStarted = true;
      const res = await this.request(url, {
        method: 'POST',
        body,
        timeoutMs: this.timeoutMs
      });

      // 1. Success cases
      if (res.status >= 200 && res.status < 300) {
        const data = res.data;
        if (data && typeof data === 'object') {
          if (data.success === false || data.ok === false || data.status === 'error') {
            return {
              ok: false,
              isAmbiguous: false,
              error: data.error || data.message || 'SmartPOS bridge rejected print request',
              rawResponse: data
            };
          }
        }
        return {
          ok: true,
          message: 'Print job accepted by Windows spooler via SmartPOS bridge',
          rawResponse: data || res.text
        };
      }

      // 2. Definite 4xx / 5xx error
      const errMsg = res.data?.error || res.data?.message || `SmartPOS returned HTTP ${res.status}: ${res.text.slice(0, 150)}`;
      return {
        ok: false,
        isAmbiguous: false,
        error: errMsg,
        rawResponse: res.data
      };
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError' || String(err.message).toLowerCase().includes('timeout');

      if (dispatchStarted && isTimeout) {
        // Request was sent, but response timed out: ambiguous!
        return {
          ok: false,
          isAmbiguous: true,
          error: `SmartPOS request timed out after submission (${this.timeoutMs}ms). Physical print outcome is uncertain.`
        };
      }

      return {
        ok: false,
        isAmbiguous: false,
        error: `Could not connect to SmartPOS Print Bridge on ${url}: ${err.message || String(err)}`
      };
    }
  }
}
