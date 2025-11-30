// Global SWR cache for branch workers data
const swrCache: Record<string, { data: any; timestamp: number }> = {};

export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getSWRCache(branchId: string) {
  const cached = swrCache[branchId];
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL) {
    delete swrCache[branchId];
    return null;
  }

  return cached.data;
}

export function setSWRCache(branchId: string, data: any) {
  swrCache[branchId] = {
    data,
    timestamp: Date.now(),
  };
  console.log(`[SWR] Cache set for branch ${branchId.slice(0, 8)}`);
}

export function invalidateSWRCache(branchId?: string) {
  if (branchId) {
    delete swrCache[branchId];
    console.log(`[SWR] Invalidated cache for branch ${branchId.slice(0, 8)}`);
  } else {
    Object.keys(swrCache).forEach((key) => delete swrCache[key]);
    console.log(`[SWR] Invalidated all caches`);
  }
}

export function getSWRCacheKeys() {
  return Object.keys(swrCache);
}
