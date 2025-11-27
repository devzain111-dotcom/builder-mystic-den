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
            toast?.error(j?.message || "تعذر حفظ الفرع في القاعدة");
          } catch {}
        }
      } catch (e: any) {
        setBranches((prev) => {
          const { [local.id]: _, ...rest } = prev as any;
          return rest;
        });
        try {
          const { toast } = await import("sonner");
          toast?.error(e?.message || "تعذر حف�� الفرع في ��لقاعدة");
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
          toast.error(j?.message || "تعذر حفظ الفرع في القاعدة");
        } catch {}
        return null;
      }
      const b: Branch = { id: j.branch.id, name: j.branch.name };
      setBranches((prev) => ({ ...prev, [b.id]: b }));
      return b;
    } catch (e: any) {
      try {
        const { toast } = await import("sonner");
        toast.error(e?.message || "تعذر حفظ الفرع في ا��قاعدة");
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

    if (branchId && branchId !== selectedBranchId && !selectedBranchId) {
      console.log(
        "[requestUnlock] Setting selectedBranchId to:",
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

  // Initialize Realtime subscriptions
  useEffect(() => {
    if (!supabase) {
      console.warn(
        "[WorkersContext] Supabase not configured - app will work with local data only",
      );
      setBranchesLoaded(true);
      return;
    }

    console.log("[WorkersContext] Initializing Realtime subscriptions...");

    // Helper function to retry Supabase queries with exponential backoff
    const retrySupabaseQuery = async (
      query: () => Promise<{ data: any; error: any }>,
      name: string,
      maxRetries = 3,
    ): Promise<any> => {
      let lastError: any = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          console.log(
            `[Realtime] ${name} attempt ${attempt + 1}/${maxRetries}...`,
          );

          // Add timeout protection
          const timeoutMs = 10000;
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${name} timeout after ${timeoutMs}ms`)), timeoutMs)
          );

          const queryPromise = query().catch((e: any) => {
            // Catch network errors
            throw new Error(`${name} network error: ${e?.message}`);
          });

          const result = await Promise.race([queryPromise, timeoutPromise]) as any;

          if (result?.error) {
            lastError = result.error;
            console.debug(`[Realtime] ${name} returned error:`, result.error.message);
            if (attempt < maxRetries - 1) {
              const delay = Math.min(500 * Math.pow(2, attempt), 3000);
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            return [];
          }

          return result?.data || [];
        } catch (e: any) {
          lastError = e;
          console.debug(
            `[Realtime] ${name} attempt ${attempt + 1} caught error:`,
            e?.message,
          );

          if (attempt < maxRetries - 1) {
            const delay = Math.min(500 * Math.pow(2, attempt), 3000);
            console.debug(`[Realtime] Retrying ${name} in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }
      }

      console.warn(
        `[Realtime] ${name} failed after ${maxRetries} attempts:`,
        lastError?.message,
      );
      return [];
    };

    // Load initial data when Realtime connects
    const loadInitialData = async () => {
      try {
        // Load branches first with client-side caching
        console.log("[Realtime] Fetching branches...");
        const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
        let branchesData: any = null;

        // Check localStorage cache first
        try {
          const cachedBranchesStr = localStorage.getItem("_branch_cache_data");
          if (cachedBranchesStr) {
            try {
              const cached = JSON.parse(cachedBranchesStr);
              if (Date.now() - cached.timestamp < CACHE_TTL) {
                console.log(
                  "[Realtime] Using cached branches from localStorage",
                );
                branchesData = cached.data;
              }
            } catch (e) {
              try {
                localStorage.removeItem("_branch_cache_data");
              } catch {}
            }
          }
        } catch (storageErr) {
          console.warn("[Realtime] localStorage access failed:", storageErr);
        }

        // Fetch from Supabase only if cache miss
        if (!branchesData) {
          branchesData = await retrySupabaseQuery(
            () => supabase.from("hv_branches").select("*"),
            "Branches fetch",
          );

          // Update cache
          if (branchesData && branchesData.length > 0) {
            try {
              localStorage.setItem(
                "_branch_cache_data",
                JSON.stringify({
                  data: branchesData,
                  timestamp: Date.now(),
                }),
              );
            } catch (storageErr) {
              console.warn("[Realtime] Failed to cache branches:", storageErr);
            }
          }
        }

        if (Array.isArray(branchesData)) {
          const branchMap: Record<string, Branch> = {};
          branchesData.forEach((b: any) => {
            branchMap[b.id] = {
              id: b.id,
              name: b.name,
              residencyRate: 220,
              verificationAmount: 75,
            };
          });
          setBranches(branchMap);
          console.log(
            "[Realtime] ✓ Branches loaded:",
            Object.keys(branchMap).length,
          );
        }

        // Load workers with client-side caching
        console.log("[Realtime] Fetching workers...");
        let workersData: any = null;

        // Check localStorage cache first
        try {
          const cachedWorkersStr = localStorage.getItem("_workers_cache_data");
          if (cachedWorkersStr) {
            try {
              const cached = JSON.parse(cachedWorkersStr);
              if (Date.now() - cached.timestamp < CACHE_TTL) {
                console.log(
                  "[Realtime] Using cached workers from localStorage",
                );
                workersData = cached.data;
              }
            } catch (e) {
              try {
                localStorage.removeItem("_workers_cache_data");
              } catch {}
            }
          }
        } catch (storageErr) {
          console.warn(
            "[Realtime] localStorage access failed for workers:",
            storageErr,
          );
        }

        // Fetch from Supabase only if cache miss
        if (!workersData) {
          workersData = await retrySupabaseQuery(
            () =>
              supabase
                .from("hv_workers")
                .select(
                  "id,name,arrival_date,branch_id,exit_date,exit_reason,status",
                )
                .limit(500),
            "Workers fetch",
          );

          // Update cache
          if (workersData && workersData.length > 0) {
            try {
              localStorage.setItem(
                "_workers_cache_data",
                JSON.stringify({
                  data: workersData,
                  timestamp: Date.now(),
                }),
              );
            } catch (storageErr) {
              console.warn("[Realtime] Failed to cache workers:", storageErr);
            }
          }
        }

        if (Array.isArray(workersData)) {
          const map: Record<string, Worker> = {};
          workersData.forEach((w: any) => {
            const arrivalDate = w.arrival_date
              ? new Date(w.arrival_date).getTime()
              : Date.now();
            const exitDate = w.exit_date
              ? new Date(w.exit_date).getTime()
              : null;

            map[w.id] = {
              id: w.id,
              name: w.name,
              arrivalDate,
              branchId: w.branch_id,
              verifications: [],
              status: w.status ?? "active",
              exitDate,
              exitReason: w.exit_reason ?? null,
              plan: "with_expense",
            };
          });
          setWorkers(map);
          console.log("[Realtime] ✓ Workers loaded:", Object.keys(map).length);
        }

        // Load verifications with client-side caching
        console.log("[Realtime] Fetching verifications...");
        let verifData: any = null;

        // Check localStorage cache first
        try {
          const cachedVerifStr = localStorage.getItem(
            "_verifications_cache_data",
          );
          if (cachedVerifStr) {
            try {
              const cached = JSON.parse(cachedVerifStr);
              if (Date.now() - cached.timestamp < CACHE_TTL) {
                console.log(
                  "[Realtime] Using cached verifications from localStorage",
                );
                verifData = cached.data;
              }
            } catch (e) {
              try {
                localStorage.removeItem("_verifications_cache_data");
              } catch {}
            }
          }
        } catch (storageErr) {
          console.warn(
            "[Realtime] localStorage access failed for verifications:",
            storageErr,
          );
        }

        // Fetch from Supabase only if cache miss
        if (!verifData) {
          verifData = await retrySupabaseQuery(
            () =>
              supabase
                .from("hv_verifications")
                .select(
                  "id,worker_id,verified_at,payment_amount,payment_saved_at",
                ),
            "Verifications fetch",
          );

          // Update cache
          if (verifData && verifData.length > 0) {
            try {
              localStorage.setItem(
                "_verifications_cache_data",
                JSON.stringify({
                  data: verifData,
                  timestamp: Date.now(),
                }),
              );
            } catch (storageErr) {
              console.warn(
                "[Realtime] Failed to cache verifications:",
                storageErr,
              );
            }
          }
        }

        if (Array.isArray(verifData)) {
          const verByWorker: Record<string, Verification[]> = {};
          verifData.forEach((v: any) => {
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
          console.log("[Realtime] ✓ Verifications loaded");
        }

        // Load worker documents/photos using API endpoint (docs are large, can't use direct Supabase)
        // Note: This is optional - app works fine without docs, so non-blocking
        console.log("[Realtime] Fetching worker documents...");
        (async () => {
          let attempts = 0;
          const maxAttempts = 2;

          while (attempts < maxAttempts) {
            try {
              attempts++;
              const controller = new AbortController();
              const timeoutMs = 120000; // 120 second timeout (accounts for server retries)
              const timeoutId = setTimeout(() => {
                console.warn(
                  `[Realtime] Aborting fetch due to timeout after ${timeoutMs}ms`,
                );
                controller.abort();
              }, timeoutMs);

              console.log(
                `[Realtime] Document fetch attempt ${attempts}/${maxAttempts}...`,
              );

              let docsRes: Response | null = null;
              try {
                docsRes = await fetch("/api/data/workers-docs?nocache=1", {
                  cache: "no-store",
                  signal: controller.signal,
                });
              } finally {
                clearTimeout(timeoutId);
              }

              if (!docsRes) {
                throw new Error("Fetch returned null response");
              }

              if (!docsRes.ok) {
                console.warn(
                  `[Realtime] Document fetch returned status ${docsRes.status}`,
                  {
                    attempt: attempts,
                    maxAttempts,
                    status: docsRes.status,
                  },
                );
                if (attempts < maxAttempts) {
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  continue;
                }
                break;
              }

              const docsData = await docsRes.json().catch((err) => {
                console.warn(
                  "[Realtime] Failed to parse documents JSON:",
                  err?.message,
                );
                return {};
              });

              if (docsData?.docs && typeof docsData.docs === "object") {
                // Update docs for each worker, which will automatically update plan if docs exist
                let updated = 0;
                for (const workerId in docsData.docs) {
                  updateWorkerDocs(workerId, docsData.docs[workerId]);
                  updated++;
                }
                console.log("[Realtime] ✓ Documents loaded successfully", {
                  workersWithDocs: updated,
                  attempt: attempts,
                });
                break;
              } else {
                console.warn(
                  "[Realtime] Documents response is empty or invalid structure",
                  {
                    hasDocsKey: !!docsData?.docs,
                    docsType: typeof docsData?.docs,
                  },
                );
                if (attempts < maxAttempts) {
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  continue;
                }
                console.warn(
                  "[Realtime] Unable to load documents after all attempts, continuing without them",
                );
                break;
              }
            } catch (fetchErr: any) {
              const isAbort = fetchErr?.name === "AbortError";
              const errMsg = fetchErr?.message || String(fetchErr);
              const errCode = (fetchErr as any)?.code;

              console.warn("[Realtime] Document fetch exception", {
                attempt: attempts,
                maxAttempts,
                error: errMsg,
                code: errCode,
                isAbort,
                name: fetchErr?.name,
              });

              if (attempts < maxAttempts) {
                const delayMs = Math.min(1000 * attempts, 3000);
                console.log(
                  `[Realtime] Retrying document fetch in ${delayMs}ms...`,
                );
                await new Promise((resolve) => setTimeout(resolve, delayMs));
              }
            }
          }

          if (attempts >= maxAttempts) {
            console.warn(
              "[Realtime] Document loading exhausted all retry attempts, app will function without documents",
            );
          }
        })();

        setBranchesLoaded(true);
      } catch (e) {
        console.error("[Realtime] Failed to load initial data:", e);
        // Ensure we always set loaded state to prevent infinite loading
        setBranches({});
        setWorkers({});
        setSessionVerifications([]);
        setBranchesLoaded(true);
      }
    };

    // Subscribe to workers changes
    const workersChannel = supabase
      .channel("workers-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hv_workers",
        },
        (payload: any) => {
          console.log(
            "[Realtime] Workers change:",
            payload.eventType,
            payload.new?.id,
          );
          if (
            payload.eventType === "INSERT" ||
            payload.eventType === "UPDATE"
          ) {
            const w = payload.new;
            if (w && w.id) {
              const arrivalDate = w.arrival_date
                ? new Date(w.arrival_date).getTime()
                : Date.now();
              const exitDate = w.exit_date
                ? new Date(w.exit_date).getTime()
                : null;

              setWorkers((prev) => {
                if (prev[w.id]) {
                  // Update existing worker, preserve verifications from local state
                  return {
                    ...prev,
                    [w.id]: {
                      ...prev[w.id],
                      name: w.name,
                      status: w.status,
                      exitDate,
                      exitReason: w.exit_reason,
                    },
                  };
                } else {
                  // New worker from another client
                  return {
                    ...prev,
                    [w.id]: {
                      id: w.id,
                      name: w.name,
                      arrivalDate,
                      branchId: w.branch_id,
                      verifications: [],
                      status: w.status,
                      exitDate,
                      exitReason: w.exit_reason,
                      plan: "with_expense",
                    },
                  };
                }
              });
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
        try {
          console.log("[Realtime] Workers subscription status:", status);
          if (status === "SUBSCRIBED") {
            // Load initial data after subscription is ready, with error boundary
            try {
              loadInitialData();
            } catch (dataErr) {
              console.error("[Realtime] loadInitialData failed:", dataErr);
              setBranchesLoaded(true);
            }
          }
        } catch (e) {
          console.error(
            "[Realtime] Error in workers subscription callback:",
            e,
          );
          setBranchesLoaded(true);
        }
      });

    workersSubscriptionRef.current = workersChannel;

    // Subscribe to verifications changes
    const verificationsChannel = supabase
      .channel("verifications-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hv_verifications",
        },
        (payload: any) => {
          console.log(
            "[Realtime] Verifications change:",
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
                  // Update existing
                  newVerifications = [...worker.verifications];
                  newVerifications[verificationIndex] = verification;
                } else {
                  // New verification - insert at beginning
                  newVerifications = [verification, ...worker.verifications];
                }

                return {
                  ...prev,
                  [v.worker_id]: {
                    ...worker,
                    verifications: newVerifications,
                  },
                };
              });

              // Update session verifications
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
        console.log("[Realtime] Verifications subscription status:", status);
      });

    verificationsSubscriptionRef.current = verificationsChannel;

    // Subscribe to branch changes
    const branchesChannel = supabase
      .channel("branches-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hv_branches",
        },
        (payload: any) => {
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
              setBranches((prev) => ({
                ...prev,
                [b.id]: {
                  id: b.id,
                  name: b.name,
                  residencyRate: Number(b.residency_rate) || 220,
                  verificationAmount: Number(b.verification_amount) || 75,
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
      .subscribe();

    return () => {
      workersChannel.unsubscribe();
      verificationsChannel.unsubscribe();
      branchesChannel.unsubscribe();
    };
  }, []);

  // Load special requests when branch is selected
  useEffect(() => {
    if (!selectedBranchId) return;
    (async () => {
      try {
        console.log(
          "[WorkersContext] Loading requests for branch:",
          selectedBranchId,
        );
        const r = await fetch(
          `/api/requests?branchId=${encodeURIComponent(selectedBranchId)}`,
        );
        const j = (await r.json?.().catch(() => ({}))) ?? {};
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
      } catch (e) {
        console.error("[WorkersContext] Failed to load requests:", e);
      }
    })();
  }, [selectedBranchId]);

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
