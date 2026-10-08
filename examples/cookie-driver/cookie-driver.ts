import { BaseStorageDriver } from '@dariushstony/smart-storage';
import type { BaseStorageDriverOptions } from '@dariushstony/smart-storage';

interface CookieDriverOptions extends BaseStorageDriverOptions {
  /** Days until the cookie expires. Default 365. */
  maxAgeDays?: number;
}

// Browsers keep at most about 4 KB per cookie (name, value and attributes).
const MAX_COOKIE_LENGTH = 4096;

/**
 * Stores each vault in one cookie. A teaching example of a custom driver:
 * cookies travel with every HTTP request, so prefer localStorage in real
 * apps.
 */
class CookieDriver extends BaseStorageDriver {
  override readonly name = 'cookie';
  private readonly maxAgeSeconds: number;

  constructor(options: CookieDriverOptions = {}) {
    super(options);
    // Throwing here makes a registered factory fall back to memory on the server.
    if (typeof document === 'undefined') {
      throw new Error('CookieDriver needs a browser document.');
    }
    this.maxAgeSeconds = Math.round((options.maxAgeDays ?? 365) * 86_400);
  }

  protected override readRaw(key: string): string | null {
    const name = encodeURIComponent(key);
    for (const part of document.cookie.split('; ')) {
      const separator = part.indexOf('=');
      if (separator > 0 && part.slice(0, separator) === name) {
        return decodeURIComponent(part.slice(separator + 1));
      }
    }
    return null;
  }

  protected override writeRaw(key: string, value: string): void {
    const cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=/; max-age=${String(this.maxAgeSeconds)}; SameSite=Lax`;
    if (cookie.length > MAX_COOKIE_LENGTH) {
      // Named like the browser's own quota error, so the vault turns it into
      // StorageQuotaError.
      throw new DOMException(
        `The cookie for "${key}" would be ${String(cookie.length)} characters; browsers keep at most ${String(MAX_COOKIE_LENGTH)}.`,
        'QuotaExceededError'
      );
    }
    document.cookie = cookie;
  }

  protected override removeRaw(key: string): void {
    // Both attributes: some engines ignore max-age=0 but honour a past date.
    document.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  }
}

export { CookieDriver };
export type { CookieDriverOptions };
