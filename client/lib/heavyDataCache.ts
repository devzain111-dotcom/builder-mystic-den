/**
 * Advanced caching for heavy queries that consume excessive memory
 * Solves the Out of Memory issue by reducing repeated queries for:
 * - Timezone data
 * - Payment records (hv_payments)
 * - Worker verifications
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  etag?: string;
}

class HeavyDataCache {
  private cache = new Map<string, CacheEntry<any>>();
  private timezoneCache: string | null = null;
  private timezoneCacheTime = 0;
  private readonly TIMEZONE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly PAYMENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly WORKER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  /**
   * Get cached timezone to avoid repeated pg_timezone_names queries
   * Cache for 24 hours since timezones rarely change
   */
  getTimezone(): string {
    const now = Date.now();
    if (
      this.timezoneCache &&
      now - this.timezoneCacheTime < this.TIMEZONE_CACHE_TTL
    ) {
      return this.timezoneCache;
    }

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      this.timezoneCache = tz;
      this.timezoneCacheTime = now;
      return tz;
    } catch {
      return "UTC";
    }
  }

  /**
   * Get cached data with TTL validation
   */
  get<T>(key: string, maxAge: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cache entry with optional etag
   */
  set<T>(key: string, data: T, etag?: string): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      etag,
    });
  }

  /**
   * Get payment records from cache
   * Uses branch + worker IDs as key to allow fine-grained caching
   */
  getPayments(branchId: string, workerId?: string): any[] | null {
    const key = `payments:${branchId}:${workerId || "all"}`;
    return this.get(key, this.PAYMENT_CACHE_TTL);
  }

  /**
   * Cache payment records
   */
  setPayments(
    branchId: string,
    payments: any[],
    workerId?: string,
    etag?: string,
  ): void {
    const key = `payments:${branchId}:${workerId || "all"}`;
    this.set(key, payments, etag);
  }

  /**
   * Get worker data from cache
   */
  getWorkers(branchId: string): any[] | null {
    const key = `workers:${branchId}`;
    return this.get(key, this.WORKER_CACHE_TTL);
  }

  /**
   * Cache worker data
   */
  setWorkers(branchId: string, workers: any[], etag?: string): void {
    const key = `workers:${branchId}`;
    this.set(key, workers, etag);
  }

  /**
   * Invalidate all payment caches for a branch
   */
  invalidatePayments(branchId: string): void {
    const keys = Array.from(this.cache.keys());
    keys.forEach((key) => {
      if (key.startsWith(`payments:${branchId}:`)) {
        this.cache.delete(key);
      }
    });
  }

  /**
   * Invalidate all worker caches for a branch
   */
  invalidateWorkers(branchId: string): void {
    this.cache.delete(`workers:${branchId}`);
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.cache.clear();
    this.timezoneCache = null;
    this.timezoneCacheTime = 0;
  }

  /**
   * Get cache statistics for monitoring
   */
  getStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

// Export singleton instance
export const heavyDataCache = new HeavyDataCache();
