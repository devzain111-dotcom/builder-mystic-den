import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { createClient } from "@supabase/supabase-js";
import { isNoExpensePolicyLocked } from "@/lib/utils";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

// Initialize Supabase client
const supabase =
  SUPABASE_URL && SUPABASE_ANON
    ? createClient(SUPABASE_URL, SUPABASE_ANON)
    : null;

// Suppress Supabase fetch errors globally
if (typeof window !== "undefined") {
  // Override console methods to suppress network errors
  const originalError = console.error;
  const originalWarn = console.warn;

  const shouldSuppress = (args: any[]): boolean => {
    const message = String(args[0] || "");
    const reason = String((args[1] || "")?.message || args[1] || "");

    return (
      message.includes("Failed to fetch") ||
      message.includes("network error") ||
      message.includes("timeout") ||
      message.includes("AbortError") ||
      reason.includes("Failed to fetch") ||
      reason.includes("network error") ||
      reason.includes("timeout") ||
      reason.includes("AbortError")
    );
  };

  console.error = function (...args: any[]) {
    if (!shouldSuppress(args)) {
      originalError.apply(console, args);
    }
  };

  console.warn = function (...args: any[]) {
    if (!shouldSuppress(args)) {
      originalWarn.apply(console, args);
    }
  };

  // Suppress network errors from window error event immediately
  const handleWindowError = (event: any) => {
    const msg = String(event?.message || event || "");
    if (
      msg.includes("Failed to fetch") ||
      msg.includes("network error") ||
      msg.includes("timeout") ||
      msg.includes("AbortError")
    ) {
      event.preventDefault?.();
      return true;
    }
  };

  window.addEventListener("error", handleWindowError, true); // Use capture phase
  window.addEventListener(
    "unhandledrejection",
    (event: any) => {
      const msg = String(event?.reason?.message || event?.reason || "");
      if (
        msg.includes("Failed to fetch") ||
        msg.includes("network error") ||
        msg.includes("timeout") ||
        msg.includes("AbortError")
      ) {
        event.preventDefault();
      }
    },
    true,
  );
}

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
  refreshWorkers?: () => Promise<void>;
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
  loadWorkerFullDocs?: (workerId: string) => Promise<WorkerDocs | null>;
}

const WorkersContext = createContext<WorkersState | null>(null);

const BRANCH_KEY = "hv_selected_branch_id"; // Will be stored in session storage only
const SESSION_BRANCH_KEY = "hv_session_branch";

function loadSelectedBranchId(): string | null {
  try {
    // Use session storage only (cleared when tab closes), not localStorage
    return sessionStorage.getItem(SESSION_BRANCH_KEY) || null;
  } catch {
    return null;
  }
}

export function WorkersProvider({ children }: { children: React.ReactNode }) {
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const [workers, setWorkers] = useState<Record<string, Worker>>({});
  const [sessionPendingIds, setSessionPendingIds] = useState<string[]>([]);
  const [selectedBranchId, setSelectedBranchIdState] = useState<string | null>(
    () => loadSelectedBranchId(),
  );
  const [sessionVerifications, setSessionVerifications] = useState<
    Verification[]
  >([]);
  const [specialRequests, setSpecialRequests] = useState<SpecialRequest[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);

  // References to Realtime subscriptions
  const workersSubscriptionRef = useRef<any>(null);
  const verificationsSubscriptionRef = useRef<any>(null);
  const requestsSubscriptionRef = useRef<any>(null);

  // Safe setSelectedBranchId with session storage
  const setSelectedBranchId = useCallback((id: string | null) => {
    setSelectedBranchIdState(id);
    try {
      if (id) {
        sessionStorage.setItem(SESSION_BRANCH_KEY, id);
      } else {
        sessionStorage.removeItem(SESSION_BRANCH_KEY);
      }
    } catch {}
  }, []);

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
          setBranches((prev) => {
            if (prev[local.id] && local.id !== db.id) {
              const { [local.id]: _, ...rest } = prev as any;
              return { ...rest, [db.id]: { id: db.id, name: db.name } };
            }
            return { ...prev, [db.id]: { id: db.id, name: db.name } };
          });
        } else {
          setBranches((prev) => {
            const { [local.id]: _, ...rest } = prev as any;
            return rest;
          });
          try {
            const { toast } = await import("sonner");
            toast?.error(j?.message || "تعذر حفظ ا��فرع في الق��عدة");
          } catch {}
        }
      } catch (e: any) {
        setBranches((prev) => {
          const { [local.id]: _, ...rest } = prev as any;
          return rest;
        });
        try {
          const { toast } = await import("sonner");
          toast?.error(e?.message || "تعذر حفظ الفرع في الق��عدة");
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
          toast.error(j?.message || "تعذ�� حفظ الفرع في القاع��ة");
        } catch {}
        return null;
      }
      const b: Branch = { id: j.branch.id, name: j.branch.name };
      setBranches((prev) => ({ ...prev, [b.id]: b }));
      return b;
    } catch (e: any) {
      try {
        const { toast } = await import("sonner");
        toast.error(e?.message || "تعذر حفظ الفرع في القاعدة");
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
    plan: WorkerPlan = "no_expense",
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
        console.error("✗ Error persisting worker to Supabase:", e);
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
    plan: WorkerPlan = "no_expense",
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

    // Persist all workers to Supabase asynchronously
    (async () => {
      for (const { worker: w } of workersToAdd) {
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

    // Optimistic update - show immediately in UI
    setWorkers((prev) => ({
      ...prev,
      [workerId]: {
        ...prev[workerId],
        verifications: [v, ...prev[workerId].verifications],
      },
    }));
    setSessionVerifications((prev) => [v, ...prev]);
    setSessionPendingIds((prev) => prev.filter((id) => id !== workerId));
    return v;
  };

  const savePayment = (verificationId: string, amount: number) => {
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

    // Optimistic update
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
        plan: w.plan ?? prev[w.id]?.plan ?? "no_expense",
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
          : (w.plan ?? "no_expense");
      return {
        ...prev,
        [workerId]: { ...w, docs: nextDocs, plan: derivedPlan },
      };
    });
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

    // Always ensure this branch is selected to show the new request
    if (branchId && branchId !== selectedBranchId) {
      console.log(
        "[requestUnlock] Setting selectedBranchId to show new unlock request:",
        branchId.slice(0, 8),
      );
      setSelectedBranchId(branchId);
    }

    if (branchId) {
      const loadRequestsForBranch = async () => {
        try {
          console.log(
            "[requestUnlock] Reloading requests for branch after save:",
            branchId.slice(0, 8),
          );
          const r = await fetch(
            `/api/requests?branchId=${encodeURIComponent(branchId)}`,
          );
          const j = (await r.json?.().catch(() => ({}))) ?? {};
          if (Array.isArray(j?.items)) {
            const mapped = j.items.map((x: any) => ({
              ...x,
              createdAt: new Date(x.createdAt || Date.now()).getTime(),
            })) as any;
            setSpecialRequests(mapped);
            console.log(
              "[requestUnlock] ✓ Requests reloaded - count:",
              mapped.length,
            );
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
      // Reload requests at multiple intervals to ensure they're fresh
      setTimeout(loadRequestsForBranch, 300);
      setTimeout(loadRequestsForBranch, 1000);
      setTimeout(loadRequestsForBranch, 2000);
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

  // Suppress network errors from showing in console
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const message = event.message || String(event);
      const reason =
        (event as any)?.reason?.message || String((event as any)?.reason);
      const isNetworkError =
        message?.includes("Failed to fetch") ||
        message?.includes("network error") ||
        message?.includes("timeout") ||
        message?.includes("AbortError") ||
        reason?.includes("Failed to fetch") ||
        reason?.includes("network error") ||
        reason?.includes("timeout") ||
        reason?.includes("AbortError");

      if (isNetworkError) {
        event.preventDefault();
        return true;
      }
      return false;
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = event.reason?.message || String(event.reason);
      const isNetworkError =
        message?.includes("Failed to fetch") ||
        message?.includes("network error") ||
        message?.includes("timeout") ||
        message?.includes("AbortError");

      if (isNetworkError) {
        event.preventDefault();
        return true;
      }
      return false;
    };

    window.addEventListener("error", handleError as any);
    window.addEventListener(
      "unhandledrejection",
      handleUnhandledRejection as any,
    );

    return () => {
      window.removeEventListener("error", handleError as any);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection as any,
      );
    };
  }, []);

  // Initialize Realtime subscriptions and load initial data
  useEffect(() => {
    if (!supabase) {
      console.warn(
        "[WorkersContext] Supabase not configured - app will work with local data only",
      );
      setBranchesLoaded(true);
      return;
    }

    console.log("[WorkersContext] Initializing Realtime subscriptions...");

    let isMounted = true;
    let workersChannel: any = null;
    let verificationsChannel: any = null;
    let branchesChannel: any = null;

    // Load initial data from Supabase
    const loadInitialData = async () => {
      try {
        console.log("[Realtime] Loading initial data from Supabase...");
        console.log("[Realtime] Supabase configured:", !!supabase);
        console.log("[Realtime] Supabase URL:", SUPABASE_URL?.substring(0, 30) + "...");

        if (!supabase) {
          console.warn("[Realtime] Supabase not available");
          setBranchesLoaded(true);
          return;
        }

        const timeoutId = setTimeout(() => {
          console.warn("[Realtime] Data fetch timeout (30s)");
        }, 30000);

        // Fetch with better error handling
        const branchesPromise = supabase
          .from("hv_branches")
          .select("id,name")
          .then(
            (res) => {
              if (res.error) {
                console.error("[Realtime] Branches error response:", {
                  message: res.error.message,
                  code: res.error.code,
                  details: res.error.details,
                  hint: res.error.hint,
                  status: res.error.status,
                });
                throw res.error;
              }
              return res;
            },
            (err) => {
              console.error("[Realtime] Branches fetch failed:", {
                message: err?.message,
                code: err?.code,
                status: err?.status,
              });
              throw err;
            },
          );

        const workersPromise = supabase
          .from("hv_workers")
          .select(
            "id,name,arrival_date,branch_id,exit_date,exit_reason,status,assigned_area",
          )
          .limit(500)
          .then(
            (res) => {
              if (res.error) {
                console.error("[Realtime] Workers error response:", {
                  message: res.error.message,
                  code: res.error.code,
                  details: res.error.details,
                  hint: res.error.hint,
                  status: res.error.status,
                  fullError: res.error,
                });
                throw res.error;
              }
              return res;
            },
            (err) => {
              console.error("[Realtime] Workers fetch failed:", {
                message: err?.message,
                code: err?.code,
                status: err?.status,
                details: err?.details,
              });
              throw err;
            },
          );

        const verificationsPromise = supabase
          .from("hv_verifications")
          .select("id,worker_id,verified_at,payment_amount,payment_saved_at")
          .then(
            (res) => {
              if (res.error) {
                console.error("[Realtime] Verifications error response:", {
                  message: res.error.message,
                  code: res.error.code,
                  details: res.error.details,
                  hint: res.error.hint,
                  status: res.error.status,
                });
                throw res.error;
              }
              return res;
            },
            (err) => {
              console.error("[Realtime] Verifications fetch failed:", {
                message: err?.message,
                code: err?.code,
                status: err?.status,
              });
              throw err;
            },
          );

        const results = await Promise.allSettled([
          branchesPromise,
          workersPromise,
          verificationsPromise,
        ]);

        clearTimeout(timeoutId);

        console.log("[Realtime] Initial data results:", {
          branches: results[0].status,
          workers: results[1].status,
          verifications: results[2].status,
        });

        if (!isMounted) return;

        const branchesResult =
          results[0].status === "fulfilled"
            ? results[0].value
            : { data: null, error: "timeout" };
        const workersResult =
          results[1].status === "fulfilled"
            ? results[1].value
            : { data: null, error: "timeout" };
        const verificationsResult =
          results[2].status === "fulfilled"
            ? results[2].value
            : { data: null, error: "timeout" };

        // Process branches
        if (
          branchesResult?.data &&
          Array.isArray(branchesResult.data) &&
          branchesResult.data.length > 0
        ) {
          const branchMap: Record<string, Branch> = {};
          const fixedRatesMap: Record<string, { rate: number; verification: number }> = {
            "SAN AND HARRISON": { rate: 225, verification: 75 },
            "PARANAQUE AND AIRPORT": { rate: 225, verification: 75 },
            "BACOOR BRANCH": { rate: 225, verification: 75 },
            "CALANTAS BRANCH": { rate: 215, verification: 85 },
            "NAKAR BRANCH": { rate: 215, verification: 85 },
            "AREA BRANCH": { rate: 215, verification: 85 },
            "HARISSON BRANCH": { rate: 215, verification: 85 },
          };

          branchesResult.data.forEach((b: any) => {
            const fixedRates = fixedRatesMap[b.name];
            branchMap[b.id] = {
              id: b.id,
              name: b.name,
              residencyRate: fixedRates ? fixedRates.rate : 220,
              verificationAmount: fixedRates ? fixedRates.verification : 75,
            };
          });
          setBranches(branchMap);

          const firstBranchId = Object.keys(branchMap)[0];
          if (firstBranchId && !selectedBranchId) {
            setSelectedBranchId(firstBranchId);
          }

          console.log(
            "[Realtime] ✓ Branches loaded:",
            Object.keys(branchMap).length,
          );
        }

        // Process workers
        if (
          workersResult?.data &&
          Array.isArray(workersResult.data) &&
          workersResult.data.length > 0
        ) {
          const workerMap: Record<string, Worker> = {};

          workersResult.data.forEach((w: any) => {
            const docs: WorkerDocs = {};

            // Extract fields from docs JSON extractions
            if (w["docs->>or"]) docs.or = w["docs->>or"];
            if (w["docs->>passport"]) docs.passport = w["docs->>passport"];
            if (w["docs->>avatar"]) docs.avatar = w["docs->>avatar"];
            if (w["docs->>plan"]) docs.plan = w["docs->>plan"];

            // Include assigned_area from initial load
            if (w.assigned_area && w.assigned_area !== null) {
              docs.assignedArea = w.assigned_area;
            }

            // Determine plan from extracted docs
            let plan: WorkerPlan = "no_expense";
            if (docs.plan === "with_expense") {
              plan = "with_expense";
            }

            workerMap[w.id] = {
              id: w.id,
              name: w.name,
              arrivalDate: w.arrival_date
                ? new Date(w.arrival_date).getTime()
                : Date.now(),
              branchId: w.branch_id,
              verifications: [] as Verification[],
              status: w.status ?? "active",
              exitDate: w.exit_date ? new Date(w.exit_date).getTime() : null,
              exitReason: w.exit_reason ?? null,
              docs: docs,
              plan: plan,
            };
          });
          setWorkers(workerMap);
          console.log(
            "[Realtime] ✓ Workers loaded:",
            Object.keys(workerMap).length,
          );
        }

        // Process verifications
        if (
          verificationsResult?.data &&
          Array.isArray(verificationsResult.data)
        ) {
          const verByWorker: Record<string, Verification[]> = {};
          verificationsResult.data.forEach((v: any) => {
            const verification: Verification = {
              id: v.id,
              workerId: v.worker_id,
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
            (verByWorker[v.worker_id] ||= []).push(verification);
          });

          setWorkers((prev) => {
            const next = { ...prev };
            for (const wid in verByWorker) {
              if (next[wid]) {
                next[wid].verifications = verByWorker[wid].sort(
                  (a, b) => b.verifiedAt - a.verifiedAt,
                );
              }
            }
            return next;
          });

          setSessionVerifications(
            Object.values(verByWorker)
              .flat()
              .sort((a, b) => b.verifiedAt - a.verifiedAt),
          );
          console.log(
            "[Realtime] ✓ Verifications loaded:",
            verificationsResult.data.length,
          );
        }

        setBranchesLoaded(true);
      } catch (err: any) {
        const errorInfo = {
          message: err?.message || String(err),
          code: err?.code,
          status: err?.status,
          name: err?.name,
          details: err?.details,
          hint: err?.hint,
          type: typeof err,
        };

        console.error("[Realtime] ❌ Error loading initial data:", errorInfo);

        // Log stack trace if available
        if (err?.stack) {
          console.error("[Realtime] Stack:", err.stack);
        }

        // Check if it's a network error
        if (err?.message === "Failed to fetch") {
          console.error(
            "[Realtime] ⚠️ Network connection error - Supabase may be unreachable or blocked",
          );
        }

        // Still mark as loaded to prevent infinite loading state
        // This allows the UI to show an error message
        setBranchesLoaded(true);
      }
    };

    // Setup Realtime subscriptions
    const setupSubscriptions = () => {
      try {
        // Workers subscription
        workersChannel = supabase
          .channel("workers_changes")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "hv_workers" },
            (payload: any) => {
              if (!isMounted) return;

              console.log(
                "[Realtime] Worker change:",
                payload.eventType,
                payload.new?.id,
              );

              if (
                payload.eventType === "INSERT" ||
                payload.eventType === "UPDATE"
              ) {
                const w = payload.new;
                if (w && w.id) {
                  const docs: WorkerDocs = {};

                  // Keep existing docs if they exist in state (for full documents loaded from Details)
                  const existingDocs = workers[w.id]?.docs || {};

                  // Extract docs metadata from JSON fields
                  if (w.docs?.or) {
                    docs.or = w.docs.or;
                  }
                  if (w.docs?.passport) {
                    docs.passport = w.docs.passport;
                  }
                  if (w.docs?.plan) {
                    docs.plan = w.docs.plan;
                  }

                  // Include assigned_area from realtime update if present
                  if (w.assigned_area && w.assigned_area !== null) {
                    docs.assignedArea = w.assigned_area;
                  }

                  // Preserve existing docs data from client-side loads (e.g., from Details page)
                  const mergedDocs = { ...existingDocs, ...docs };

                  // Determine plan based on merged docs
                  let plan: WorkerPlan = "no_expense";
                  if (mergedDocs.plan === "with_expense" || mergedDocs.or || mergedDocs.passport) {
                    plan = "with_expense";
                  }

                  const updatedWorker: Worker = {
                    id: w.id,
                    name: w.name,
                    arrivalDate: w.arrival_date
                      ? new Date(w.arrival_date).getTime()
                      : Date.now(),
                    branchId: w.branch_id,
                    verifications: workers[w.id]?.verifications ?? [],
                    status: w.status ?? "active",
                    exitDate: w.exit_date
                      ? new Date(w.exit_date).getTime()
                      : null,
                    exitReason: w.exit_reason ?? null,
                    docs: mergedDocs,
                    plan: plan,
                    housingSystemStatus: w.housingSystemStatus,
                    mainSystemStatus: w.mainSystemStatus,
                  };
                  setWorkers((prev) => ({
                    ...prev,
                    [w.id]: updatedWorker,
                  }));
                }
              } else if (payload.eventType === "DELETE") {
                const wid = payload.old?.id;
                if (wid) {
                  setWorkers((prev) => {
                    const next = { ...prev };
                    delete next[wid];
                    return next;
                  });
                }
              }
            },
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              console.log("[Realtime] Subscribed to workers updates");
            }
          });

        workersSubscriptionRef.current = workersChannel;

        // Verifications subscription
        verificationsChannel = supabase
          .channel("verifications_changes")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "hv_verifications" },
            (payload: any) => {
              if (!isMounted) return;

              console.log(
                "[Realtime] Verification change:",
                payload.eventType,
                payload.new?.id,
              );

              if (
                payload.eventType === "INSERT" ||
                payload.eventType === "UPDATE"
              ) {
                const v = payload.new;
                if (v && v.id && v.worker_id) {
                  const verification: Verification = {
                    id: v.id,
                    workerId: v.worker_id,
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

                  setWorkers((prev) => {
                    const worker = prev[v.worker_id];
                    if (!worker) return prev;

                    const verificationIndex = worker.verifications.findIndex(
                      (vv) => vv.id === v.id,
                    );
                    let newVerifications: Verification[];

                    if (verificationIndex >= 0) {
                      newVerifications = [...worker.verifications];
                      newVerifications[verificationIndex] = verification;
                    } else {
                      newVerifications = [
                        verification,
                        ...worker.verifications,
                      ];
                    }

                    return {
                      ...prev,
                      [v.worker_id]: {
                        ...worker,
                        verifications: newVerifications,
                      },
                    };
                  });

                  setSessionVerifications((prev) => {
                    const idx = prev.findIndex((vv) => vv.id === v.id);
                    if (idx >= 0) {
                      const next = [...prev];
                      next[idx] = verification;
                      return next;
                    }
                    return [verification, ...prev];
                  });
                }
              } else if (payload.eventType === "DELETE") {
                const vid = payload.old?.id;
                if (vid) {
                  setWorkers((prev) => {
                    const next = { ...prev };
                    for (const wid in next) {
                      next[wid].verifications = next[wid].verifications.filter(
                        (v) => v.id !== vid,
                      );
                    }
                    return next;
                  });
                  setSessionVerifications((prev) =>
                    prev.filter((v) => v.id !== vid),
                  );
                }
              }
            },
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              console.log("[Realtime] Subscribed to verifications updates");
            }
          });

        verificationsSubscriptionRef.current = verificationsChannel;

        // Branches subscription
        branchesChannel = supabase
          .channel("branches_changes")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "hv_branches" },
            (payload: any) => {
              if (!isMounted) return;

              console.log(
                "[Realtime] Branch change:",
                payload.eventType,
                payload.new?.id,
              );

              if (
                payload.eventType === "INSERT" ||
                payload.eventType === "UPDATE"
              ) {
                const b = payload.new;
                if (b && b.id) {
                  const fixedRatesMap: Record<string, { rate: number; verification: number }> = {
                    "SAN AND HARRISON": { rate: 225, verification: 75 },
                    "PARANAQUE AND AIRPORT": { rate: 225, verification: 75 },
                    "BACOOR BRANCH": { rate: 225, verification: 75 },
                    "CALANTAS BRANCH": { rate: 215, verification: 85 },
                    "NAKAR BRANCH": { rate: 215, verification: 85 },
                    "AREA BRANCH": { rate: 215, verification: 85 },
                    "HARISSON BRANCH": { rate: 215, verification: 85 },
                  };
                  const fixedRates = fixedRatesMap[b.name];

                  setBranches((prev) => ({
                    ...prev,
                    [b.id]: {
                      id: b.id,
                      name: b.name,
                      residencyRate: fixedRates ? fixedRates.rate : (Number(b.residency_rate) || 220),
                      verificationAmount: fixedRates ? fixedRates.verification : (Number(b.verification_amount) || 75),
                    },
                  }));
                }
              } else if (payload.eventType === "DELETE") {
                const bid = payload.old?.id;
                if (bid) {
                  setBranches((prev) => {
                    const next = { ...prev };
                    delete next[bid];
                    return next;
                  });
                }
              }
            },
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              console.log("[Realtime] Subscribed to branches updates");
            }
          });
      } catch (err: any) {
        console.error(
          "[Realtime] Error setting up subscriptions:",
          err?.message,
        );
      }
    };

    // Load initial data and setup subscriptions
    setupSubscriptions();
    loadInitialData();

    // Cleanup
    return () => {
      isMounted = false;
      workersChannel?.unsubscribe?.();
      verificationsChannel?.unsubscribe?.();
      branchesChannel?.unsubscribe?.();
    };
  }, []);

  // Load special requests when branch is selected
  useEffect(() => {
    if (!selectedBranchId) return;

    let isMounted = true;

    (async () => {
      try {
        console.log(
          "[WorkersContext] Loading requests for branch:",
          selectedBranchId,
        );

        try {
          const r = await fetch(
            `/api/requests?branchId=${encodeURIComponent(selectedBranchId)}`,
          ).catch((fetchErr) => {
            console.debug(
              "[WorkersContext] Requests fetch failed:",
              fetchErr?.message,
            );
            return null;
          });

          if (!r || !isMounted) return;

          const j = (await r.json?.().catch(() => ({}))) ?? {};
          if (!isMounted) return;

          if (Array.isArray(j?.items)) {
            setSpecialRequests((prev) => {
              const serverRequests = j.items.map((x: any) => ({
                ...x,
                createdAt: new Date(x.createdAt || Date.now()).getTime(),
              })) as any;

              const mergedRequests = serverRequests.map((sr: any) => {
                const localRequest = prev.find((p) => p.id === sr.id);
                if (localRequest) {
                  if (
                    localRequest.unregistered === false ||
                    localRequest.decision === "approved"
                  ) {
                    return localRequest;
                  }
                }
                return sr;
              });

              return mergedRequests;
            });
          }
        } catch (fetchErr: any) {
          if (isMounted) {
            console.debug(
              "[WorkersContext] Request load error:",
              fetchErr?.message,
            );
          }
        }
      } catch (e: any) {
        if (isMounted) {
          console.debug(
            "[WorkersContext] Failed to load requests:",
            e?.message,
          );
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [selectedBranchId]);

  // Load full documents for a specific worker (lazy-load on Details page)
  const loadWorkerFullDocs = useCallback(async (workerId: string) => {
    try {
      console.log("[WorkersContext] Loading full documents for worker:", workerId);

      const res = await fetch(`/api/data/workers/${workerId}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        console.warn("[WorkersContext] Failed to load worker docs:", res.status);
        return null;
      }

      const data = await res.json();

      if (data?.ok && data?.worker) {
        const worker = data.worker;
        const docs: WorkerDocs = {};

        // Extract docs from the response (could be object or string)
        if (worker.docs) {
          const parsedDocs = typeof worker.docs === "string"
            ? JSON.parse(worker.docs)
            : worker.docs;

          if (parsedDocs?.or) docs.or = parsedDocs.or;
          if (parsedDocs?.passport) docs.passport = parsedDocs.passport;
          if (parsedDocs?.avatar) docs.avatar = parsedDocs.avatar;
          if (parsedDocs?.plan) docs.plan = parsedDocs.plan;
          if (parsedDocs?.pre_change) docs.pre_change = parsedDocs.pre_change;
        }

        // Include assigned_area from the response
        if (worker.assigned_area && worker.assigned_area !== null) {
          docs.assignedArea = worker.assigned_area;
        }

        // Update worker with full documents
        setWorkers((prev) => ({
          ...prev,
          [workerId]: {
            ...prev[workerId],
            docs: docs,
          },
        }));
        console.log("[WorkersContext] ✓ Worker full documents loaded:", workerId);
        return docs;
      } else {
        console.warn("[WorkersContext] Invalid worker response:", data);
        return null;
      }
    } catch (err) {
      console.error("[WorkersContext] Error loading worker full docs:", err);
      return null;
    }
  }, []);

  // Refresh worker documents from server
  const refreshWorkers = useCallback(async () => {
    try {
      console.log("[WorkersContext] Refreshing worker documents...");

      // Clear cache on server first
      try {
        const clearRes = await fetch("/api/cache/clear-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        console.log("[WorkersContext] Cache clear response:", clearRes.status);
      } catch (e) {
        console.warn(
          "[WorkersContext] Cache clear failed (continuing anyway):",
          e,
        );
      }

      // Fetch fresh documents bypassing cache with 90 second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      try {
        const res = await fetch("/api/data/workers-docs?nocache=1", {
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.docs && typeof data.docs === "object") {
          setWorkers((prev) => {
            const next = { ...prev };
            for (const workerId in data.docs) {
              if (next[workerId]) {
                next[workerId].docs = data.docs[workerId];
              }
            }
            return next;
          });
          console.log("[WorkersContext] ✓ Worker documents refreshed");
        } else {
          console.warn(
            "[WorkersContext] Refresh failed: invalid response",
            data,
          );
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr?.name === "AbortError") {
          console.warn("[WorkersContext] Refresh timed out after 90s");
        } else {
          console.warn(
            "[WorkersContext] Refresh fetch error:",
            fetchErr?.message || String(fetchErr),
          );
        }
      }
    } catch (err) {
      console.error(
        "[WorkersContext] Failed to refresh worker documents:",
        err,
      );
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
    createBranch,
    getOrCreateBranchId,
    addWorker,
    addLocalWorker,
    addWorkersBulk,
    addVerification,
    savePayment,
    refreshWorkers,
    upsertExternalWorker,
    updateWorkerDocs,
    updateWorkerStatuses,
    specialRequests,
    addSpecialRequest,
    setWorkerExit,
    requestUnlock,
    decideUnlock,
    resolveWorkerRequest,
    loadWorkerFullDocs,
  };

  return (
    <WorkersContext.Provider value={value}>{children}</WorkersContext.Provider>
  );
}

export function useWorkers() {
  const ctx = useContext(WorkersContext);
  if (!ctx) throw new Error("[useWorkers] Must be used within WorkersProvider");
  return ctx;
}
