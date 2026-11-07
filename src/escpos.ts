/**
 * PLATORIA PRINT AGENT — ESC/POS BYTE BUILDER
 * ============================================
 * Pure Buffer ESC/POS command generator for 80mm thermal printers.
 * Calibrated for TVS RP 3220 Star (48 characters/line Font A).
 */

export const ESC = 0x1b;
export const GS = 0x1d;
export const LF = 0x0a;

export type Alignment = 'left' | 'center' | 'right';

export interface EscPosOptions {
  columns?: number;
}

export class EscPosBuilder {
  private chunks: Buffer[] = [];
  public readonly columns: number;

  constructor(options: EscPosOptions = {}) {
    this.columns = options.columns || 48; // Standard 80mm thermal width (Font A)
  }

  /**
   * Appends raw bytes to the buffer
   */
  public raw(bytes: number[] | Buffer): this {
    if (Buffer.isBuffer(bytes)) {
      this.chunks.push(bytes);
    } else {
      this.chunks.push(Buffer.from(bytes));
    }
    return this;
  }

  /**
   * Initializes printer (ESC @) - clears print buffer, resets modes
   */
  public init(): this {
    return this.raw([ESC, 0x40]);
  }

  /**
   * Sets text alignment (ESC a n: 0 = left, 1 = center, 2 = right)
   */
  public align(alignment: Alignment): this {
    const val = alignment === 'center' ? 1 : alignment === 'right' ? 2 : 0;
    return this.raw([ESC, 0x61, val]);
  }

  /**
   * Sets bold / emphasized printing (ESC E n: 1 = on, 0 = off)
   */
  public bold(enabled: boolean = true): this {
    return this.raw([ESC, 0x45, enabled ? 1 : 0]);
  }

  /**
   * Sets underline (ESC - n: 0 = off, 1 = 1-dot, 2 = 2-dots)
   */
  public underline(mode: 0 | 1 | 2 = 1): this {
    return this.raw([ESC, 0x2d, mode]);
  }

  /**
   * Sets character size (GS ! n)
   * Bits 0-3: height multiplier (0 = normal, 1 = 2x, etc.)
   * Bits 4-7: width multiplier (0 = normal, 1 = 2x, etc.)
   */
  public size(widthMult: 1 | 2 | 3 | 4 = 1, heightMult: 1 | 2 | 3 | 4 = 1): this {
    const w = Math.max(0, widthMult - 1);
    const h = Math.max(0, heightMult - 1);
    const byte = (w << 4) | h;
    return this.raw([GS, 0x21, byte]);
  }

  /**
   * Resets text size to normal (1x width, 1x height)
   */
  public normalSize(): this {
    return this.size(1, 1);
  }

  /**
   * Safe string sanitizer: transliterates and removes non-printable/garbled characters
   */
  public static sanitizeAscii(text: string): string {
    if (!text) return '';
    return text
      .normalize('NFD') // separate accents
      .replace(/[\u0300-\u036f]/g, '') // remove accent diacritics
      .replace(/[₹]/g, 'Rs. ') // replace Rupee symbol with readable ASCII
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, '-')
      .replace(/[•]/g, '*')
      .replace(/[^\x20-\x7E\r\n]/g, ' '); // remove unsupported non-ASCII characters
  }

  /**
   * Writes text encoded as ASCII/CP437
   */
  public text(str: string): this {
    const sanitized = EscPosBuilder.sanitizeAscii(str);
    return this.raw(Buffer.from(sanitized, 'ascii'));
  }

  /**
   * Writes text followed by a Line Feed (LF)
   */
  public textLine(str: string = ''): this {
    return this.text(str).lineFeed();
  }

  /**
   * Emits n line feeds (LF)
   */
  public lineFeed(count: number = 1): this {
    for (let i = 0; i < count; i++) {
      this.raw([LF]);
    }
    return this;
  }

  /**
   * Prints and feeds n lines (ESC d n)
   */
  public feed(lines: number = 3): this {
    return this.raw([ESC, 0x64, Math.max(1, lines)]);
  }

  /**
   * Full or partial cut (GS V m: 65 = full cut, 66 = partial cut)
   */
  public cut(partial: boolean = true): this {
    // 0x42 = 66 (partial cut with 1 point left uncut, safe for thermal printers)
    // 0x41 = 65 (full cut)
    const m = partial ? 0x42 : 0x41;
    return this.raw([GS, 0x56, m, 0x00]);
  }

  /**
   * Draws a divider line of exact column width
   */
  public divider(char: '-' | '=' | '*' = '-'): this {
    return this.align('left').textLine(char.repeat(this.columns));
  }

  /**
   * Formats a two-column row with left text and right text pushed to the margins
   * e.g. "KOT #: 1042"                     "Time: 01:24 PM"
   */
  public rowTwoColumns(left: string, right: string, width: number = this.columns): this {
    const cleanLeft = EscPosBuilder.sanitizeAscii(left);
    const cleanRight = EscPosBuilder.sanitizeAscii(right);

    const spaceCount = Math.max(1, width - cleanLeft.length - cleanRight.length);
    const line = cleanLeft + ' '.repeat(spaceCount) + cleanRight;
    return this.align('left').textLine(line);
  }

  /**
   * Word wraps text into lines of max width
   */
  public static wrapText(text: string, maxWidth: number): string[] {
    const words = EscPosBuilder.sanitizeAscii(text).trim().split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (!currentLine) {
        if (word.length <= maxWidth) {
          currentLine = word;
        } else {
          // Word longer than max width: break it
          for (let i = 0; i < word.length; i += maxWidth) {
            lines.push(word.slice(i, i + maxWidth));
          }
        }
      } else if (currentLine.length + 1 + word.length <= maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        if (word.length <= maxWidth) {
          currentLine = word;
        } else {
          for (let i = 0; i < word.length; i += maxWidth) {
            const chunk = word.slice(i, i + maxWidth);
            if (chunk.length === maxWidth) {
              lines.push(chunk);
            } else {
              currentLine = chunk;
            }
          }
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  }

  /**
   * Compiles all chunks into a single Buffer
   */
  public build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
