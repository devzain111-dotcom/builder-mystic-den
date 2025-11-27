import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
} from "react";
import { isNoExpensePolicyLocked } from "@/lib/utils";

export interface Branch {
  id: string;
  name: string;
  residencyRate?: number;
  verificationAmount?: number;
}
export type WorkerStatus = "active" | "exited" | "unlock_requested";
export type WorkerPlan = "with_expense" | "no_expense";
export type MainSystemStatus =
  | "deployed"
  | "unfit"
  | "backout"
  | "selected"
  | "repat"
  | "rtw"
  | "passporting"
  | "for_deployment"
  | "oce_released"
  | "visa_stamp"
  | "cancelled"
  | "for_contract_sig";

export interface WorkerDocs {
  or?: string;
  passport?: string;
  avatar?: string;
  plan?: WorkerPlan;
  assignedArea?: string;
  pre_change?: {
    days: number;
    rate: number;
    cost: number;
    at?: string;
    verification_id?: string;
  } | null;
}
export interface Worker {
  id: string;
  name: string;
  arrivalDate: number;
  branchId: string;
  verifications: Verification[];
  docs?: WorkerDocs;
  exitDate?: number | null;
  exitReason?: string | null;
  status?: WorkerStatus;
  plan?: WorkerPlan;
  housingSystemStatus?: string;
  mainSystemStatus?: MainSystemStatus;
}
export interface Verification {
  id: string;
  workerId: string;
  verifiedAt: number;
  payment?: { amount: number; savedAt: number };
}

export const SPECIAL_REQ_GRACE_MS = 72 * 60 * 60 * 1000;
interface SpecialRequest {
  id: string;
  type: "worker" | "admin" | "unlock";
  createdAt: number;
  amount: number;
  workerId?: string;
  workerName?: string;
  adminRepName?: string;
  imageDataUrl?: string;
  attachmentDataUrl?: string;
  attachmentName?: string;
  attachmentMime?: string;
  unregistered?: boolean;
  branchId?: string;
  decision?: "approved" | "rejected";
  handledAt?: number;
}

interface WorkersState {
  branches: Record<string, Branch>;
  workers: Record<string, Worker>;
  sessionPendingIds: string[];
  sessionVerifications: Verification[];
  selectedBranchId: string | null;
  setSelectedBranchId: (id: string | null) => void;
  addBranch: (name: string) => Branch;
  createBranch?: (name: string, password: string) => Promise<Branch | null>;
  getOrCreateBranchId: (name: string) => string;
  addWorker: (
    name: string,
    arrivalDate: number,
    branchId: string,
    docs?: WorkerDocs,
    plan?: WorkerPlan,
  ) => Worker;
  addLocalWorker: (
    id: string,
    name: string,
    arrivalDate: number,
    branchId: string,
    docs?: WorkerDocs,
    plan?: WorkerPlan,
  ) => Worker;
  addWorkersBulk: (
    items: {
      name: string;
      arrivalDate: number;
      branchName?: string;
      branchId?: string;
      plan?: WorkerPlan;
    }[],
  ) => void;
  addVerification: (
    workerId: string,
    verifiedAt: number,
  ) => Verification | null;
  savePayment: (verificationId: string, amount: number) => void;
  upsertExternalWorker: (w: {
    id: string;
    name: string;
    arrivalDate: number;
    branchId: string;
    docs?: WorkerDocs;
    exitDate?: number | null;
    exitReason?: string | null;
    status?: WorkerStatus;
    plan?: WorkerPlan;
    housingSystemStatus?: string;
    mainSystemStatus?: MainSystemStatus;
  }) => void;
  updateWorkerDocs: (workerId: string, patch: Partial<WorkerDocs>) => void;
  updateWorkerStatuses: (
    workerId: string,
    housingSystemStatus?: string,
    mainSystemStatus?: MainSystemStatus,
  ) => void;
  specialRequests: SpecialRequest[];
  addSpecialRequest: (
    req: Omit<SpecialRequest, "id" | "createdAt"> & { createdAt?: number },
  ) => SpecialRequest;
  setWorkerExit: (
    workerId: string,
    exitDate: number | null,
    reason?: string | null,
  ) => void;
  requestUnlock: (workerId: string) => SpecialRequest | null;
  decideUnlock: (requestId: string, approve: boolean) => void;
  resolveWorkerRequest: (requestId: string, workerId: string) => void;
}

const WorkersContext = createContext<WorkersState | null>(null);

const LS_KEY = "hv_state_v1";
const BRANCH_KEY = "hv_selected_branch";
const WORKERS_SYNC_KEY = "hv_workers_sync_timestamp"; // Store last sync time for delta updates
const REQUEST_CACHE_DURATION = 300000; // 5 minutes - reasonable cache to prevent repeated egress

// Request deduplication cache to prevent repeated identical API calls
const requestCache = new Map<
  string,
  { promise: Promise<Response>; timestamp: number }
>();

// In-flight request deduplication: prevent multiple concurrent fetches of the same endpoint
const workersFetchInProgress = new Map<string, Promise<any>>();

function getCachedRequest(url: string): Promise<Response> | null {
  const cached = requestCache.get(url);
  const now = Date.now();
  if (cached && now - cached.timestamp < REQUEST_CACHE_DURATION) {
    console.log(`[RequestCache] Using cached request for ${url}`);
    return cached.promise;
  }
  return null;
}

function setCachedRequest(url: string, promise: Promise<Response>) {
  requestCache.set(url, { promise, timestamp: Date.now() });
}

// Safe fetch wrapper that prevents concurrent requests and uses cache
function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  // Check if a request for this URL is already in progress
  if (workersFetchInProgress.has(url)) {
    console.log(`[safeFetch] Returning in-flight promise for ${url}`);
    return workersFetchInProgress.get(url)!;
  }

  // Check if we have a recent cached response
  const cachedPromise = getCachedRequest(url);
  if (cachedPromise) {
    return cachedPromise;
  }

  // Create the actual fetch promise
  const promise = fetch(url, options)
    .finally(() => {
      // Remove from in-progress map when done
      workersFetchInProgress.delete(url);
    });

  // Store in both in-progress and cache maps
  workersFetchInProgress.set(url, promise);
  setCachedRequest(url, promise);

  return promise;
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadSelectedBranchId(): string | null {
  try {
    // First try to get the dedicated branch key (most recent)
    const branch = localStorage.getItem(BRANCH_KEY);
    if (branch) return branch;

    // Fallback to the persisted state
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const persisted = JSON.parse(raw);
    return persisted?.selectedBranchId ?? null;
  } catch {
    return null;
  }
}

export function WorkersProvider({ children }: { children: React.ReactNode }) {
  const initialBranches: Record<string, Branch> = useMemo(() => ({}), []);

  const initialWorkers = useMemo(() => ({}) as Record<string, Worker>, []);

  const persisted = typeof window !== "undefined" ? loadPersisted() : null;

  const [branches, setBranches] = useState<Record<string, Branch>>(
    () => persisted?.branches ?? initialBranches,
  );
  const [workers, setWorkers] = useState<Record<string, Worker>>(
    () => persisted?.workers ?? initialWorkers,
  );
  const [sessionPendingIds, setSessionPendingIds] = useState<string[]>(
    () => persisted?.sessionPendingIds ?? [],
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(() =>
    typeof window !== "undefined" ? loadSelectedBranchId() : null,
  );
  const [sessionVerifications, setSessionVerifications] = useState<
    Verification[]
  >(() => {
    // Try to load from localStorage first, then fallback to persisted state
    try {
      const stored = localStorage.getItem("hv_session_verifications");
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {}
    return persisted?.sessionVerifications ?? [];
  });
  const [specialRequests, setSpecialRequests] = useState<SpecialRequest[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);

  useEffect(() => {
    // Save selectedBranchId immediately and separately
    if (selectedBranchId) {
      try {
        localStorage.setItem(BRANCH_KEY, selectedBranchId);
      } catch {}
    }
  }, [selectedBranchId]);

  useEffect(() => {
    const state = {
      branches,
      workers,
      sessionPendingIds,
      sessionVerifications,
      selectedBranchId,
      specialRequests,
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {}
  }, [
    branches,
    workers,
    sessionPendingIds,
    sessionVerifications,
    selectedBranchId,
    specialRequests,
  ]);

  useEffect(() => {
    // Only check if branches were loaded from server
    if (
      branchesLoaded &&
      selectedBranchId &&
      Object.keys(branches).length > 0 &&
      !branches[selectedBranchId]
    ) {
      console.warn(
        "[WorkersContext] Selected branch no longer exists, resetting",
        selectedBranchId,
      );
      setSelectedBranchId(null);
      try {
        localStorage.removeItem(BRANCH_KEY);
      } catch {}
    }
  }, [branches, selectedBranchId, branchesLoaded]);

  const addBranch = (name: string): Branch => {
    const exists = Object.values(branches).find((b) => b.name === name);
    if (exists) return exists;
    const local: Branch = { id: crypto.randomUUID(), name };
    setBranches((prev) => ({ ...prev, [local.id]: local }));
    (async () => {
      try {
        const r = await fetch("/api/branches/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const j = await r.json().catch(() => ({}) as any);
        const db = j?.branch;
        if (r.ok && db?.id) {
          // Reconcile local temp ID with DB ID
          setBranches((prev) => {
            if (prev[local.id] && local.id !== db.id) {
              const { [local.id]: _, ...rest } = prev as any;
              return { ...rest, [db.id]: { id: db.id, name: db.name } };
            }
            return { ...prev, [db.id]: { id: db.id, name: db.name } };
          });
        } else {
          // Rollback local temp branch if server save failed
          setBranches((prev) => {
            const { [local.id]: _, ...rest } = prev as any;
            return rest;
          });
          try {
            const { toast } = await import("sonner");
            toast?.error(j?.message || "��عذر حفظ الفرع في القاعدة");
          } catch {}
        }
      } catch (e: any) {
        setBranches((prev) => {
          const { [local.id]: _, ...rest } = prev as any;
          return rest;
        });
        try {
          const { toast } = await import("sonner");
          toast?.error(e?.message || "تعذر ��فظ الفرع في القاعدة");
        } catch {}
      }
    })();
    return local;
  };
  const createBranch = async (
    name: string,
    password: string,
  ): Promise<Branch | null> => {
    try {
      const r = await fetch("/api/branches/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });
      const j = await r.json().catch(() => ({}) as any);
      if (!r.ok || !j?.ok || !j?.branch?.id) {
        try {
          const { toast } = await import("sonner");
          toast.error(j?.message || "تعذر حفظ الف��ع في ا��قاعدة");
        } catch {}
        return null;
      }
      const b: Branch = { id: j.branch.id, name: j.branch.name };
      setBranches((prev) => ({ ...prev, [b.id]: b }));
      return b;
    } catch (e: any) {
      try {
        const { toast } = await import("sonner");
        toast.error(e?.message || "تعذر حفظ ا��فرع في القاعدة");
      } catch {}
      return null;
    }
  };
  const getOrCreateBranchId = (name: string) => addBranch(name).id;

  const addWorker = (
    name: string,
    arrivalDate: number,
    branchId: string,
    docs?: WorkerDocs,
    plan: WorkerPlan = "with_expense",
  ): Worker => {
    const w: Worker = {
      id: crypto.randomUUID(),
      name,
      arrivalDate,
      branchId,
      verifications: [],
      docs,
      exitDate: null,
      exitReason: null,
      status: "active",
      plan,
    };
    setWorkers((prev) => ({ ...prev, [w.id]: w }));
    setSessionPendingIds((prev) => [w.id, ...prev]);

    // Clear docs cache when adding new worker
    try {
      localStorage.removeItem("hv_worker_docs_cache");
      localStorage.removeItem("hv_worker_docs_cache_time");
    } catch {}

    // Persist to Supabase asynchronously
    (async () => {
      try {
        const payload = {
          workerId: w.id,
          name,
          branchId,
          arrivalDate: new Date(arrivalDate).toISOString().split("T")[0],
          docs,
          plan,
        };
        console.log("Persisting worker to Supabase:", payload);
        const res = await fetch("/api/workers/upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          console.log("✓ Worker persisted successfully:", w.id);
        } else {
          console.error("✗ Failed to persist worker:", {
            status: res.status,
            response: data,
          });
        }
      } catch (e) {
        console.error("��� Error persisting worker to Supabase:", e);
      }
    })();

    return w;
  };

  const addLocalWorker = (
    id: string,
    name: string,
    arrivalDate: number,
    branchId: string,
    docs?: WorkerDocs,
    plan: WorkerPlan = "with_expense",
  ): Worker => {
    const w: Worker = {
      id,
      name,
      arrivalDate,
      branchId,
      verifications: [],
      docs,
      exitDate: null,
      exitReason: null,
      status: "active",
      plan,
    };
    setWorkers((prev) => ({ ...prev, [w.id]: w }));
    setSessionPendingIds((prev) => [w.id, ...prev]);

    // Clear docs cache when adding new worker
    try {
      localStorage.removeItem("hv_worker_docs_cache");
      localStorage.removeItem("hv_worker_docs_cache_time");
    } catch {}

    return w;
  };

  const addWorkersBulk = (
    items: {
      name: string;
      arrivalDate: number;
      branchName?: string;
      branchId?: string;
      plan?: WorkerPlan;
    }[],
  ) => {
    if (!items.length) return;
    const workersToAdd: Array<{ worker: Worker; item: (typeof items)[0] }> = [];

    setWorkers((prev) => {
      const next = { ...prev };
      items.forEach((it) => {
        const bId =
          it.branchId ||
          (it.branchName
            ? getOrCreateBranchId(it.branchName)
            : Object.keys(branches)[0]);
        const w: Worker = {
          id: crypto.randomUUID(),
          name: it.name,
          arrivalDate: it.arrivalDate,
          branchId: bId,
          verifications: [],
          plan: it.plan ?? "no_expense",
        };
        next[w.id] = w;
        workersToAdd.push({ worker: w, item: it });
        setSessionPendingIds((p) => [w.id, ...p]);
      });
      return next;
    });

    // Clear docs cache when adding new workers
    try {
      localStorage.removeItem("hv_worker_docs_cache");
      localStorage.removeItem("hv_worker_docs_cache_time");
    } catch {}

    // Persist all workers to Supabase asynchronously
    (async () => {
      for (const { worker: w, item: it } of workersToAdd) {
        try {
          const payload = {
            workerId: w.id,
            name: w.name,
            branchId: w.branchId,
            arrivalDate: new Date(w.arrivalDate).toISOString().split("T")[0],
            docs: w.docs,
            plan: w.plan,
          };
          console.log(`Persisting bulk worker ${w.name}:`, payload);
          const res = await fetch("/api/workers/upsert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            console.log(`✓ Bulk worker ${w.name} persisted:`, w.id);
          } else {
            console.error(`✗ Failed to persist bulk worker ${w.name}:`, {
              status: res.status,
              response: data,
            });
          }
        } catch (e) {
          console.error(`✗ Error persisting bulk worker ${w.name}:`, e);
        }
      }
    })();
  };

  const addVerification = (workerId: string, verifiedAt: number) => {
    const worker = workers[workerId];
    if (!worker) return null;
    const v: Verification = { id: crypto.randomUUID(), workerId, verifiedAt };
    setWorkers((prev) => ({
      ...prev,
      [workerId]: {
        ...prev[workerId],
        verifications: [v, ...prev[workerId].verifications],
      },
    }));
    setSessionVerifications((prev) => {
      const updated = [v, ...prev];
      // Persist to localStorage for session recovery
      try {
        localStorage.setItem(
          "hv_session_verifications",
          JSON.stringify(updated),
        );
      } catch {}
      return updated;
    });
    setSessionPendingIds((prev) => prev.filter((id) => id !== workerId));
    return v;
  };

  const savePayment = (verificationId: string, amount: number) => {
    // Prevent saving payment for locked workers (either exited-locked or policy-locked for no_expense)
    let blocked = false;
    for (const wid in workers) {
      const w = workers[wid];
      if (w.verifications.some((vv) => vv.id === verificationId)) {
        const exitedLocked = !!w.exitDate && w.status !== "active";
        const policyLocked = isNoExpensePolicyLocked(w as any);
        if (exitedLocked || policyLocked) blocked = true;
        break;
      }
    }
    if (blocked) return;
    setWorkers((prev) => {
      const next = { ...prev };
      for (const id in next) {
        const idx = next[id].verifications.findIndex(
          (vv) => vv.id === verificationId,
        );
        if (idx !== -1) {
          const vv = next[id].verifications[idx];
          next[id].verifications[idx] = {
            ...vv,
            payment: { amount, savedAt: Date.now() },
          };
          break;
        }
      }
      return next;
    });
    setSessionVerifications((prev) => {
      const updated = prev.map((vv) =>
        vv.id === verificationId
          ? { ...vv, payment: { amount, savedAt: Date.now() } }
          : vv,
      );
      // Persist to localStorage
      try {
        localStorage.setItem(
          "hv_session_verifications",
          JSON.stringify(updated),
        );
      } catch {}
      return updated;
    });
  };

  const addSpecialRequest: WorkersState["addSpecialRequest"] = (req) => {
    const finalBranchId = req.branchId || selectedBranchId;
    if (!finalBranchId) {
      console.error("[addSpecialRequest] No branch ID provided or selected");
      return {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        ...req,
        branchId: undefined,
      } as SpecialRequest;
    }
    const temp: SpecialRequest = {
      id: crypto.randomUUID(),
      createdAt: req.createdAt ?? Date.now(),
      ...req,
      branchId: finalBranchId,
    } as SpecialRequest;
    setSpecialRequests((prev) => [temp, ...prev]);
    (async () => {
      try {
        console.log(
          "[addSpecialRequest] Saving request to branch:",
          finalBranchId,
          temp,
        );
        const r = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branchId: finalBranchId, item: temp }),
        });
        const j = await r.json().catch(() => ({}) as any);
        console.log("[addSpecialRequest] Response:", {
          ok: r.ok,
          item: j?.item?.id,
        });
        if (r.ok && j?.ok && j?.item?.id) {
          setSpecialRequests((prev) => [
            {
              ...(j.item as any),
              createdAt: new Date(j.item.createdAt || Date.now()).getTime(),
            },
            ...prev.filter((x) => x.id !== temp.id),
          ]);
        } else {
          console.error(
            "[addSpecialRequest] Save failed:",
            j?.message || "unknown error",
          );
        }
      } catch (e) {
        console.error("[addSpecialRequest] Exception:", e);
      }
    })();
    return temp;
  };

  const upsertExternalWorker: WorkersState["upsertExternalWorker"] = (w) => {
    setWorkers((prev) => ({
      ...prev,
      [w.id]: {
        id: w.id,
        name: w.name,
        arrivalDate: w.arrivalDate,
        branchId: w.branchId,
        verifications: prev[w.id]?.verifications ?? [],
        docs: w.docs,
        exitDate: w.exitDate ?? null,
        exitReason: w.exitReason ?? null,
        status: w.status ?? "active",
        plan: w.plan ?? prev[w.id]?.plan ?? "with_expense",
        housingSystemStatus:
          w.housingSystemStatus ?? prev[w.id]?.housingSystemStatus,
        mainSystemStatus: w.mainSystemStatus ?? prev[w.id]?.mainSystemStatus,
      },
    }));
  };

  const updateWorkerDocs: WorkersState["updateWorkerDocs"] = (
    workerId,
    patch,
  ) => {
    setWorkers((prev) => {
      const w = prev[workerId];
      if (!w) return prev;
      const nextDocs = { ...(w.docs || {}), ...patch } as WorkerDocs;
      const patchPlan = (patch as any)?.plan as WorkerPlan | undefined;
      const docPresent = !!nextDocs.or || !!nextDocs.passport;
      const derivedPlan: WorkerPlan = patchPlan
        ? patchPlan
        : docPresent
          ? "with_expense"
          : (w.plan ?? "with_expense");
      return {
        ...prev,
        [workerId]: { ...w, docs: nextDocs, plan: derivedPlan },
      };
    });
    // Clear caches to ensure next fetch gets fresh data
    // NOTE: Do NOT call refreshWorkers() here as it causes infinite loops
    try {
      localStorage.removeItem("hv_worker_docs_cache");
      localStorage.removeItem("hv_worker_docs_cache_time");
      console.log("[WorkersContext] Cleared docs cache after update");
    } catch {}
    requestCache.delete("/api/data/workers-docs");
    console.log("[WorkersContext] Cleared request cache for /api/data/workers-docs");
  };

  const updateWorkerStatuses: WorkersState["updateWorkerStatuses"] = (
    workerId,
    housingSystemStatus,
    mainSystemStatus,
  ) => {
    setWorkers((prev) => {
      const w = prev[workerId];
      if (!w) return prev;
      return {
        ...prev,
        [workerId]: {
          ...w,
          housingSystemStatus: housingSystemStatus ?? w.housingSystemStatus,
          mainSystemStatus: mainSystemStatus ?? w.mainSystemStatus,
        },
      };
    });
    (async () => {
      try {
        await fetch("/api/workers/statuses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workerId,
            housingSystemStatus,
            mainSystemStatus,
          }),
        }).catch(() => {});
      } catch {}
    })();
  };

  const setWorkerExit: WorkersState["setWorkerExit"] = (
    workerId,
    exitDate,
    reason,
  ) => {
    // Persist to backend and compute residency charge if applicable
    (async () => {
      try {
        const r = await fetch("/api/workers/exit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-worker-id": workerId,
            "x-exit-date": String(exitDate ?? ""),
          },
          body: JSON.stringify({ workerId, exitDate, reason }),
        });
        // Best-effort; errors are handled silently to not block local UI
        await r.text().catch(() => "");
      } catch {}
    })();
    setWorkers((prev) => {
      const w = prev[workerId];
      if (!w) return prev;
      if (exitDate == null) {
        return {
          ...prev,
          [workerId]: {
            ...w,
            exitDate: null,
            exitReason: null,
            status: "active",
          },
        };
      }
      const status: WorkerStatus =
        w.status === "unlock_requested" ? "unlock_requested" : "exited";
      return {
        ...prev,
        [workerId]: {
          ...w,
          exitDate,
          exitReason: reason ?? w.exitReason ?? "",
          status,
        },
      };
    });
  };

  const requestUnlock: WorkersState["requestUnlock"] = (workerId) => {
    const w = workers[workerId];
    if (!w) {
      console.error("[requestUnlock] Worker not found:", workerId);
      return null;
    }
    const exitedLocked = !!w.exitDate && w.status !== "active";
    const policyLocked = isNoExpensePolicyLocked(w as any);
    const isLocked = exitedLocked || policyLocked;
    if (!isLocked) {
      console.warn("[requestUnlock] Worker is not locked:", workerId);
      return null;
    }
    const exists = specialRequests.find(
      (r) => r.type === "unlock" && r.workerId === workerId && !r.decision,
    );
    if (exists) {
      console.log(
        "[requestUnlock] Request already exists for worker:",
        workerId,
      );
      return exists;
    }
    const branchId = w.branchId || selectedBranchId;
    console.log("[requestUnlock] Creating unlock request:", {
      workerId: workerId.slice(0, 8),
      workerName: w.name,
      workerBranchId: w.branchId?.slice(0, 8),
      selectedBranchId: selectedBranchId?.slice(0, 8),
      finalBranchId: branchId?.slice(0, 8),
    });
    const req = addSpecialRequest({
      type: "unlock",
      amount: 0,
      workerId,
      workerName: w.name,
      branchId: branchId || undefined,
    });
    setWorkers((prev) => ({
      ...prev,
      [workerId]: { ...prev[workerId], status: "unlock_requested" },
    }));

    // Ensure the selected branch is set correctly before loading requests
    if (branchId && branchId !== selectedBranchId && !selectedBranchId) {
      console.log(
        "[requestUnlock] Setting selectedBranchId to:",
        branchId.slice(0, 8),
      );
      setSelectedBranchId(branchId);
    }

    // Reload special requests for this branch after a short delay to ensure the request was saved
    // But only if this branch is the current selected branch (to avoid overwriting requests from other branches)
    if (branchId) {
      const loadRequestsForBranch = async () => {
        try {
          console.log(
            "[requestUnlock] Reloading requests for branch after save:",
            branchId.slice(0, 8),
          );
          const r = await safeFetch(
            `/api/requests?branchId=${encodeURIComponent(branchId)}`,
          );
          const j = (await r.json?.().catch(() => ({}))) ?? {};
          if (Array.isArray(j?.items)) {
            const mapped = j.items.map((x: any) => ({
              ...x,
              createdAt: new Date(x.createdAt || Date.now()).getTime(),
            })) as any;
            // Only update if this is the current selected branch
            // This ensures we don't overwrite requests from other branches
            if (branchId === selectedBranchId) {
              setSpecialRequests(mapped);
              console.log(
                "[requestUnlock] Requests reloaded for current branch - count:",
                mapped.length,
              );
            } else {
              console.log(
                "[requestUnlock] Branch doesn't match selected, skipping update. Branch:",
                branchId.slice(0, 8),
                "Selected:",
                selectedBranchId?.slice(0, 8),
              );
            }
          } else {
            console.log(
              "[requestUnlock] No items in response, j.items is:",
              Array.isArray(j?.items),
              "j:",
              j,
            );
          }
        } catch (e) {
          console.error("[requestUnlock] Failed to reload requests:", e);
        }
      };
      // Try multiple times with increasing delay to ensure the request is saved
      setTimeout(loadRequestsForBranch, 300);
      setTimeout(loadRequestsForBranch, 1000);
    }

    return req;
  };

  const decideUnlock: WorkersState["decideUnlock"] = (requestId, approve) => {
    setSpecialRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? {
              ...r,
              decision: approve ? "approved" : "rejected",
              handledAt: Date.now(),
            }
          : r,
      ),
    );
    const req = specialRequests.find((r) => r.id === requestId);
    if (req?.branchId) {
      void fetch("/api/requests/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: req.branchId,
          requestId,
          patch: {
            decision: approve ? "approved" : "rejected",
            handledAt: new Date().toISOString(),
          },
        }),
      }).catch(() => {});
    }
    if (req?.workerId) {
      setWorkers((prev) => {
        const w = prev[req.workerId!];
        if (!w) return prev;
        if (approve)
          return { ...prev, [req.workerId!]: { ...w, status: "active" } };
        return {
          ...prev,
          [req.workerId!]: { ...w, status: "unlock_requested" },
        };
      });
    }
  };

  const resolveWorkerRequest: WorkersState["resolveWorkerRequest"] = (
    requestId,
    workerId,
  ) => {
    console.log("[resolveWorkerRequest] Called with:", {
      requestId,
      workerId,
      timestamp: new Date().toISOString(),
    });
    let target: SpecialRequest | undefined = undefined;
    setSpecialRequests((prev) => {
      console.log(
        "[resolveWorkerRequest] Current specialRequests count:",
        prev.length,
      );
      const next = prev.map((r) => {
        if (r.id === requestId) {
          target = r;
          console.log("[resolveWorkerRequest] Found matching request:", {
            id: r.id,
            unregistered: r.unregistered,
            workerId: r.workerId,
            branchId: r.branchId,
          });
        }
        return r.id === requestId
          ? {
              ...r,
              workerId,
              unregistered: false,
              decision: "approved",
              handledAt: Date.now(),
            }
          : r;
      });
      console.log("[resolveWorkerRequest] Updated specialRequests:", {
        updated: next.find((r) => r.id === requestId),
      });
      return next;
    });
    if (target?.branchId) {
      console.log(
        "[resolveWorkerRequest] Syncing to server for branchId:",
        target.branchId,
      );
      void fetch("/api/requests/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: target!.branchId,
          requestId,
          patch: {
            workerId,
            unregistered: false,
            decision: "approved",
            handledAt: new Date().toISOString(),
          },
        }),
      }).catch((e) => {
        console.error("[resolveWorkerRequest] Sync error:", e);
      });
    } else {
      console.log(
        "[resolveWorkerRequest] No branchId found, skipping server sync",
      );
    }
  };

  // Safe fetch that never rejects (prevents noisy console errors from instrumentation)
  // Uses global deduplication to prevent concurrent requests for same URL
  const safeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      // For GET requests, check if in-flight or cached
      if (method === "GET") {
        // Check if already in-flight
        if (workersFetchInProgress.has(url)) {
          console.log(`[safeFetch] Returning in-flight request for ${url}`);
          return await workersFetchInProgress.get(url)!;
        }

        // Check cache
        const cached = getCachedRequest(url);
        if (cached) {
          console.log(`[safeFetch] Using cached response for ${url}`);
          return await cached;
        }
      }

      // Create fetch promise
      const fetchPromise = fetch(input as any, init);

      // Track in-flight GET requests
      if (method === "GET") {
        workersFetchInProgress.set(url, fetchPromise);
        // Cache the promise
        setCachedRequest(url, fetchPromise);
        // Clean up in-flight after completion
        fetchPromise.finally(() => {
          workersFetchInProgress.delete(url);
        });
      }

      return await fetchPromise;
    } catch (e: any) {
      console.warn(
        "[safeFetch] Network error, returning safe fallback:",
        e?.message,
      );
      return {
        ok: false,
        status: 0,
        json: async () => ({}),
        text: async () => "{}",
      } as any;
    }
  };

  useEffect(() => {
    // Clear outdated caches on first load
    try {
      const cacheVersion = localStorage.getItem("hv_cache_version");
      if (cacheVersion !== "v2") {
        console.log("[WorkersContext] Clearing outdated cache...");
        localStorage.removeItem("hv_state_v1");
        localStorage.removeItem("hv_worker_docs_cache");
        localStorage.removeItem("hv_verifications_cache");
        localStorage.removeItem("hv_branches_cache");
        localStorage.removeItem("hv_worker_docs_cache_time");
        localStorage.removeItem("hv_verifications_cache_time");
        localStorage.removeItem("hv_branches_cache_time");
        localStorage.setItem("hv_cache_version", "v2");
      }
    } catch {}
  }, []);

  useEffect(() => {
    const state = {
      branches,
      workers,
      sessionPendingIds,
      sessionVerifications,
      selectedBranchId,
      specialRequests,
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      if (selectedBranchId) localStorage.setItem(BRANCH_KEY, selectedBranchId);
    } catch {}
  }, [
    branches,
    workers,
    sessionPendingIds,
    sessionVerifications,
    selectedBranchId,
    specialRequests,
  ]);

  useEffect(() => {
    (async () => {
      try {
        console.log("[WorkersContext] Starting branch load...");

        // Check if we have cached branches (6 hour cache)
        const cachedBranches = localStorage.getItem("hv_branches_cache");
        const branchesCacheTime = localStorage.getItem(
          "hv_branches_cache_time",
        );
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        const now = Date.now();

        if (
          cachedBranches &&
          branchesCacheTime &&
          now - parseInt(branchesCacheTime) < SIX_HOURS
        ) {
          try {
            const map = JSON.parse(cachedBranches);
            console.log(
              "[WorkersContext] Using cached branches:",
              Object.keys(map).length,
            );
            setBranches(map);
            return;
          } catch {}
        }

        let list: any[] | null = null;
        // Skip direct client-side Supabase fetch; use server proxies to avoid CORS/network issues
        if (!list) {
          console.log("[WorkersContext] Trying /api/data/branches...");
          const r0 = await safeFetch("/api/data/branches");
          const j0 = await r0.json().catch(() => ({}) as any);
          console.log("[WorkersContext] /api/data/branches response:", {
            ok: r0.ok,
            count: j0?.branches?.length,
          });
          if (r0.ok && Array.isArray(j0?.branches)) list = j0.branches as any[];
        }
        if (!list) {
          console.log("[WorkersContext] Trying /api/branches...");
          const r = await safeFetch("/api/branches");
          const j = await r.json().catch(() => ({}) as any);
          console.log("[WorkersContext] /api/branches response:", {
            ok: r.ok,
            count: j?.branches?.length,
          });
          if (r.ok && Array.isArray(j?.branches)) list = j.branches as any[];
        }
        if (Array.isArray(list)) {
          console.log("[WorkersContext] Loaded branches count:", list.length);
          const map: Record<string, Branch> = {};
          list.forEach(
            (it: any) =>
              (map[it.id] = {
                id: it.id,
                name: it.name,
                residencyRate: it.docs?.residency_rate || 220,
                verificationAmount: it.docs?.verification_amount || 75,
              }),
          );
          // Cache branches for 6 hours
          try {
            localStorage.setItem("hv_branches_cache", JSON.stringify(map));
            localStorage.setItem("hv_branches_cache_time", String(now));
          } catch {}
          setBranches(map);
        } else {
          console.warn(
            "[WorkersContext] No branches loaded from API, using localStorage data",
          );
        }
      } catch (e) {
        console.error("[WorkersContext] Error loading branches:", e);
      } finally {
        setBranchesLoaded(true);
      }
    })();
  }, []);

  // Load special requests for current branch
  useEffect(() => {
    if (!selectedBranchId) return;
    (async () => {
      try {
        console.log(
          "[WorkersContext] Loading requests for branch:",
          selectedBranchId,
        );
        const r = await safeFetch(
          `/api/requests?branchId=${encodeURIComponent(selectedBranchId)}`,
        );
        if (!r) {
          console.warn("[WorkersContext] safeFetch returned null");
          return;
        }
        const j = (await r.json?.().catch(() => ({}))) ?? {};
        console.log("[WorkersContext] Requests loaded:", {
          ok: r.ok,
          count: j?.items?.length,
          items: j?.items,
        });
        if (Array.isArray(j?.items)) {
          setSpecialRequests((prev) => {
            const serverRequests = j.items.map((x: any) => ({
              ...x,
              createdAt: new Date(x.createdAt || Date.now()).getTime(),
            })) as any;

            // Merge local updates with server data
            // Local updates (unregistered: false, decision: "approved") take precedence
            const mergedRequests = serverRequests.map((sr: any) => {
              const localRequest = prev.find((p) => p.id === sr.id);
              if (localRequest) {
                // If local has been updated (unregistered: false or decision set), keep local
                if (
                  localRequest.unregistered === false ||
                  localRequest.decision === "approved"
                ) {
                  console.log(
                    "[WorkersContext] Keeping local update for request:",
                    sr.id,
                  );
                  return localRequest;
                }
              }
              return sr;
            });

            console.log(
              "[WorkersContext] Merged requests count:",
              mergedRequests.length,
            );
            return mergedRequests;
          });
        }
      } catch (e) {
        console.error("[WorkersContext] Failed to load requests:", e);
        // Silently fail - don't break the app
        // Don't clear specialRequests, keep local data
      }
    })();
  }, [selectedBranchId]);

  // Load workers and their verifications once on mount
  useEffect(() => {
    console.log("[WorkersContext] Starting load...");
    let isMounted = true;

    (async () => {
      let workersArr: any[] | null = null;

      const r2 = await safeFetch("/api/data/workers");
      const j2 = await r2.json().catch(() => ({}) as any);
      console.log("[WorkersContext] Workers response:", {
        ok: r2.ok,
        count: j2?.workers?.length,
      });
      if (r2.ok && Array.isArray(j2?.workers) && j2.workers.length > 0) {
        workersArr = j2.workers;
      }

      // Load verifications - always fetch fresh to ensure up-to-date data
      let verArr: any[] | null = null;
      const r3 = await safeFetch("/api/data/verifications");
      const j3 = await r3.json().catch(() => ({}) as any);
      console.log("[WorkersContext] Verifications response:", {
        ok: r3.ok,
        count: j3?.verifications?.length,
      });
      if (r3.ok && Array.isArray(j3?.verifications)) {
        verArr = j3.verifications;
        // Cache verifications for faster subsequent loads
        try {
          localStorage.setItem(
            "hv_verifications_cache",
            JSON.stringify(verArr),
          );
          localStorage.setItem("hv_verifications_cache_time", String(now));
        } catch {}
      }

      // Load docs (plan, assignedArea) - use safeFetch which handles deduplication
      let docsMap: Record<string, any> = {};
      const r4 = await safeFetch("/api/data/workers-docs");
      const j4 = await r4.json().catch(() => ({}) as any);
      if (r4.ok && j4?.docs && typeof j4.docs === "object") {
        docsMap = j4.docs;
        console.log("[WorkersContext] Docs map loaded:", {
          count: Object.keys(j4.docs).length,
          sample: Object.entries(j4.docs)
            .slice(0, 3)
            .map(([id, docs]) => ({
              id: id.slice(0, 8),
              plan: (docs as any)?.plan,
              or: !!(docs as any)?.or,
              passport: !!(docs as any)?.passport,
            })),
        });
      }

      if (!isMounted) return;

      // Build map from workers
      const map: Record<string, Worker> = {};
      const workersToPlanFix: { id: string; plan: WorkerPlan }[] = [];
      if (Array.isArray(workersArr)) {
        console.log("[WorkersContext] Processing workers:", workersArr.length);
        workersArr.forEach((w: any) => {
          const id = w.id;
          if (!id) return;
          const arrivalDate = w.arrival_date
            ? new Date(w.arrival_date).getTime()
            : Date.now();
          const exitDate = w.exit_date ? new Date(w.exit_date).getTime() : null;

          // Get plan from docsMap which now correctly identifies applicants without documents
          const docsEntry = docsMap[id] || {};
          const planFromDocs = docsEntry.plan as any;
          const storedPlan: WorkerPlan =
            planFromDocs === "no_expense" ? "no_expense" : "with_expense";

          // Merge docs from docsMap with any docs from the worker record
          const docs = { ...(w.docs as any), ...docsEntry } as WorkerDocs;
          // Use assigned_area from the dedicated column, fallback to docs.assignedArea
          if (w.assigned_area) {
            docs.assignedArea = w.assigned_area;
          }

          const hasDocuments = !!docs.or || !!docs.passport;
          const finalPlan: WorkerPlan = hasDocuments
            ? "with_expense"
            : "no_expense";

          if (docs.plan !== finalPlan) {
            docs.plan = finalPlan;
          }
          if (storedPlan !== finalPlan) {
            workersToPlanFix.push({ id, plan: finalPlan });
          }

          console.log("[WorkersContext] Worker plan assignment:", {
            workerId: id.slice(0, 8),
            name: w.name || "",
            plan: finalPlan,
            hasDocuments,
            autoAdjusted: storedPlan !== finalPlan,
          });
          map[id] = {
            id,
            name: w.name || "",
            arrivalDate,
            branchId: w.branch_id || "",
            verifications: [],
            docs,
            exitDate,
            exitReason: w.exit_reason || null,
            status: w.status || "active",
            plan: finalPlan,
          } as Worker;
        });

        // NOTE: Disabled automatic plan persistence on initial load
        // This was causing excessive POST requests during app startup
        // Plan corrections will only happen via explicit user actions
        if (workersToPlanFix.length > 0) {
          console.log(
            `[WorkersContext] Skipping automatic plan sync for ${workersToPlanFix.length} workers during initial load`,
          );
        }
      }

      // Add verifications to workers
      if (Array.isArray(verArr)) {
        console.log(
          "[WorkersContext] Processing verifications:",
          verArr.length,
        );
        const byWorker: Record<string, Verification[]> = {};
        verArr.forEach((v: any) => {
          const wid = v.worker_id;
          if (!wid) return;
          const item: Verification = {
            id: v.id,
            workerId: wid,
            verifiedAt: v.verified_at
              ? new Date(v.verified_at).getTime()
              : Date.now(),
            payment:
              v.payment_amount != null
                ? {
                    amount: Number(v.payment_amount) || 0,
                    savedAt: v.payment_saved_at
                      ? new Date(v.payment_saved_at).getTime()
                      : Date.now(),
                  }
                : undefined,
          };
          (byWorker[wid] ||= []).push(item);
        });
        Object.keys(byWorker).forEach((wid) => {
          byWorker[wid].sort((a, b) => b.verifiedAt - a.verifiedAt);
          if (map[wid]) map[wid].verifications = byWorker[wid];
        });

        // Merge with session verifications (local additions not yet on server)
        sessionVerifications.forEach((sv) => {
          if (sv.workerId && map[sv.workerId]) {
            // Check if verification already exists (to avoid duplicates)
            const exists = map[sv.workerId].verifications.some(
              (v) => v.id === sv.id,
            );
            if (!exists) {
              map[sv.workerId].verifications.unshift(sv);
            }
          }
        });
      }

      console.log("[WorkersContext] Final map size:", Object.keys(map).length);

      if (isMounted) {
        setWorkers(map);
        // Keep session verifications for now - they may contain new data not yet persisted
        // Don't clear them to avoid flickering
        // Save sync timestamp for future delta updates
        localStorage.setItem(WORKERS_SYNC_KEY, new Date().toISOString());
        console.log("[WorkersContext] Initial sync timestamp saved");
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // Smart refresh function: only fetch new/modified workers since last sync
  const refreshWorkers = useCallback(async () => {
    try {
      console.log("[WorkersContext] Manual refresh triggered");
      const lastSyncTime = localStorage.getItem(WORKERS_SYNC_KEY);

      const url = lastSyncTime
        ? `/api/data/workers/delta?sinceTimestamp=${encodeURIComponent(lastSyncTime)}`
        : "/api/data/workers";

      const r = await safeFetch(url);
      const j = await r.json().catch(() => ({}) as any);

      if (!r.ok || !Array.isArray(j?.workers)) {
        console.warn("[WorkersContext] Delta refresh failed:", j?.message);
        return;
      }

      // Also load fresh verifications
      const r3 = await safeFetch("/api/data/verifications");
      const j3 = await r3.json().catch(() => ({}) as any);
      let verArr: any[] | null = null;
      if (r3.ok && Array.isArray(j3?.verifications)) {
        verArr = j3.verifications;
      }

      // Update or add workers from delta response
      setWorkers((prev) => {
        const updated = { ...prev };
        const workersToPlanFix: { id: string; plan: WorkerPlan }[] = [];

        (j.workers || []).forEach((w: any) => {
          const id = w.id;
          if (!id) return;

          const arrivalDate = w.arrival_date
            ? new Date(w.arrival_date).getTime()
            : Date.now();
          const exitDate = w.exit_date ? new Date(w.exit_date).getTime() : null;

          // Merge with existing worker data, preserve verifications and docs
          // Updated data from delta doesn't include docs, so keep existing docs
          let mergedVerifications: Verification[] = [];

          // First, add verifications from server
          if (Array.isArray(verArr)) {
            verArr.forEach((v: any) => {
              if (v.worker_id === id) {
                const item: Verification = {
                  id: v.id,
                  workerId: id,
                  verifiedAt: v.verified_at
                    ? new Date(v.verified_at).getTime()
                    : Date.now(),
                  payment:
                    v.payment_amount != null
                      ? {
                          amount: Number(v.payment_amount) || 0,
                          savedAt: v.payment_saved_at
                            ? new Date(v.payment_saved_at).getTime()
                            : Date.now(),
                        }
                      : undefined,
                };
                mergedVerifications.push(item);
              }
            });
          }

          // Then add session verifications (local additions not yet on server)
          sessionVerifications.forEach((sv) => {
            if (sv.workerId === id) {
              const exists = mergedVerifications.some((v) => v.id === sv.id);
              if (!exists) {
                mergedVerifications.unshift(sv);
              }
            }
          });

          // Sort by verified_at descending
          mergedVerifications.sort((a, b) => b.verifiedAt - a.verifiedAt);

          const existingDocs = updated[id]?.docs || {};
          const mergedDocs = { ...existingDocs } as WorkerDocs;
          updated[id] = {
            ...updated[id],
            id,
            name: w.name || updated[id]?.name || "",
            arrivalDate,
            branchId: w.branch_id || "",
            exitDate,
            exitReason: w.exit_reason || null,
            status: w.status || "active",
            verifications: mergedVerifications,
            docs: mergedDocs,
            plan: updated[id]?.plan || "with_expense",
          } as Worker;

          const hasDocuments = !!mergedDocs.or || !!mergedDocs.passport;
          const finalPlan: WorkerPlan = hasDocuments
            ? "with_expense"
            : "no_expense";
          if (mergedDocs.plan !== finalPlan) mergedDocs.plan = finalPlan;
          if (updated[id].plan !== finalPlan) {
            updated[id] = { ...updated[id], plan: finalPlan };
            workersToPlanFix.push({ id, plan: finalPlan });
          }
        });

        // NOTE: Disabled automatic plan syncing in refreshWorkers
        // This was causing 17+ POST /api/workers/docs requests per session
        // Plan corrections should only happen via explicit user actions
        if (workersToPlanFix.length > 0) {
          console.log(
            `[WorkersContext] Skipping plan sync for ${workersToPlanFix.length} workers - must be done explicitly`,
          );
        }

        return updated;
      });

      // Keep session verifications - merge with server data
      // They may contain newer data than server

      // Save new sync timestamp for next delta query
      if (j.newSyncTimestamp) {
        localStorage.setItem(WORKERS_SYNC_KEY, j.newSyncTimestamp);
        console.log(
          "[WorkersContext] Sync timestamp updated:",
          j.newSyncTimestamp,
        );
      }
    } catch (e) {
      console.error("[WorkersContext] Refresh error:", e);
    }
  }, []);

  const value: WorkersState = {
    branches,
    workers,
    sessionPendingIds,
    sessionVerifications,
    selectedBranchId,
    setSelectedBranchId,
    addBranch,
    getOrCreateBranchId,
    addWorker,
    addLocalWorker,
    addWorkersBulk,
    addVerification,
    savePayment,
    upsertExternalWorker,
    updateWorkerDocs,
    updateWorkerStatuses,
    specialRequests,
    addSpecialRequest,
    setWorkerExit,
    requestUnlock,
    decideUnlock,
    resolveWorkerRequest,
    createBranch,
    refreshWorkers, // Add refresh function to context
  } as any;

  return (
    <WorkersContext.Provider value={value}>{children}</WorkersContext.Provider>
  );
}

let __fallbackWorkersState: WorkersState | null = null;
function getFallbackWorkersState(): WorkersState {
  if (__fallbackWorkersState) return __fallbackWorkersState;
  const makeId = () =>
    typeof crypto !== "undefined" && (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : Math.random().toString(36).slice(2);
  const state: WorkersState = {
    branches: {},
    workers: {},
    sessionPendingIds: [],
    sessionVerifications: [],
    selectedBranchId: null,
    setSelectedBranchId: () => {},
    addBranch: (name: string) => ({ id: makeId(), name }),
    createBranch: async () => null,
    getOrCreateBranchId: (_name: string) => "",
    addWorker: (name: string, arrivalDate: number, branchId: string, docs) => ({
      id: makeId(),
      name,
      arrivalDate,
      branchId,
      verifications: [],
      docs,
      exitDate: null,
      exitReason: null,
      status: "active",
      plan: docs?.plan || "with_expense",
    }),
    addLocalWorker: (
      id: string,
      name: string,
      arrivalDate: number,
      branchId: string,
      docs,
    ) => ({
      id,
      name,
      arrivalDate,
      branchId,
      verifications: [],
      docs,
      exitDate: null,
      exitReason: null,
      status: "active",
      plan: docs?.plan || "with_expense",
    }),
    addWorkersBulk: () => {},
    addVerification: () => null,
    savePayment: () => {},
    upsertExternalWorker: () => {},
    updateWorkerDocs: () => {},
    updateWorkerStatuses: () => {},
    specialRequests: [],
    addSpecialRequest: (req: any) => ({
      id: makeId(),
      createdAt: Date.now(),
      ...req,
    }),
    setWorkerExit: () => {},
    requestUnlock: () => null,
    decideUnlock: () => {},
    resolveWorkerRequest: () => {},
  } as any;
  __fallbackWorkersState = state;
  return state;
}

export function useWorkers() {
  const ctx = useContext(WorkersContext);
  return ctx ?? getFallbackWorkersState();
}
