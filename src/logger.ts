/**
 * PLATORIA PRINT AGENT — STRUCTURED LOGGING MODULE
 * =================================================
 * Structured console and daily rotating file logger.
 * Automatically redacts device secrets, Authorization headers, and PII.
 */

import fs from 'fs';
import path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  private level: LogLevel;
  private logDir: string;
  private tokenToRedact: string | null = null;
  private currentLogDate: string = '';
  private currentLogStream: fs.WriteStream | null = null;

  constructor(level: LogLevel = 'info', logDir: string = 'logs', token?: string) {
    this.level = level;
    this.logDir = path.isAbsolute(logDir) ? logDir : path.resolve(process.cwd(), logDir);
    if (token && token.trim()) {
      this.tokenToRedact = token.trim();
    }
    this.ensureLogDir();
  }

  public setTokenToRedact(token: string) {
    if (token && token.trim()) {
      this.tokenToRedact = token.trim();
    }
  }

  private ensureLogDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (e) {
      console.error(`[LOGGER] Failed to create log directory ${this.logDir}:`, e);
    }
  }

  private getLogStream(): fs.WriteStream | null {
    const today = new Date().toISOString().split('T')[0];
    if (this.currentLogDate !== today || !this.currentLogStream) {
      if (this.currentLogStream) {
        try {
          this.currentLogStream.end();
        } catch {}
      }
      this.currentLogDate = today;
      const logFilePath = path.join(this.logDir, `agent-${today}.log`);
      try {
        this.currentLogStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf8' });
      } catch (err) {
        console.error(`[LOGGER] Could not open log file ${logFilePath}:`, err);
        this.currentLogStream = null;
      }
    }
    return this.currentLogStream;
  }

  /**
   * Sanitizes text: redacts secret tokens, auth headers, and customer phone digits
   */
  public sanitize(text: string): string {
    if (!text) return '';
    let out = text;

    // Redact dedicated token
    if (this.tokenToRedact && this.tokenToRedact.length > 4) {
      out = out.split(this.tokenToRedact).join('[REDACTED_DEVICE_TOKEN]');
    }

    // Redact Bearer headers
    out = out.replace(/Bearer\s+[A-Za-z0-9_\-\.\~]+/gi, 'Bearer [REDACTED_TOKEN]');

    // Redact 10-digit phone numbers: +91 98765 43210 -> +91 ***** 43210
    out = out.replace(/(\+?91[\s\-]?)?([6-9]\d{4})[\s\-]?(\d{5})/g, '+91 ***** $3');

    return out;
  }

  private write(level: LogLevel, message: string, meta?: any) {
    if (LOG_SEVERITY[level] < LOG_SEVERITY[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    let metaStr = '';
    if (meta !== undefined) {
      if (meta instanceof Error) {
        metaStr = ` ${meta.stack || meta.message}`;
      } else if (typeof meta === 'object') {
        try {
          metaStr = ` ${JSON.stringify(meta)}`;
        } catch {
          metaStr = ` [Circular]`;
        }
      } else {
        metaStr = ` ${meta}`;
      }
    }

    const sanitizedMessage = this.sanitize(`${message}${metaStr}`);
    const consolePrefix = `[${timestamp}] [${level.toUpperCase()}]`;

    // 1. Console Output
    switch (level) {
      case 'debug':
        console.debug(`${consolePrefix} ${sanitizedMessage}`);
        break;
      case 'info':
        console.info(`${consolePrefix} ${sanitizedMessage}`);
        break;
      case 'warn':
        console.warn(`${consolePrefix} ${sanitizedMessage}`);
        break;
      case 'error':
        console.error(`${consolePrefix} ${sanitizedMessage}`);
        break;
    }

    // 2. File Output
    const stream = this.getLogStream();
    if (stream) {
      try {
        stream.write(`${consolePrefix} ${sanitizedMessage}\n`);
      } catch {}
    }
  }

  public debug(message: string, meta?: any) {
    this.write('debug', message, meta);
  }

  public info(message: string, meta?: any) {
    this.write('info', message, meta);
  }

  public warn(message: string, meta?: any) {
    this.write('warn', message, meta);
  }

  public error(message: string, meta?: any) {
    this.write('error', message, meta);
  }

  public close() {
    if (this.currentLogStream) {
      try {
        this.currentLogStream.end();
      } catch {}
      this.currentLogStream = null;
    }
  }
}
