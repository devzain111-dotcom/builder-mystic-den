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
  >(() => persisted?.sessionVerifications ?? []);
  const [specialRequests, setSpecialRequests] = useState<SpecialRequest[]>([]);

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
          toast.error(j?.message || "تعذر حفظ الف��ع في القاعدة");
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
      const nextPlan = (patch as any).plan ? (patch as any).plan : w.plan;
      return {
        ...prev,
        [workerId]: { ...w, docs: nextDocs, plan: nextPlan },
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

  // Safe fetch that never rejects (prevents noisy console errors from instrumentation)
  const safeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await fetch(input as any, init);
    } catch {
      try {
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }) as any;
      } catch {
        return {
          ok: false,
          json: async () => ({}),
          text: async () => "",
        } as any;
      }
    }
  };

  useEffect(() => {
    (async () => {
      (async () => {
        try {
          let list: any[] | null = null;
          const r0 = await safeFetch("/api/data/branches");
          const j0 = await r0.json().catch(() => ({}) as any);
          if (r0.ok && Array.isArray(j0?.branches)) {
            list = j0.branches as any[];
          }
          if (!list) {
            const r = await safeFetch("/api/branches");
            const j = await r.json().catch(() => ({}) as any);
            if (r.ok && Array.isArray(j?.branches)) {
              list = j.branches as any[];
            }
          }
          if (Array.isArray(list)) {
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
            setBranches(map);
          }
        } catch {}
      })()
    })();
  }, []);

  // Load special requests for current branch
  useEffect(() => {
    if (!selectedBranchId) return;
    (async () => {
      const r = await safeFetch(
        `/api/requests?branchId=${encodeURIComponent(selectedBranchId)}`,
      );
      const j = await r.json().catch(() => ({}) as any);
      if (r.ok && Array.isArray(j?.items)) {
        setSpecialRequests(
          j.items.map((x: any) => ({
            ...x,
            createdAt: new Date(x.createdAt || Date.now()).getTime(),
          })) as any,
        );
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
      if (r2.ok && Array.isArray(j2?.workers) && j2.workers.length > 0) {
        workersArr = j2.workers;
      }

      // Load verifications
      let verArr: any[] | null = null;
      const r3 = await safeFetch("/api/data/verifications");
      const j3 = await r3.json().catch(() => ({}) as any);
      if (r3.ok && Array.isArray(j3?.verifications)) {
        verArr = j3.verifications;
      }

      if (!isMounted) return;

      // Build map from workers
      const map: Record<string, Worker> = {};
      if (Array.isArray(workersArr)) {
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
          const housingSystemStatus =
            w.housing_system_status || docs.housing_system_status || undefined;
          const mainSystemStatus =
            w.main_system_status || docs.main_system_status || undefined;
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
            housingSystemStatus,
            mainSystemStatus,
          } as Worker;
        });
      }

      // Add verifications to workers
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

      console.log("[WorkersContext] Final map size:", Object.keys(map).length);
      if (isMounted) setWorkers(map);
    })();

    return () => {
      isMounted = false;
    };
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
    updateWorkerStatuses,
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
