import React, { createContext, useContext, useMemo, useState, useEffect } from "react";

export interface Branch { id: string; name: string }
export interface WorkerDocs { or?: string; passport?: string }
export interface Worker { id: string; name: string; arrivalDate: number; branchId: string; verifications: Verification[]; docs?: WorkerDocs }
export interface Verification { id: string; workerId: string; verifiedAt: number; payment?: { amount: number; savedAt: number } }

export const SPECIAL_REQ_GRACE_MS = 72 * 60 * 60 * 1000;
interface SpecialRequest { id: string; type: "worker" | "admin"; createdAt: number; amount: number; workerId?: string; workerName?: string; adminRepName?: string; imageDataUrl?: string; unregistered?: boolean }

interface WorkersState {
  branches: Record<string, Branch>;
  workers: Record<string, Worker>;
  sessionPendingIds: string[];
  sessionVerifications: Verification[];
  selectedBranchId: string | null;
  setSelectedBranchId: (id: string | null) => void;
  addBranch: (name: string) => Branch;
  getOrCreateBranchId: (name: string) => string;
  addWorker: (name: string, arrivalDate: number, branchId: string, docs?: WorkerDocs) => Worker;
  addWorkersBulk: (items: { name: string; arrivalDate: number; branchName?: string; branchId?: string }[]) => void;
  addVerification: (workerId: string, verifiedAt: number) => Verification | null;
  savePayment: (verificationId: string, amount: number) => void;
  specialRequests: SpecialRequest[];
  addSpecialRequest: (req: Omit<SpecialRequest, "id" | "createdAt"> & { createdAt?: number }) => SpecialRequest;
}

const WorkersContext = createContext<WorkersState | null>(null);

const LS_KEY = "hv_state_v1";

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
  const initialBranches: Record<string, Branch> = useMemo(() => {
    const a: Branch = { id: crypto.randomUUID(), name: "الفرع 1" };
    const b: Branch = { id: crypto.randomUUID(), name: "الفرع 2" };
    return { [a.id]: a, [b.id]: b };
  }, []);

  const initialWorkers = useMemo(() => {
    const branchIds = Object.keys(initialBranches);
    const list = ["أحمد", "محمد", "خالد", "سالم", "عبدالله"].map((name, i) => ({ id: crypto.randomUUID(), name, arrivalDate: Date.now(), branchId: branchIds[i % branchIds.length], verifications: [], docs: {} }));
    const rec: Record<string, Worker> = {}; list.forEach((w) => (rec[w.id] = w)); return rec;
  }, [initialBranches]);

  const persisted = typeof window !== "undefined" ? loadPersisted() : null;

  const [branches, setBranches] = useState<Record<string, Branch>>(() => persisted?.branches ?? initialBranches);
  const [workers, setWorkers] = useState<Record<string, Worker>>(() => persisted?.workers ?? initialWorkers);
  const [sessionPendingIds, setSessionPendingIds] = useState<string[]>(() => persisted?.sessionPendingIds ?? Object.keys(persisted?.workers ?? initialWorkers));
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(() => persisted?.selectedBranchId ?? Object.keys(persisted?.branches ?? initialBranches)[0] ?? null);
  const [sessionVerifications, setSessionVerifications] = useState<Verification[]>(() => persisted?.sessionVerifications ?? []);
  const [specialRequests, setSpecialRequests] = useState<SpecialRequest[]>(() => persisted?.specialRequests ?? []);

  useEffect(() => {
    const state = { branches, workers, sessionPendingIds, sessionVerifications, selectedBranchId, specialRequests };
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
  }, [branches, workers, sessionPendingIds, sessionVerifications, selectedBranchId, specialRequests]);

  const addBranch = (name: string): Branch => { const exists = Object.values(branches).find((b) => b.name === name); if (exists) return exists; const b: Branch = { id: crypto.randomUUID(), name }; setBranches((prev) => ({ ...prev, [b.id]: b })); return b; };
  const getOrCreateBranchId = (name: string) => addBranch(name).id;

  const addWorker = (name: string, arrivalDate: number, branchId: string, docs?: WorkerDocs): Worker => { const w: Worker = { id: crypto.randomUUID(), name, arrivalDate, branchId, verifications: [], docs }; setWorkers((prev) => ({ ...prev, [w.id]: w })); setSessionPendingIds((prev) => [w.id, ...prev]); return w; };

  const addWorkersBulk = (items: { name: string; arrivalDate: number; branchName?: string; branchId?: string }[]) => {
    if (!items.length) return; setWorkers((prev) => { const next = { ...prev }; items.forEach((it) => { const bId = it.branchId || (it.branchName ? getOrCreateBranchId(it.branchName) : Object.keys(branches)[0]); const w: Worker = { id: crypto.randomUUID(), name: it.name, arrivalDate: it.arrivalDate, branchId: bId, verifications: [] }; next[w.id] = w; setSessionPendingIds((p) => [w.id, ...p]); }); return next; });
  };

  const addVerification = (workerId: string, verifiedAt: number) => { const worker = workers[workerId]; if (!worker) return null; const v: Verification = { id: crypto.randomUUID(), workerId, verifiedAt }; setWorkers((prev) => ({ ...prev, [workerId]: { ...prev[workerId], verifications: [v, ...prev[workerId].verifications] } })); setSessionVerifications((prev) => [v, ...prev]); setSessionPendingIds((prev) => prev.filter((id) => id !== workerId)); return v; };

  const savePayment = (verificationId: string, amount: number) => {
    setWorkers((prev) => {
      const next = { ...prev };
      for (const id in next) {
        const idx = next[id].verifications.findIndex((vv) => vv.id === verificationId);
        if (idx !== -1) { const vv = next[id].verifications[idx]; next[id].verifications[idx] = { ...vv, payment: { amount, savedAt: Date.now() } }; break; }
      }
      return next;
    });
    setSessionVerifications((prev) => prev.map((vv) => (vv.id === verificationId ? { ...vv, payment: { amount, savedAt: Date.now() } } : vv)));
  };

  const addSpecialRequest: WorkersState["addSpecialRequest"] = (req) => { const r: SpecialRequest = { id: crypto.randomUUID(), createdAt: req.createdAt ?? Date.now(), ...req } as SpecialRequest; setSpecialRequests((prev) => [r, ...prev]); return r; };

  const value: WorkersState = { branches, workers, sessionPendingIds, sessionVerifications, selectedBranchId, setSelectedBranchId, addBranch, getOrCreateBranchId, addWorker, addWorkersBulk, addVerification, savePayment, specialRequests, addSpecialRequest };

  return <WorkersContext.Provider value={value}>{children}</WorkersContext.Provider>;
}

export function useWorkers() { const ctx = useContext(WorkersContext); if (!ctx) throw new Error("useWorkers must be used within WorkersProvider"); return ctx; }
