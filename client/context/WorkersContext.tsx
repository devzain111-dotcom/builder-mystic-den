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
import { setSWRCache, getSWRCache, invalidateSWRCache } from "@/lib/swrCache";
import { getFixedVerificationAmount } from "../../shared/branchConfig";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

// Debug flag - only log in development
const DEBUG =
  typeof import.meta !== "undefined" && (import.meta as any).env.DEV;

// Initialize Supabase client (with fallback if env vars missing)
let supabase: any = null;
try {
  if (SUPABASE_URL && SUPABASE_ANON) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
  } else {
    console.warn(
      "[WorkersContext] Supabase not configured - using fallback mode",
    );
  }
} catch (err: any) {
  console.error(
    "[WorkersContext] Failed to initialize Supabase:",
    err?.message,
  );
}

const API_BASE_FALLBACKS = Array.from(
  new Set(
    [
      import.meta.env.VITE_API_BASE_URL as string | undefined,
      import.meta.env.VITE_FP_PUBLIC_URL as string | undefined,
    ].filter(
      (base): base is string =>
        typeof base === "string" && base.trim().length > 0,
    ),
  ),
);

const isAbsoluteUrl = (url: string) => /^https?:\/\//i.test(url);

const buildApiUrlFromBase = (base: string, path: string) => {
  const normalizedBase = base.replace(/\/$/, "");
  if (path.startsWith("/")) {
    return `${normalizedBase}${path}`;
  }
  return `${normalizedBase}/${path}`;
};

export interface Branch {
  id: string;
  name: string;
  residencyRate?: number;
  verificationAmount?: number;
}

interface CreateBranchOptions {
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
  no_expense_days_override?: number;
  no_expense_days_override_set_at?: number;
  no_expense_extension_days_total?: number;
}

const WORKER_DOC_SUMMARY_SELECT = [
  "docs_plan:docs->>plan",
  "docs_assigned_area:docs->>assignedArea",
  "docs_no_expense_days_override:docs->>no_expense_days_override",
  "docs_no_expense_days_override_set_at:docs->>no_expense_days_override_set_at",
  "docs_no_expense_extension_days_total:docs->>no_expense_extension_days_total",
  "docs_pre_change:docs->pre_change",
];
const WORKER_SUMMARY_SELECT = [
  "id",
  "name",
  "arrival_date",
  "branch_id",
  "exit_date",
  "exit_reason",
  "status",
  "assigned_area",
  ...WORKER_DOC_SUMMARY_SELECT,
].join(",");
const DOC_ALIAS_FIELD_NAMES = WORKER_DOC_SUMMARY_SELECT.map(
  (segment) => segment.split(":")[0],
);
const PLAN_VALUES: WorkerPlan[] = ["with_expense", "no_expense"];

const parseNumericDocField = (value: any): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const deriveDocsFromPayload = (payload: any): WorkerDocs => {
  const docs: WorkerDocs = {};
  if (!payload || typeof payload !== "object") {
    return docs;
  }

  if (payload.docs) {
    if (typeof payload.docs === "string") {
      try {
        Object.assign(docs, JSON.parse(payload.docs));
      } catch {
        // ignore invalid JSON blobs
      }
    } else if (typeof payload.docs === "object") {
      Object.assign(docs, payload.docs);
    }
  }

  if (
    typeof payload.docs_plan === "string" &&
    PLAN_VALUES.includes(payload.docs_plan as WorkerPlan)
  ) {
    docs.plan = payload.docs_plan as WorkerPlan;
  }

  const assignedArea =
    payload.docs_assigned_area ?? payload.assigned_area ?? docs.assignedArea;
  if (typeof assignedArea === "string" && assignedArea.trim().length > 0) {
    docs.assignedArea = assignedArea;
  }

  const override = parseNumericDocField(payload.docs_no_expense_days_override);
  if (override !== undefined) {
    docs.no_expense_days_override = override;
  }

  const overrideSetAt = parseNumericDocField(
    payload.docs_no_expense_days_override_set_at,
  );
  if (overrideSetAt !== undefined) {
    docs.no_expense_days_override_set_at = overrideSetAt;
  }

  const extensionTotal = parseNumericDocField(
    payload.docs_no_expense_extension_days_total,
  );
  if (extensionTotal !== undefined) {
    docs.no_expense_extension_days_total = extensionTotal;
  }

  if (payload.docs_pre_change && typeof payload.docs_pre_change === "object") {
    docs.pre_change = payload.docs_pre_change;
  }

  return docs;
};

const stripDocAliasFields = (payload: Record<string, any>) => {
  if (!payload || typeof payload !== "object") return;
  DOC_ALIAS_FIELD_NAMES.forEach((field) => {
    if (field in payload) {
      delete payload[field];
    }
  });
};

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
  branchesLoaded?: boolean;
  workersLoaded?: boolean;
  setSelectedBranchId: (id: string | null) => void;
  addBranch: (name: string) => Branch;
  createBranch?: (
    name: string,
    password: string,
    options?: CreateBranchOptions,
  ) => Promise<Branch | null>;
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
  refreshWorkers?: (options?: { full?: boolean }) => Promise<void>;
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

const BRANCH_KEY = "hv_selected_branch_id"; // Persisted to localStorage for browser persistence

function loadSelectedBranchId(): string | null {
  try {
    // Use localStorage to persist branch selection across browser sessions
    return localStorage.getItem(BRANCH_KEY) || null;
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
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [sessionVerifications, setSessionVerifications] = useState<
    Verification[]
  >([]);
  const [specialRequests, setSpecialRequests] = useState<SpecialRequest[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [workersLoaded, setWorkersLoaded] = useState(false);

  const SUPABASE_REST_URL = useMemo(() => {
    if (SUPABASE_URL) {
      return SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";
    }
    return null;
  }, []);

  // References to Realtime subscriptions
  const workersSubscriptionRef = useRef<any>(null);
  const verificationsSubscriptionRef = useRef<any>(null);
  const branchesSubscriptionRef = useRef<any>(null);
  const requestsSubscriptionRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  const branchesRef = useRef<Record<string, Branch>>({});
  const selectedBranchIdRef = useRef<string | null>(selectedBranchId);
  const lastDocsSyncRef = useRef<Record<string, string>>({});
  const branchFetchAbortRef = useRef<AbortController | null>(null);

  const applyFixedVerificationAmount = (
    branchName?: string,
    amount?: number,
  ): number => {
    const fixed = getFixedVerificationAmount(branchName);
    if (fixed != null) return fixed;
    const numeric = Number(amount);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    return 75;
  };

  useEffect(() => {
    branchesRef.current = branches;
  }, [branches]);

  useEffect(() => {
    selectedBranchIdRef.current = selectedBranchId;
  }, [selectedBranchId]);

  const getBranchVerificationAmount = useCallback(
    (branchId?: string | null): number | null => {
      if (!branchId) return null;
      const branch = branchesRef.current[branchId];
      if (!branch) return null;
      const fixed = getFixedVerificationAmount(branch.name);
      if (fixed != null) return fixed;
      const amount = Number(branch.verificationAmount);
      return Number.isFinite(amount) && amount > 0 ? amount : null;
    },
    [],
  );

  const normalizePaymentAmount = useCallback(
    (
      branchId: string | undefined | null,
      rawAmount: number | string | null | undefined,
    ): number | null => {
      const branchAmount = getBranchVerificationAmount(branchId);
      if (branchAmount != null) {
        return branchAmount;
      }
      if (rawAmount === null || rawAmount === undefined) return null;
      const parsed = Number(rawAmount);
      return Number.isFinite(parsed) ? parsed : null;
    },
    [getBranchVerificationAmount],
  );

  // Safe setSelectedBranchId with localStorage persistence
  const setSelectedBranchId = useCallback((id: string | null) => {
    setSelectedBranchIdState(id);
    try {
      if (id) {
        localStorage.setItem(BRANCH_KEY, id);
      } else {
        localStorage.removeItem(BRANCH_KEY);
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
          toast?.error(e?.message || "تعذر حفظ الفرع في القاعدة");
        } catch {}
      }
    })();
    return local;
  };

  const createBranch = async (
    name: string,
    password: string,
    options?: CreateBranchOptions,
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
      const b: Branch = {
        id: j.branch.id,
        name: j.branch.name,
        residencyRate: options?.residencyRate,
        verificationAmount: options?.verificationAmount,
      };
      setBranches((prev) => {
        const existing = prev[b.id] || {};
        return {
          ...prev,
          [b.id]: {
            ...existing,
            ...b,
            residencyRate: b.residencyRate ?? existing.residencyRate,
            verificationAmount:
              b.verificationAmount ?? existing.verificationAmount,
          },
        };
      });
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
    let targetBranchId: string | null = null;
    for (const wid in workers) {
      const w = workers[wid];
      if (w.verifications.some((vv) => vv.id === verificationId)) {
        const exitedLocked = !!w.exitDate && w.status !== "active";
        const policyLocked = isNoExpensePolicyLocked(w as any);
        if (exitedLocked || policyLocked) blocked = true;
        targetBranchId = w.branchId || null;
        break;
      }
    }
    if (blocked) return;

    const normalizedAmount =
      (normalizePaymentAmount(targetBranchId, amount) ?? Number(amount)) || 0;

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
            payment: { amount: normalizedAmount, savedAt: Date.now() },
          };
          break;
        }
      }
      return next;
    });
    setSessionVerifications((prev) => {
      const updated = prev.map((vv) =>
        vv.id === verificationId
          ? {
              ...vv,
              payment: { amount: normalizedAmount, savedAt: Date.now() },
            }
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
      let derivedPlan: WorkerPlan = patchPlan ?? w.plan ?? "no_expense";
      if (!patchPlan) {
        if (
          nextDocs.plan === "with_expense" ||
          !!nextDocs.or ||
          !!nextDocs.passport
        ) {
          derivedPlan = "with_expense";
        } else if (nextDocs.plan === "no_expense") {
          derivedPlan = "no_expense";
        }
      }
      nextDocs.plan = derivedPlan;
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

            // Merge with existing requests instead of replacing
            // This ensures newly created requests aren't lost if they haven't synced to server yet
            setSpecialRequests((prev) => {
              const serverIds = new Set(mapped.map((m: any) => m.id));
              const merged = [
                ...mapped,
                ...prev.filter(
                  (p) => !serverIds.has(p.id) && p.branchId === branchId,
                ),
              ];
              return merged;
            });

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
      const newStatus = approve ? "active" : "unlock_requested";
      setWorkers((prev) => {
        const w = prev[req.workerId!];
        if (!w) return prev;
        return {
          ...prev,
          [req.workerId!]: { ...w, status: newStatus },
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
    console.log("[WorkersContext] Initializing data loading...");

    let isMounted = true;

    // Load initial data from server API (not direct Supabase to avoid CORS)
    const loadInitialData = async () => {
      try {
        console.log("[Realtime] Loading initial data from server API...");

        const timeoutId = setTimeout(() => {
          console.warn("[Realtime] Data fetch timeout (5s)");
        }, 5000);

        // Fetch branches from server API instead of direct Supabase
        const branchesPromise = fetch("/api/data/branches")
          .then((res) => {
            if (!res.ok) {
              console.warn(
                "[Realtime] Branches fetch returned status:",
                res.status,
              );
              return { branches: [], ok: false };
            }
            return res.json();
          })
          .catch((err) => {
            console.warn("[Realtime] Branches fetch exception:", {
              message: err?.message,
            });
            return { branches: [], ok: false };
          });

        const results = await Promise.allSettled([branchesPromise]);
        clearTimeout(timeoutId);

        if (!isMounted) return;

        const branchesResult =
          results[0].status === "fulfilled"
            ? results[0].value
            : { branches: [], ok: false };

        // Process branches from server API
        if (
          branchesResult?.branches &&
          Array.isArray(branchesResult.branches) &&
          branchesResult.branches.length > 0
        ) {
          const branchMap: Record<string, Branch> = {};

          branchesResult.branches.forEach((b: any) => {
            try {
              console.log("[loadInitialData] Processing branch:", b.name);

              branchMap[b.id] = {
                id: b.id,
                name: b.name,
                residencyRate: Number(b.residency_rate) || 220,
                verificationAmount: applyFixedVerificationAmount(
                  b.name,
                  Number(b.verification_amount) || 75,
                ),
              };
            } catch (err) {
              console.error(
                "[loadInitialData] Error processing branch:",
                b,
                err,
              );
            }
          });
          setBranches(branchMap);
          console.log(
            "[loadInitialData] Branches set:",
            Object.keys(branchMap).length,
          );

          // Only set first branch if no branch is currently selected
          if (!selectedBranchId) {
            const firstBranchId = Object.keys(branchMap)[0];
            if (firstBranchId) {
              console.log(
                "[loadInitialData] Setting first branch:",
                firstBranchId.slice(0, 8),
              );
              setSelectedBranchId(firstBranchId);
            }
          }

          if (DEBUG) {
            console.log(
              "[Realtime] ✅ Branches loaded:",
              Object.keys(branchMap).length,
            );
          }
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
        // DISABLED: Realtime subscriptions to reduce Egress usage
        // Supabase Egress quota exceeded - Realtime costs ~75% of bandwidth
        // Data will be loaded via API endpoints instead
        console.log("[Realtime] Subscriptions disabled to save bandwidth");

        // Force initial data load from API
        // Wait a tick to ensure selectedBranchId is set
        Promise.resolve().then(() => {
          if (selectedBranchId) {
            console.log(
              "[setupSubscriptions] Triggering initial API load for branch:",
              selectedBranchId?.slice?.(0, 8),
            );
            setRefreshTrigger((prev) => {
              const next = prev + 1;
              console.log(
                "[setupSubscriptions] Refresh trigger updated:",
                prev,
                "=>",
                next,
              );
              return next;
            });
          } else {
            console.warn(
              "[setupSubscriptions] No selectedBranchId yet, waiting for initial data load",
            );
          }
        });
        return;

        // ========================================
        // BELOW IS DEAD CODE - NEVER EXECUTED
        // (return statement above prevents all execution)
        // Realtime subscriptions have been completely disabled
        // to reduce Supabase Egress usage (was using 75% of bandwidth)
        // ========================================

        // Workers subscription (DISABLED)
        workersChannel = supabase
          .channel("workers_changes")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "hv_workers" },
            (payload: any) => {
              if (!isMounted) return;

              const w = payload.new;
              if (!w || !w.id) return;

              console.log("[Realtime] Worker event:", {
                eventType: payload.eventType,
                workerId: w.id?.slice?.(0, 8),
                branchId: w.branch_id?.slice?.(0, 8),
              });

              if (
                payload.eventType === "INSERT" ||
                payload.eventType === "UPDATE"
              ) {
                // Invalidate SWR cache for the affected branch
                if (payload.new?.branch_id) {
                  invalidateSWRCache(payload.new.branch_id);
                }

                const w = payload.new;
                if (w && w.id) {
                  // Keep existing docs if they exist in state (for full documents loaded from Details)
                  const existingDocs = workers[w.id]?.docs || {};
                  const docs: WorkerDocs = {};

                  // Extract all docs fields from realtime update
                  // Only override with realtime data if the docs field is explicitly present
                  if (w.docs !== undefined && w.docs !== null) {
                    let parsedDocs: any = {};
                    try {
                      parsedDocs =
                        typeof w.docs === "string"
                          ? JSON.parse(w.docs)
                          : w.docs;
                    } catch {
                      parsedDocs = {};
                    }

                    if (parsedDocs?.or) {
                      docs.or = parsedDocs.or;
                    }
                    if (parsedDocs?.passport) {
                      docs.passport = parsedDocs.passport;
                    }
                    if (parsedDocs?.plan) {
                      docs.plan = parsedDocs.plan;
                    }
                    if (parsedDocs?.avatar) {
                      docs.avatar = parsedDocs.avatar;
                    }
                    if (parsedDocs?.pre_change) {
                      docs.pre_change = parsedDocs.pre_change;
                    }
                    if (parsedDocs?.no_expense_days_override !== undefined) {
                      const overrideVal = Number(
                        parsedDocs.no_expense_days_override,
                      );
                      if (!Number.isNaN(overrideVal)) {
                        docs.no_expense_days_override = overrideVal;
                      }
                    }
                    if (
                      parsedDocs?.no_expense_days_override_set_at !== undefined
                    ) {
                      const overrideAt = Number(
                        parsedDocs.no_expense_days_override_set_at,
                      );
                      if (!Number.isNaN(overrideAt)) {
                        docs.no_expense_days_override_set_at = overrideAt;
                      }
                    }
                    if (
                      parsedDocs?.no_expense_extension_days_total !== undefined
                    ) {
                      const ext = Number(
                        parsedDocs.no_expense_extension_days_total,
                      );
                      if (!Number.isNaN(ext)) {
                        docs.no_expense_extension_days_total = ext;
                      }
                    }
                  }

                  // Include assigned_area from realtime update if present
                  if (w.assigned_area && w.assigned_area !== null) {
                    docs.assignedArea = w.assigned_area;
                  }

                  // Preserve existing docs data from client-side loads (e.g., from Details page)
                  // If realtime didn't send docs, keep all existing docs
                  const mergedDocs =
                    w.docs !== undefined && w.docs !== null
                      ? { ...existingDocs, ...docs }
                      : existingDocs;

                  // Determine plan based on merged docs
                  let plan: WorkerPlan = "no_expense";
                  if (
                    mergedDocs.plan === "with_expense" ||
                    mergedDocs.or ||
                    mergedDocs.passport
                  ) {
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
                // Invalidate SWR cache for the affected branch
                if (payload.old?.branch_id) {
                  invalidateSWRCache(payload.old.branch_id);
                }

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
          .subscribe(
            (status) => {
              if (status === "SUBSCRIBED") {
                console.log("[Realtime] Subscribed to workers updates");
              }
            },
            (error) => {
              if (error && isMounted) {
                console.warn("[Realtime] Workers subscription error:", error);
              }
            },
          );

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
                // Find the worker's branch and invalidate cache
                const worker = Object.values(workers).find(
                  (w: any) => w.id === payload.new?.worker_id,
                );
                if (worker?.branchId) {
                  invalidateSWRCache(worker.branchId);
                }

                const v = payload.new;
                if (v && v.id && v.worker_id) {
                  const workerBranchId = workers[v.worker_id]?.branchId || null;
                  const paymentTimestamp = v.payment_saved_at
                    ? new Date(v.payment_saved_at).getTime()
                    : null;
                  const normalizedAmount = normalizePaymentAmount(
                    workerBranchId,
                    v.payment_amount,
                  );
                  const verification: Verification = {
                    id: v.id,
                    workerId: v.worker_id,
                    verifiedAt: v.verified_at
                      ? new Date(v.verified_at).getTime()
                      : Date.now(),
                    payment:
                      normalizedAmount != null && paymentTimestamp != null
                        ? {
                            amount: normalizedAmount,
                            savedAt: paymentTimestamp,
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
                // Find the worker's branch and invalidate cache
                const worker = Object.values(workers).find(
                  (w: any) => w.id === payload.old?.worker_id,
                );
                if (worker?.branchId) {
                  invalidateSWRCache(worker.branchId);
                }

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
          .subscribe(
            (status) => {
              if (status === "SUBSCRIBED") {
                console.log("[Realtime] Subscribed to verifications updates");
              }
            },
            (error) => {
              if (error && isMounted) {
                console.warn(
                  "[Realtime] Verifications subscription error:",
                  error,
                );
              }
            },
          );

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
                  const fixedRateMap: Record<string, number> = {
                    "SAN AND HARRISON": 225,
                    "PARANAQUE AND AIRPORT": 225,
                    "BACOOR BRANCH": 225,
                    "CALANTAS BRANCH": 215,
                    "NAKAR BRANCH": 215,
                    "AREA BRANCH": 215,
                    "HARISSON BRANCH": 215,
                  };
                  const fixedRate = fixedRateMap[b.name];
                  let verificationAmount = 0;
                  let residencyRate = 0;

                  if (b.docs && typeof b.docs === "object") {
                    verificationAmount =
                      Number(b.docs.verification_amount) || 0;
                    residencyRate = Number(b.docs.residency_rate) || 0;
                  }

                  setBranches((prev) => ({
                    ...prev,
                    [b.id]: {
                      id: b.id,
                      name: b.name,
                      residencyRate:
                        residencyRate > 0
                          ? residencyRate
                          : fixedRate
                            ? fixedRate
                            : 220,
                      verificationAmount: applyFixedVerificationAmount(
                        b.name,
                        verificationAmount > 0 ? verificationAmount : undefined,
                      ),
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
          .subscribe(
            (status) => {
              if (status === "SUBSCRIBED") {
                console.log("[Realtime] Subscribed to branches updates");
              }
            },
            (error) => {
              if (error && isMounted) {
                console.warn("[Realtime] Branches subscription error:", error);
              }
            },
          );

        branchesSubscriptionRef.current = branchesChannel;
        // END OF DEAD CODE
      } catch (err: any) {
        console.error(
          "[Realtime] Error setting up subscriptions:",
          err?.message,
        );
      }
    };

    // Load initial data from server API
    loadInitialData();

    // Setup subscriptions (after initial data is loaded)
    setupSubscriptions();

    // Cleanup: unsubscribe from any active channels
    return () => {
      isMounted = false;
      isMountedRef.current = false;

      // Unsubscribe from all realtime channels (if any were created)
      try {
        if (workersSubscriptionRef.current) {
          workersSubscriptionRef.current.unsubscribe();
          workersSubscriptionRef.current = null;
        }
        if (verificationsSubscriptionRef.current) {
          verificationsSubscriptionRef.current.unsubscribe();
          verificationsSubscriptionRef.current = null;
        }
        if (branchesSubscriptionRef.current) {
          branchesSubscriptionRef.current.unsubscribe();
          branchesSubscriptionRef.current = null;
        }
      } catch (e) {
        console.debug("[WorkersContext] Cleanup error:", (e as any)?.message);
      }
    };
  }, []);

  // Note: Background docs loading has been disabled to prevent fetch errors
  // Documents are already loaded with workers from initial Realtime subscription
  // and will be updated when changes occur via Realtime events

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

  // Trigger data load when branch is selected
  useEffect(() => {
    if (!selectedBranchId) {
      console.log("[WorkersContext] No selectedBranchId, skipping auto-load");
      return;
    }

    console.log(
      "[BranchChangeEffect] Branch selected:",
      selectedBranchId.slice(0, 8),
      "- triggering data load",
    );

    // Small delay to ensure state is settled
    const timeoutId = setTimeout(() => {
      setRefreshTrigger((prev) => {
        const next = prev + 1;
        console.log(
          "[BranchChangeEffect] setRefreshTrigger:",
          prev,
          "=>",
          next,
        );
        return next;
      });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [selectedBranchId]);

  // Listen for verification updates and refresh data
  useEffect(() => {
    const handleVerificationUpdated = (e: any) => {
      const { verificationId, workerId } = e.detail || {};
      console.log("[WorkersContext] Verification updated event received", {
        verificationId: verificationId?.slice(0, 8),
        workerId: workerId?.slice(0, 8),
        selectedBranchId: selectedBranchId?.slice(0, 8),
      });

      // Invalidate cache immediately
      if (selectedBranchId) {
        console.log(
          "[WorkersContext] 🗑️ Invalidating SWR cache for branch:",
          selectedBranchId?.slice(0, 8),
        );
        invalidateSWRCache(selectedBranchId);

        // Wait for Supabase to process the write (500ms buffer to ensure data is persisted)
        // Then trigger refresh to fetch fresh data
        console.log(
          "[WorkersContext] ⏳ Waiting 500ms for Supabase to process...",
        );
        setTimeout(() => {
          console.log(
            "[WorkersContext] 🔄 Triggering refresh after Supabase delay",
          );
          setRefreshTrigger((prev) => {
            console.log(
              "[WorkersContext] 🔄 setRefreshTrigger called:",
              prev,
              "=>",
              prev + 1,
            );
            return prev + 1;
          });
        }, 500);
      } else {
        console.warn(
          "[WorkersContext] ⚠️  No selectedBranchId available for cache invalidation",
        );
      }
    };

    window.addEventListener(
      "verificationUpdated",
      handleVerificationUpdated as any,
    );
    return () => {
      window.removeEventListener(
        "verificationUpdated",
        handleVerificationUpdated as any,
      );
    };
  }, [selectedBranchId]);

  // Load branch data using SWR pattern (cache-first, then revalidate in background)
  useEffect(() => {
    console.log("[SWR] 📍 Effect triggered", {
      selectedBranchId: selectedBranchId?.slice(0, 8),
      refreshTrigger,
      supabase: !!supabase,
      mounted: isMountedRef.current,
    });

    if (!selectedBranchId || !isMountedRef.current) {
      if (!selectedBranchId) {
        setWorkersLoaded(false);
      }
      console.log("[SWR] ⏭️  Skipping load - missing dependencies:", {
        selectedBranchId: !!selectedBranchId,
        supabase: !!supabase,
        mounted: isMountedRef.current,
      });
      return;
    }

    let isAborted = false;
    branchFetchAbortRef.current?.abort();
    const branchFetchController = new AbortController();
    branchFetchAbortRef.current = branchFetchController;
    setWorkersLoaded(false);
    console.log(
      "[SWR] 🔄 Loading branch data with cache-first pattern:",
      selectedBranchId.slice(0, 8),
    );

    const fetchBranchData = async (signal: AbortSignal) => {
      const ensureActive = () => {
        if (signal.aborted) {
          throw new DOMException("Branch fetch aborted", "AbortError");
        }
      };

      try {
        console.log(
          "[fetchBranchData] Fetching fresh data for branch:",
          selectedBranchId?.slice(0, 8),
        );

        if (!selectedBranchId) {
          console.error("[fetchBranchData] No branch selected");
          return {};
        }

        if (signal.aborted) {
          throw new DOMException("Branch fetch aborted", "AbortError");
        }

        const WORKERS_PAGE_SIZE = 200;
        const normalizeWorkersPayload = (payload: any) => {
          if (Array.isArray(payload?.data)) return payload.data;
          if (Array.isArray(payload?.workers)) return payload.workers;
          return [];
        };

        const fetchWorkersViaSupabase = async (
          branchId: string,
          signal?: AbortSignal,
        ) => {
          try {
            if (supabase) {
              if (signal?.aborted) {
                throw new DOMException("Branch fetch aborted", "AbortError");
              }
              const { data, error } = await supabase
                .from("hv_workers")
                .select(WORKER_SUMMARY_SELECT)
                .eq("branch_id", branchId)
                .order("arrival_date", { ascending: false })
                .limit(500);
              if (error) throw error;
              console.warn(
                "[fetchBranchData] Supabase client fallback workers",
                {
                  count: data?.length || 0,
                },
              );
              return (
                data?.map((row: any) => {
                  const docs = deriveDocsFromPayload(row);
                  const normalized = { ...row, docs };
                  stripDocAliasFields(normalized);
                  return normalized;
                }) || []
              );
            }

            if (!SUPABASE_REST_URL || !SUPABASE_ANON) return [];
            const pageSize = 200;
            let offset = 0;
            const all: any[] = [];
            while (true) {
              const url = new URL(`${SUPABASE_REST_URL}/hv_workers`);
              url.searchParams.set("select", WORKER_SUMMARY_SELECT);
              url.searchParams.set("branch_id", `eq.${branchId}`);
              url.searchParams.set("order", "arrival_date.desc");
              url.searchParams.set("limit", String(pageSize));
              url.searchParams.set("offset", String(offset));
              const res = await fetch(url.toString(), {
                signal,
                headers: {
                  apikey: SUPABASE_ANON,
                  Authorization: `Bearer ${SUPABASE_ANON}`,
                },
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const batch = (await res.json()) || [];
              const normalizedBatch = batch.map((row: any) => {
                const docs = deriveDocsFromPayload(row);
                const normalized = { ...row, docs };
                stripDocAliasFields(normalized);
                return normalized;
              });
              all.push(...normalizedBatch);
              if (!Array.isArray(batch) || batch.length < pageSize) break;
              offset += pageSize;
              if (offset >= 2000) break; // safety limit
            }
            console.warn("[fetchBranchData] Supabase REST fallback workers", {
              count: all.length,
            });
            return all;
          } catch (err: any) {
            console.error(
              "[fetchBranchData] Supabase fallback workers failed:",
              err?.message,
            );
            return [];
          }
        };

        const fetchVerificationsViaSupabase = async (
          signal?: AbortSignal,
        ) => {
          try {
            if (supabase) {
              if (signal?.aborted) {
                throw new DOMException("Branch fetch aborted", "AbortError");
              }
              const { data, error } = await supabase
                .from("hv_verifications")
                .select(
                  "id,worker_id,verified_at,payment_amount,payment_saved_at",
                )
                .order("verified_at", { ascending: false })
                .limit(5000);
              if (error) throw error;
              console.warn(
                "[fetchBranchData] Supabase client fallback verifications",
                {
                  count: data?.length || 0,
                },
              );
              return data || [];
            }

            if (!SUPABASE_REST_URL || !SUPABASE_ANON) return [];
            const pageSize = 500;
            let offset = 0;
            const all: any[] = [];
            while (true) {
              const url = new URL(`${SUPABASE_REST_URL}/hv_verifications`);
              url.searchParams.set(
                "select",
                "id,worker_id,verified_at,payment_amount,payment_saved_at",
              );
              url.searchParams.set("order", "verified_at.desc");
              url.searchParams.set("limit", String(pageSize));
              url.searchParams.set("offset", String(offset));
              const res = await fetch(url.toString(), {
                signal,
                headers: {
                  apikey: SUPABASE_ANON,
                  Authorization: `Bearer ${SUPABASE_ANON}`,
                },
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const batch = (await res.json()) || [];
              all.push(...batch);
              if (!Array.isArray(batch) || batch.length < pageSize) break;
              offset += pageSize;
              if (offset >= 5000) break; // safety guard
            }
            console.warn(
              "[fetchBranchData] Supabase REST fallback verifications",
              {
                count: all.length,
              },
            );
            return all;
          } catch (err: any) {
            console.error(
              "[fetchBranchData] Supabase fallback verifications failed:",
              err?.message,
            );
            return [];
          }
        };

        // Use server API endpoints instead of direct Supabase calls
        // Wrap fetch calls with timeout and better error handling
        const fetchWithTimeout = async (
          url: string,
          timeoutMs: number = 30000,
          externalSignal?: AbortSignal,
        ): Promise<Response | null> => {
          const controller = new AbortController();
          let timeoutId: NodeJS.Timeout | null = null;
          let isTimedOut = false;
          let removeExternalListener: (() => void) | null = null;

          if (externalSignal) {
            if (externalSignal.aborted) {
              controller.abort();
            } else {
              const handleExternalAbort = () => controller.abort();
              externalSignal.addEventListener("abort", handleExternalAbort, {
                once: true,
              });
              removeExternalListener = () =>
                externalSignal.removeEventListener(
                  "abort",
                  handleExternalAbort,
                  true,
                );
            }
          }

          timeoutId = setTimeout(() => {
            isTimedOut = true;
            controller.abort();
            console.warn(
              `[fetchBranchData] Request timeout (${timeoutMs}ms) for ${url}`,
            );
          }, timeoutMs);

          const headers: Record<string, string> = {};
          const shouldBypassNgrokWarning = (() => {
            try {
              const base = isAbsoluteUrl(url)
                ? new URL(url)
                : new URL(
                    url,
                    typeof window !== "undefined"
                      ? window.location.origin
                      : "https://localhost",
                  );
              return /ngrok/i.test(base.hostname);
            } catch {
              return false;
            }
          })();
          if (shouldBypassNgrokWarning) {
            headers["ngrok-skip-browser-warning"] = "true";
          }

          try {
            const response = await fetch(url, {
              signal: controller.signal,
              headers,
            });
            if (timeoutId) clearTimeout(timeoutId);
            if (removeExternalListener) removeExternalListener();
            return response;
          } catch (error: any) {
            if (timeoutId) clearTimeout(timeoutId);
            if (removeExternalListener) removeExternalListener();

            // Log all error types
            console.warn(
              `[fetchBranchData] Fetch error for ${url}:`,
              error?.name,
              error?.message,
            );

            // If it was an AbortError due to timeout, don't re-throw
            if (error?.name === "AbortError" && isTimedOut) {
              console.warn(
                `[fetchBranchData] Request timed out for ${url} (${timeoutMs}ms)`,
              );
              return null;
            }

            // If it's a different abort error (e.g., component unmounted), also don't crash
            if (error?.name === "AbortError") {
              console.debug(
                `[fetchBranchData] Request aborted for ${url}:`,
                error?.message,
              );
              return null;
            }

            // For any other error (network error, CORS, server down, etc)
            console.error(
              `[fetchBranchData] Fetch failed for ${url}:`,
              error?.message,
            );
            return null;
          }
        };

        const fetchApiEndpoint = async (
          pathOrUrl: string,
          timeoutMs: number,
          signal?: AbortSignal,
        ): Promise<Response | null> => {
          const urlsToTry: string[] = [];
          if (isAbsoluteUrl(pathOrUrl)) {
            urlsToTry.push(pathOrUrl);
          } else {
            urlsToTry.push(pathOrUrl);
            API_BASE_FALLBACKS.forEach((base) => {
              urlsToTry.push(buildApiUrlFromBase(base, pathOrUrl));
            });
          }

          const attempted = new Set<string>();
          for (const target of urlsToTry) {
            if (attempted.has(target)) continue;
            attempted.add(target);

            try {
              const response = await fetchWithTimeout(
                target,
                timeoutMs,
                signal,
              );
              if (response) {
                if (target !== pathOrUrl) {
                  console.warn(
                    "[fetchBranchData] API fallback origin succeeded for",
                    pathOrUrl,
                    "via",
                    target,
                  );
                }
                return response;
              }
            } catch (err: any) {
              console.warn(
                "[fetchBranchData] API attempt threw before fallback",
                target,
                err?.message,
              );
            }
          }

          console.warn(
            "[fetchBranchData] All API endpoint attempts failed for",
            pathOrUrl,
          );
          return null;
        };

        // Fetch workers data
        let workersJson = { data: [] as any[] };
        let workerFallbackUsed = false;
        const aggregatedWorkers: any[] = [];
        try {
          const buildWorkersPath = (page: number) =>
            `/api/workers/branch/${selectedBranchId}?page=${page}&pageSize=${WORKERS_PAGE_SIZE}`;
          const workersResponse = await fetchApiEndpoint(
            buildWorkersPath(1),
            30000,
            signal,
          );
          if (workersResponse && workersResponse.ok) {
            workersJson = await workersResponse
              .json()
              .catch(() => ({ data: [] }));
            const initialBatch = normalizeWorkersPayload(workersJson);
            aggregatedWorkers.push(...initialBatch);

            const total = Number(workersJson.total ?? initialBatch.length ?? 0);
            const pageSize =
              Number(
                workersJson.pageSize ??
                  workersJson?.meta?.pageSize ??
                  initialBatch.length ??
                  WORKERS_PAGE_SIZE,
              ) || WORKERS_PAGE_SIZE;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));

            if (totalPages > 1) {
              const maxPagesToLoad = 5; // Limit to 5 pages (250 workers) to reduce egress
              const pagesToFetch = Math.min(totalPages, maxPagesToLoad);
              for (let page = 2; page <= pagesToFetch; page++) {
                try {
                  const pageResponse = await fetchApiEndpoint(
                    buildWorkersPath(page),
                    30000,
                    signal,
                  );
                  if (pageResponse && pageResponse.ok) {
                    const pageJson = await pageResponse
                      .json()
                      .catch(() => ({ data: [] }));
                    const batch = normalizeWorkersPayload(pageJson);
                    aggregatedWorkers.push(...batch);
                  } else {
                    console.warn(
                      "[fetchBranchData] API workers page response failed, stopping pagination (max 5 pages)",
                      pageResponse?.status,
                    );
                    break;
                  }
                } catch (pageErr: any) {
                  console.warn(
                    "[fetchBranchData] API workers page threw, stopping pagination:",
                    pageErr?.message,
                  );
                  break;
                }
              }
            }

            workersJson = { ...workersJson, data: aggregatedWorkers };
          } else {
            if (workersResponse && !workersResponse.ok) {
              console.warn(
                "[fetchBranchData] API workers response not ok, using fallback",
                workersResponse.status,
              );
            }
            workersJson = {
              data: await fetchWorkersViaSupabase(selectedBranchId, signal),
            };
            workerFallbackUsed = true;
          }
        } catch (err: any) {
          console.warn(
            "[fetchBranchData] workers endpoint fetch threw before fallback:",
            err?.message,
          );
          workersJson = {
            data: await fetchWorkersViaSupabase(selectedBranchId, signal),
          };
          workerFallbackUsed = true;
        }

        if (
          workerFallbackUsed &&
          (!workersJson.data || workersJson.data.length === 0)
        ) {
          const cached = getSWRCache(selectedBranchId);
          if (cached && Object.keys(cached).length > 0) {
            console.warn(
              "[fetchBranchData] Using cached workers data as last resort",
            );
            workersJson = { data: Object.values(cached) };
          }
        }

        // Fetch verifications data
        let verifJson: any = { verifications: [] };
        let verFallbackUsed = false;
        try {
          const verifResponse = await fetchApiEndpoint(
            "/api/data/verifications?limit=500&days=7",
            30000,
            signal,
          );
          if (verifResponse && verifResponse.ok) {
            verifJson = await verifResponse
              .json()
              .catch(() => ({ verifications: [] }));
          } else {
            if (verifResponse && !verifResponse.ok) {
              console.warn(
                "[fetchBranchData] API verifications response not ok, using fallback",
                verifResponse.status,
              );
            }
            verifJson = {
              verifications: await fetchVerificationsViaSupabase(signal),
            };
            verFallbackUsed = true;
          }
        } catch (err: any) {
          console.warn(
            "[fetchBranchData] verifications endpoint fetch threw before fallback:",
            err?.message,
          );
          verifJson = {
            verifications: await fetchVerificationsViaSupabase(signal),
          };
          verFallbackUsed = true;
        }

        if (
          verFallbackUsed &&
          (!verifJson.verifications || verifJson.verifications.length === 0)
        ) {
          const cached = getSWRCache(selectedBranchId);
          if (cached) {
            const fromCachedWorkers = Object.values(cached)
              .map((w: any) => w.verifications || [])
              .flat();
            if (fromCachedWorkers.length > 0) {
              console.warn(
                "[fetchBranchData] Using cached verifications as last resort",
              );
              verifJson = { verifications: fromCachedWorkers };
            }
          }
        }

        // Extract data from results
        const workersData = workersJson?.data ?? [];
        const verifications = verifJson?.verifications ?? verifJson?.data ?? [];

        console.log("[fetchBranchData] Handling results:", {
          workersData: workersData.length,
          verifData: verifications.length,
        });

        if (!isMountedRef.current || isAborted) return {};

        // Log detailed verification data for debugging
        if (Array.isArray(verifications) && verifications.length > 0) {
          const allPayments = verifications.filter(
            (v: any) => v.payment_amount != null,
          );
          console.log("[fetchBranchData] All verifications received:", {
            total: verifications.length,
            withPaymentAmount: allPayments.length,
            paymentDetails: verifications.slice(0, 5).map((v: any) => ({
              id: v.id?.slice(0, 8),
              worker_id: v.worker_id?.slice(0, 8),
              payment_amount: v.payment_amount,
              payment_saved_at: v.payment_saved_at,
              verified_at: v.verified_at,
            })),
          });
        }

        const workerMap: Record<string, Worker> = {};
        if (Array.isArray(workersData) && workersData.length > 0) {
          workersData.forEach((w: any) => {
            const docs = deriveDocsFromPayload(w);

            const hasDocuments =
              docs.plan === "with_expense" || !!docs.or || !!docs.passport;
            let plan: WorkerPlan = hasDocuments ? "with_expense" : "no_expense";
            if (docs.plan === "with_expense" || docs.plan === "no_expense") {
              plan = docs.plan;
            }
            if (!docs.plan) {
              docs.plan = plan;
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
        }

        // Attach verifications to workers
        if (Array.isArray(verifications) && verifications.length > 0) {
          const verByWorker: Record<string, Verification[]> = {};

          // Log verifications with payment data
          const withPayment = verifications.filter(
            (v: any) => v.payment_amount != null && v.payment_saved_at,
          );

          // Check for recent payments (last 3)
          const recentPayments = verifications
            .filter((v: any) => v.payment_saved_at)
            .sort(
              (a: any, b: any) =>
                new Date(b.payment_saved_at).getTime() -
                new Date(a.payment_saved_at).getTime(),
            )
            .slice(0, 3);

          console.log("[fetchBranchData] Processing verifications:", {
            total: verifications.length,
            withPayment: withPayment.length,
            recentPayments: recentPayments.map((v: any) => ({
              id: v.id?.slice(0, 8),
              worker_id: v.worker_id?.slice(0, 8),
              payment_amount: v.payment_amount,
              payment_saved_at: v.payment_saved_at,
            })),
            allVerifications: verifications.map((v: any) => ({
              id: v.id?.slice(0, 8),
              worker_id: v.worker_id?.slice(0, 8),
              payment_amount: v.payment_amount,
            })),
          });

          verifications.forEach((v: any) => {
            if (workerMap[v.worker_id]) {
              const paymentTimestamp = v.payment_saved_at
                ? new Date(v.payment_saved_at).getTime()
                : null;
              const normalizedAmount = normalizePaymentAmount(
                workerMap[v.worker_id]?.branchId,
                v.payment_amount,
              );
              const verification: Verification = {
                id: v.id,
                workerId: v.worker_id,
                verifiedAt: v.verified_at
                  ? new Date(v.verified_at).getTime()
                  : Date.now(),
                payment:
                  normalizedAmount != null && paymentTimestamp != null
                    ? {
                        amount: normalizedAmount,
                        savedAt: paymentTimestamp,
                      }
                    : undefined,
              };
              (verByWorker[v.worker_id] ||= []).push(verification);
            }
          });

          for (const wid in verByWorker) {
            if (workerMap[wid]) {
              workerMap[wid].verifications = verByWorker[wid].sort(
                (a, b) => b.verifiedAt - a.verifiedAt,
              );
            }
          }
        }

        // Cache the fresh data using SWR pattern
        setSWRCache(selectedBranchId, workerMap);

        // Log verification data BEFORE setState
        const workersWithPayments = Object.values(workerMap).filter((w) =>
          w.verifications?.some((v) => v.payment?.savedAt),
        );
        console.log(
          "[fetchBranchData] Workers with confirmed payments:",
          workersWithPayments.length,
          workersWithPayments.map((w) => ({
            id: w.id?.slice(0, 8),
            name: w.name,
            confirmedPayments:
              w.verifications?.filter((v) => v.payment?.savedAt).length || 0,
          })),
        );

        setWorkers((prev) => {
          const result: Record<string, Worker> = {};
          // Keep workers from other branches that might have been cached
          for (const wid in prev) {
            if (prev[wid].branchId !== selectedBranchId) {
              result[wid] = prev[wid];
            }
          }
          // Add all new workers for this branch
          const final = { ...result, ...workerMap };

          // Log AFTER merge to verify the data made it through
          const finalWithPayments = Object.values(final).filter(
            (w) =>
              w.branchId === selectedBranchId &&
              w.verifications?.some((v) => v.payment?.savedAt),
          );
          console.log(
            "[setWorkers] Workers with confirmed payments (after merge):",
            finalWithPayments.length,
          );

          return final;
        });
        console.log(
          "[BranchEffect] ✅ Loaded",
          Object.keys(workerMap).length,
          "workers for branch",
        );
      } catch (e: any) {
        console.error("[SWR] Error loading branch data:", {
          message: e?.message,
          code: e?.code,
          status: e?.status,
          name: e?.name,
          stack: e?.stack?.substring(0, 200),
        });

        // Log environment check
        console.warn("[SWR] Environment check:", {
          supabaseUrlExists: !!SUPABASE_URL,
          supabaseKeyExists: !!SUPABASE_ANON,
          supabaseUrl: SUPABASE_URL?.substring(0, 20) + "...",
          clientExists: !!supabase,
        });

        // Return empty to allow graceful fallback
        return {};
      }
    };

    // SWR Strategy: Show cached data first, then revalidate
    const cachedData = getSWRCache(selectedBranchId);
    if (cachedData && Object.keys(cachedData).length > 0) {
      console.log(
        "[SWR] Using cached data for branch:",
        selectedBranchId.slice(0, 8),
      );
      setWorkers((prev) => {
        const result: Record<string, Worker> = {};
        // Keep workers from other branches
        for (const wid in prev) {
          if (prev[wid].branchId !== selectedBranchId) {
            result[wid] = prev[wid];
          }
        }
        // Add cached workers
        return { ...result, ...cachedData };
      });
    }

    // Fetch fresh data in background
    fetchBranchData(branchFetchController.signal)
      .catch((err) => {
        if ((err as any)?.name === "AbortError") {
          console.debug("[SWR] Branch fetch aborted");
          return;
        }
        console.error(
          "[SWR] Error fetching branch data:",
          (err as any)?.message,
        );
        // Even if fetch fails, cached data will be shown (if available)
        // or fallback empty state
      })
      .finally(() => {
        if (!isAborted) {
          setWorkersLoaded(true);
        }
      });

    return () => {
      isAborted = true;
      branchFetchController.abort();
      if (branchFetchAbortRef.current === branchFetchController) {
        branchFetchAbortRef.current = null;
      }
    };
  }, [selectedBranchId, refreshTrigger]);

  // Load full documents for a specific worker (lazy-load on Details page)
  const loadWorkerFullDocs = useCallback(
    async (workerId: string) => {
      const parseWorkerDocs = (worker: any): WorkerDocs => {
        const docs: WorkerDocs = {};
        if (worker?.docs) {
          try {
            const parsedDocs =
              typeof worker.docs === "string"
                ? JSON.parse(worker.docs)
                : worker.docs;

            console.log("[WorkersContext] Parsed worker docs:", {
              workerId: workerId.slice(0, 8),
              docsType: typeof parsedDocs,
              hasOr: !!parsedDocs?.or,
              hasPassport: !!parsedDocs?.passport,
              orLength: String(parsedDocs?.or || "").slice(0, 50),
              passportLength: String(parsedDocs?.passport || "").slice(0, 50),
            });

            if (parsedDocs?.or) docs.or = parsedDocs.or;
            if (parsedDocs?.passport) docs.passport = parsedDocs.passport;
            if (parsedDocs?.avatar) docs.avatar = parsedDocs.avatar;
            if (parsedDocs?.plan) docs.plan = parsedDocs.plan;
            if (parsedDocs?.pre_change) docs.pre_change = parsedDocs.pre_change;
            if (parsedDocs?.no_expense_days_override !== undefined) {
              const overrideVal = Number(parsedDocs.no_expense_days_override);
              if (!Number.isNaN(overrideVal)) {
                docs.no_expense_days_override = overrideVal;
              }
            }
            if (parsedDocs?.no_expense_days_override_set_at !== undefined) {
              const overrideAt = Number(
                parsedDocs.no_expense_days_override_set_at,
              );
              if (!Number.isNaN(overrideAt)) {
                docs.no_expense_days_override_set_at = overrideAt;
              }
            }
            if (parsedDocs?.no_expense_extension_days_total !== undefined) {
              const ext = Number(parsedDocs.no_expense_extension_days_total);
              if (!Number.isNaN(ext)) {
                docs.no_expense_extension_days_total = ext;
              }
            }
          } catch (parseErr) {
            console.error(
              "[WorkersContext] Failed to parse worker docs:",
              parseErr,
            );
          }
        }
        return docs;
      };

      const fetchWorkerViaApi = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        try {
          const headers: Record<string, string> = {};
          try {
            if (
              typeof window !== "undefined" &&
              /ngrok/i.test(window.location.host)
            ) {
              headers["ngrok-skip-browser-warning"] = "true";
            }
          } catch {}

          const res = await fetch(`/api/data/workers/${workerId}`, {
            cache: "no-store",
            signal: controller.signal,
            headers: Object.keys(headers).length ? headers : undefined,
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            console.warn(
              "[WorkersContext] Failed to load worker docs via API:",
              res.status,
            );
            return null;
          }
          const data = await res.json().catch(() => null);
          return data?.ok && data?.worker ? data.worker : null;
        } catch (err: any) {
          clearTimeout(timeoutId);
          if (err?.name === "AbortError") {
            console.warn(
              "[WorkersContext] loadWorkerFullDocs API request timed out",
            );
          } else {
            console.warn(
              "[WorkersContext] loadWorkerFullDocs API fetch error:",
              err?.message || String(err),
            );
          }
          return null;
        }
      };

      const fetchWorkerViaSupabase = async () => {
        try {
          if (supabase) {
            const { data, error } = await supabase
              .from("hv_workers")
              .select(
                "id,name,arrival_date,branch_id,exit_date,exit_reason,status,assigned_area,docs",
              )
              .eq("id", workerId)
              .limit(1);
            if (!error && Array.isArray(data) && data.length > 0) {
              console.warn(
                "[WorkersContext] loadWorkerFullDocs using Supabase client fallback",
              );
              return data[0];
            }
          }

          if (SUPABASE_REST_URL && SUPABASE_ANON) {
            const u = new URL(`${SUPABASE_REST_URL}/hv_workers`);
            u.searchParams.set(
              "select",
              "id,name,arrival_date,branch_id,exit_date,exit_reason,status,assigned_area,docs",
            );
            u.searchParams.set("id", `eq.${workerId}`);
            const res = await fetch(u.toString(), {
              headers: {
                apikey: SUPABASE_ANON,
                Authorization: `Bearer ${SUPABASE_ANON}`,
              },
            });
            if (res.ok) {
              const arr = await res.json();
              if (Array.isArray(arr) && arr.length > 0) {
                console.warn(
                  "[WorkersContext] loadWorkerFullDocs using Supabase REST fallback",
                );
                return arr[0];
              }
            } else {
              console.warn(
                "[WorkersContext] Supabase REST fallback failed:",
                res.status,
              );
            }
          }
        } catch (err: any) {
          console.warn(
            "[WorkersContext] Supabase fallback failed:",
            err?.message || String(err),
          );
        }
        return null;
      };

      try {
        console.log(
          "[WorkersContext] Loading full documents for worker:",
          workerId,
        );

        let worker = await fetchWorkerViaApi();
        if (!worker) {
          worker = await fetchWorkerViaSupabase();
        }
        if (!worker) {
          console.warn("[WorkersContext] No worker data found for", workerId);
          return null;
        }

        const docs = parseWorkerDocs(worker);

        if (worker.assigned_area && worker.assigned_area !== null) {
          docs.assignedArea = worker.assigned_area;
        }

        setWorkers((prev) => {
          const current = prev[workerId];
          if (!current) return prev;
          return {
            ...prev,
            [workerId]: {
              ...current,
              docs,
            },
          };
        });
        console.log("[WorkersContext] ✓ Worker full documents loaded:", {
          workerId: workerId.slice(0, 8),
          hasOr: !!docs.or,
          hasPassport: !!docs.passport,
        });
        return docs;
      } catch (err) {
        console.error("[WorkersContext] Error loading worker full docs:", err);
        return null;
      }
    },
    [SUPABASE_REST_URL],
  );

  // Refresh worker documents from server
  const refreshWorkers = useCallback(async (options?: { full?: boolean }) => {
    const activeBranchId = selectedBranchIdRef.current;
    if (!activeBranchId) {
      console.warn(
        "[WorkersContext] refreshWorkers skipped - no branch selected",
      );
      return;
    }

    try {
      console.log(
        "[WorkersContext] Refreshing worker documents for branch",
        activeBranchId.slice(0, 8),
      );

      const params = new URLSearchParams();
      params.set("branchId", activeBranchId);
      if (options?.full) {
        params.set("nocache", "1");
      } else {
        const lastSynced = lastDocsSyncRef.current[activeBranchId];
        if (lastSynced) {
          params.set("updatedSince", lastSynced);
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      try {
        const res = await fetch(`/api/data/workers-docs?${params.toString()}`, {
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
          const syncStamp =
            typeof data?.syncedAt === "string" && data.syncedAt.length > 0
              ? data.syncedAt
              : new Date().toISOString();
          lastDocsSyncRef.current[activeBranchId] = syncStamp;
          console.log(
            "[WorkersContext] ✓ Worker documents refreshed for branch",
            activeBranchId.slice(0, 8),
          );
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
    branchesLoaded,
    workersLoaded,
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
  if (!ctx) {
    console.warn(
      "[useWorkers] Context not found - returning fallback (ensure component is wrapped with WorkersProvider)",
    );
    // Return a minimal safe context instead of throwing
    // This prevents app crash and allows graceful degradation
    return {
      branches: {},
      workers: {},
      sessionPendingIds: [],
      sessionVerifications: [],
      selectedBranchId: null,
      branchesLoaded: false,
      workersLoaded: false,
      setSelectedBranchId: () => {},
      addBranch: () => ({ id: "", name: "" }),
      createBranch: async (
        _name?: string,
        _password?: string,
        _options?: CreateBranchOptions,
      ) => ({ id: "", name: "" }),
      getOrCreateBranchId: () => "",
      addWorker: () => ({
        id: "",
        name: "",
        arrivalDate: 0,
        branchId: "",
        verifications: [],
        status: "active",
        docs: {},
      }),
      addLocalWorker: () => ({
        id: "",
        name: "",
        arrivalDate: 0,
        branchId: "",
        verifications: [],
        status: "active",
        docs: {},
      }),
      addWorkersBulk: () => {},
      addVerification: () => null,
      savePayment: () => {},
      refreshWorkers: async () => {},
      upsertExternalWorker: () => {},
      updateWorkerDocs: () => {},
      updateWorkerStatuses: () => {},
      specialRequests: [],
      addSpecialRequest: () => ({ id: "", name: "", createdAt: 0 }),
      setWorkerExit: () => {},
      requestUnlock: () => null,
      decideUnlock: () => {},
      resolveWorkerRequest: () => {},
      loadWorkerFullDocs: async () => null,
    } as WorkersState;
  }
  return ctx;
}
