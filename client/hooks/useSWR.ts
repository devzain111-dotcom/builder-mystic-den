import { useEffect, useRef, useState, useCallback } from "react";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  isRevalidating: boolean;
}

// Global cache storage (persists across component mounts)
const globalCache = new Map<string, CacheEntry<any>>();
const revalidationCallbacks = new Map<string, Set<() => void>>();

export interface SWRConfig {
  revalidateInterval?: number; // How often to revalidate (ms)
  revalidateOnFocus?: boolean; // Revalidate when tab regains focus
  dedupingInterval?: number; // Dedupe requests within this time (ms)
}

export interface SWRResult<T> {
  data: T | null;
  isLoading: boolean;
  isValidating: boolean;
  error: Error | null;
  mutate: (newData: T | Promise<T>) => Promise<void>;
  invalidate: () => void;
}

const DEFAULT_CONFIG: SWRConfig = {
  revalidateInterval: 5 * 60 * 1000, // 5 minutes
  revalidateOnFocus: true,
  dedupingInterval: 2000, // 2 seconds
};

export function useSWR<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  config: SWRConfig = {},
): SWRResult<T> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const [state, setState] = useState<{
    data: T | null;
    isLoading: boolean;
    isValidating: boolean;
    error: Error | null;
  }>(() => {
    // Initialize with cached data if available
    if (key && globalCache.has(key)) {
      const cached = globalCache.get(key);
      return {
        data: cached!.data,
        isLoading: false,
        isValidating: false,
        error: null,
      };
    }
    return {
      data: null,
      isLoading: !globalCache.has(key || ""),
      isValidating: false,
      error: null,
    };
  });

  const revalidationTimeoutRef = useRef<NodeJS.Timeout>();
  const isFirstMountRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);

  // Revalidate function
  const revalidate = useCallback(async () => {
    if (!key) return;

    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTimeRef.current;

    // Dedup: don't revalidate if we just fetched
    if (timeSinceLastFetch < finalConfig.dedupingInterval!) {
      console.log(
        `[SWR] Deduping ${key} - fetched ${timeSinceLastFetch}ms ago`,
      );
      return;
    }

    setState((prev) => ({ ...prev, isValidating: true }));

    try {
      console.log(`[SWR] Revalidating ${key}...`);
      const data = await fetcher();
      lastFetchTimeRef.current = Date.now();

      // Update cache and state
      globalCache.set(key, {
        data,
        timestamp: Date.now(),
        isRevalidating: false,
      });

      setState({
        data,
        isLoading: false,
        isValidating: false,
        error: null,
      });

      // Notify other hooks using the same key
      const callbacks = revalidationCallbacks.get(key);
      if (callbacks) {
        callbacks.forEach((cb) => cb());
      }

      console.log(`[SWR] ✓ Revalidated ${key}`);
    } catch (err: any) {
      console.error(`[SWR] Error revalidating ${key}:`, err?.message);
      setState((prev) => ({
        ...prev,
        isValidating: false,
        error: err,
      }));
    }
  }, [key, fetcher, finalConfig]);

  // Initial fetch
  useEffect(() => {
    if (!key) return;

    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;

      // Check if we have cached data
      if (globalCache.has(key)) {
        console.log(`[SWR] Using cached data for ${key}`);
        const cached = globalCache.get(key);
        setState({
          data: cached!.data,
          isLoading: false,
          isValidating: false,
          error: null,
        });
        // Revalidate in background
        setTimeout(() => revalidate(), 0);
      } else {
        // No cache, fetch immediately
        console.log(`[SWR] No cache for ${key}, fetching...`);
        revalidate();
      }
    }
  }, [key, revalidate]);

  // Periodic revalidation
  useEffect(() => {
    if (!key) return;

    const scheduleRevalidation = () => {
      revalidationTimeoutRef.current = setTimeout(() => {
        revalidate();
        scheduleRevalidation();
      }, finalConfig.revalidateInterval!);
    };

    scheduleRevalidation();

    return () => {
      if (revalidationTimeoutRef.current) {
        clearTimeout(revalidationTimeoutRef.current);
      }
    };
  }, [key, revalidate, finalConfig.revalidateInterval]);

  // Revalidate on window focus
  useEffect(() => {
    if (!key || !finalConfig.revalidateOnFocus) return;

    const handleFocus = () => {
      console.log(`[SWR] Window focused, revalidating ${key}`);
      revalidate();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [key, revalidate, finalConfig.revalidateOnFocus]);

  // Mutate function (update cache and state)
  const mutate = useCallback(
    async (newData: T | Promise<T>) => {
      if (!key) return;

      try {
        const data = newData instanceof Promise ? await newData : newData;

        globalCache.set(key, {
          data,
          timestamp: Date.now(),
          isRevalidating: false,
        });

        setState({
          data,
          isLoading: false,
          isValidating: false,
          error: null,
        });

        console.log(`[SWR] Mutated ${key}`);
      } catch (err: any) {
        console.error(`[SWR] Mutation error for ${key}:`, err?.message);
      }
    },
    [key],
  );

  // Invalidate function (clear cache and refetch)
  const invalidate = useCallback(() => {
    if (!key) return;

    console.log(`[SWR] Invalidating ${key}`);
    globalCache.delete(key);
    revalidate();
  }, [key, revalidate]);

  return {
    data: state.data,
    isLoading: state.isLoading,
    isValidating: state.isValidating,
    error: state.error,
    mutate,
    invalidate,
  };
}

// Utility to invalidate cache from outside components
export function invalidateSWRKey(key: string) {
  console.log(`[SWR] Invalidating key: ${key}`);
  globalCache.delete(key);
}

// Utility to manually set cache
export function setSWRCache<T>(key: string, data: T) {
  console.log(`[SWR] Setting cache for ${key}`);
  globalCache.set(key, {
    data,
    timestamp: Date.now(),
    isRevalidating: false,
  });
}
