import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
} from "react";
import { isNoExpensePolicyLocked } from "@/lib/utils";

export interface Branch {
  id: string;
  name: string;
}
export type WorkerStatus = "active" | "exited" | "unlock_requested";
export type WorkerPlan = "with_expense" | "no_expense";
export interface WorkerDocs {
  or?: string;
  passport?: string;
  avatar?: string;
  plan?: WorkerPlan;
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
  }) => void;
  updateWorkerDocs: (workerId: string, patch: Partial<WorkerDocs>) => void;
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

function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
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
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(
    () =>
      localStorage.getItem(BRANCH_KEY) ?? persisted?.selectedBranchId ?? null,
  );
  const [sessionVerifications, setSessionVerifications] = useState<
    Verification[]
  >(() => persisted?.sessionVerifications ?? []);
  const [specialRequests, setSpecialRequests] = useState<SpecialRequest[]>([]);

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
          toast?.error(e?.message || "تعذر حفظ الفرع في القاعدة");
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
          toast.error(j?.message || "تعذر حفظ الفرع ف�� القاعدة");
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
        setSessionPendingIds((p) => [w.id, ...p]);
      });
      return next;
    });
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
    setSessionVerifications((prev) => [v, ...prev]);
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
    setSessionVerifications((prev) =>
      prev.map((vv) =>
        vv.id === verificationId
          ? { ...vv, payment: { amount, savedAt: Date.now() } }
          : vv,
      ),
    );
  };

  const addSpecialRequest: WorkersState["addSpecialRequest"] = (req) => {
    const temp: SpecialRequest = {
      id: crypto.randomUUID(),
      createdAt: req.createdAt ?? Date.now(),
      ...req,
      branchId: req.branchId || selectedBranchId || undefined,
    } as SpecialRequest;
    setSpecialRequests((prev) => [temp, ...prev]);
    (async () => {
      try {
        const r = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branchId: temp.branchId, item: temp }),
        });
        const j = await r.json().catch(() => ({}) as any);
        if (r.ok && j?.ok && j?.item?.id) {
          setSpecialRequests((prev) => [
            { ...(j.item as any), createdAt: Date.now() },
            ...prev.filter((x) => x.id !== temp.id),
          ]);
        }
      } catch {}
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
      const nextPlan = (patch as any).plan ? (patch as any).plan : w.plan;
      return {
        ...prev,
        [workerId]: { ...w, docs: nextDocs, plan: nextPlan },
      };
    });
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
            "x-reason": String(reason ?? ""),
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
    if (!w) return null;
    const exitedLocked = !!w.exitDate && w.status !== "active";
    const policyLocked = isNoExpensePolicyLocked(w as any);
    const isLocked = exitedLocked || policyLocked;
    if (!isLocked) return null;
    const exists = specialRequests.find(
      (r) => r.type === "unlock" && r.workerId === workerId && !r.decision,
    );
    if (exists) return exists;
    const req = addSpecialRequest({
      type: "unlock",
      amount: 0,
      workerId,
      workerName: w.name,
    });
    setWorkers((prev) => ({
      ...prev,
      [workerId]: { ...prev[workerId], status: "unlock_requested" },
    }));
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
    let target: SpecialRequest | undefined = undefined;
    setSpecialRequests((prev) =>
      prev.map((r) => {
        if (r.id === requestId) target = r;
        return r.id === requestId
          ? {
              ...r,
              workerId,
              unregistered: false,
              decision: "approved",
              handledAt: Date.now(),
            }
          : r;
      }),
    );
    if (target?.branchId) {
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
      }).catch(() => {});
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const url = (import.meta as any).env?.VITE_SUPABASE_URL as
          | string
          | undefined;
        const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as
          | string
          | undefined;
        let list: any[] | null = null;
        if (url && anon) {
          try {
            const u = new URL(`${url.replace(/\/$/, "")}/rest/v1/hv_branches`);
            u.searchParams.set("select", "id,name");
            const rr = await fetch(u.toString(), {
              headers: { apikey: anon, Authorization: `Bearer ${anon}` },
            });
            if (rr.ok) list = await rr.json();
          } catch {}
        }
        if (!list) {
          try {
            const r0 = await fetch("/api/data/branches");
            const j0 = await r0.json().catch(() => ({}) as any);
            if (r0.ok && Array.isArray(j0?.branches))
              list = j0.branches as any[];
          } catch {}
        }
        if (!list) {
          try {
            const r = await fetch("/api/branches");
            const j = await r.json().catch(() => ({}) as any);
            if (r.ok && Array.isArray(j?.branches)) list = j.branches as any[];
          } catch {}
        }
        if (Array.isArray(list)) {
          const map: Record<string, Branch> = {};
          list.forEach(
            (it: any) => (map[it.id] = { id: it.id, name: it.name }),
          );
          setBranches(map);
          if (!selectedBranchId) {
            const main = list.find((x: any) => x.name === "الفرع الرئيسي");
            const firstId = main?.id || list[0]?.id || null;
            if (firstId) setSelectedBranchId(firstId);
          }
        }
      } catch {}
    })();
  }, []);

  // Load special requests for current branch
  useEffect(() => {
    if (!selectedBranchId) return;
    (async () => {
      try {
        const r = await fetch(
          `/api/requests?branchId=${encodeURIComponent(selectedBranchId)}`,
        );
        const j = await r.json().catch(() => ({}) as any);
        if (r.ok && Array.isArray(j?.items)) {
          // Normalize timestamps to number
          setSpecialRequests(
            j.items.map((x: any) => ({
              ...x,
              createdAt: new Date(x.createdAt || Date.now()).getTime(),
            })) as any,
          );
        }
      } catch {}
    })();
  }, [selectedBranchId]);

  // Load workers and their verifications once on mount (server proxies only)
  useEffect(() => {
    (async () => {
      try {
        const r2 = await fetch("/api/data/workers");
        const j2 = await r2.json().catch(() => ({}) as any);
        const workersArr: any[] | null =
          r2.ok && Array.isArray(j2?.workers) ? j2.workers : null;
        if (!Array.isArray(workersArr)) return;
        const map: Record<string, Worker> = {};
        workersArr.forEach((w: any) => {
          const id = w.id;
          if (!id) return;
          const arrivalDate = w.arrival_date
            ? new Date(w.arrival_date).getTime()
            : Date.now();
          const exitDate = w.exit_date ? new Date(w.exit_date).getTime() : null;
          const docs = (w.docs as any) || {};
          const plan: WorkerPlan =
            (docs.plan as any) === "no_expense" ? "no_expense" : "with_expense";
          map[id] = {
            id,
            name: w.name || "",
            arrivalDate,
            branchId: w.branch_id || Object.keys(branches)[0],
            verifications: [],
            docs,
            exitDate,
            exitReason: w.exit_reason || null,
            status: w.status || "active",
            plan,
          } as Worker;
        });
        const r3 = await fetch("/api/data/verifications");
        const j3 = await r3.json().catch(() => ({}) as any);
        const verArr: any[] | null =
          r3.ok && Array.isArray(j3?.verifications) ? j3.verifications : null;
        if (Array.isArray(verArr)) {
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
        }
        setWorkers(map);
      } catch {}
    })();
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
    addWorkersBulk,
    addVerification,
    savePayment,
    upsertExternalWorker,
    updateWorkerDocs,
    specialRequests,
    addSpecialRequest,
    setWorkerExit,
    requestUnlock,
    decideUnlock,
    resolveWorkerRequest,
    createBranch,
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
    addWorkersBulk: () => {},
    addVerification: () => null,
    savePayment: () => {},
    upsertExternalWorker: () => {},
    updateWorkerDocs: () => {},
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
