import { useState, useEffect } from "react";

interface PaginatedWorkerResponse {
  ok: boolean;
  workers: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface UsePaginatedWorkersOptions {
  branchId?: string;
  page?: number;
  pageSize?: number;
}

export function usePaginatedWorkers({
  branchId,
  page = 1,
  pageSize = 50,
}: UsePaginatedWorkersOptions) {
  const [data, setData] = useState<PaginatedWorkerResponse>({
    ok: false,
    workers: [],
    total: 0,
    page,
    pageSize,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId) {
      setData({
        ok: false,
        workers: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
      });
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const url = new URL(`/api/workers/branch/${branchId}`, window.location.origin);
        url.searchParams.set("page", page.toString());
        url.searchParams.set("pageSize", pageSize.toString());

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error("Failed to fetch workers");
        }

        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setData({
          ok: false,
          workers: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [branchId, page, pageSize]);

  return { data, loading, error };
}
