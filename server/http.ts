/** Contact transmis aux services OSM (politique d'usage : User-Agent identifiable). */
export const USER_AGENT = `FouleeFrance/1.0 (${
  process.env.APP_CONTACT || 'https://github.com/Visitune/fouleefr'
})`;

export class UpstreamError extends Error {
  constructor(
    public service: string,
    message: string
  ) {
    super(`${service}: ${message}`);
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface CacheEntry<T> {
  expires: number;
  value: T;
}

/** Cache mémoire TTL (par instance serveur). Les échecs ne sont jamais mis en cache. */
export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  constructor(
    private ttlMs: number,
    private maxEntries = 200
  ) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

/** Limiteur de débit en mémoire (fenêtre glissante, par clé). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }
}
