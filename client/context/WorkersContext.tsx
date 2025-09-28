import React, { createContext, useContext, useMemo, useState } from "react";

export interface Worker {
  id: string;
  name: string;
  arrivalDate?: number;
  verifications: { id: string; verifiedAt: number; image?: string }[];
}

interface WorkersState {
  workers: Record<string, Worker>;
  pendingIds: string[];
  verified: { id: string; workerId: string; verifiedAt: number; image?: string }[];
  addWorker: (name: string, arrivalDate?: number) => void;
  verify: (id: string, image?: string) => void;
}

const WorkersContext = createContext<WorkersState | null>(null);

export function WorkersProvider({ children }: { children: React.ReactNode }) {
  const initialWorkers = useMemo(() => {
    const names = ["أحمد", "فاطمة", "محمد", "خالد", "سارة", "ريم", "ياسر", "ليلى"]; 
    const rec: Record<string, Worker> = {};
    names.forEach((n) => {
      const id = crypto.randomUUID();
      rec[id] = { id, name: n, arrivalDate: Date.now(), verifications: [] };
    });
    return rec;
  }, []);

  const [workers, setWorkers] = useState<Record<string, Worker>>(initialWorkers);
  const [pendingIds, setPending] = useState<string[]>(() => Object.keys(initialWorkers));
  const [verified, setVerified] = useState<WorkersState["verified"]>([]);

  const addWorker: WorkersState["addWorker"] = (name, arrivalDate) => {
    const id = crypto.randomUUID();
    setWorkers((p) => ({ ...p, [id]: { id, name, arrivalDate, verifications: [] } }));
    setPending((p) => [id, ...p]);
  };

  const verify: WorkersState["verify"] = (id, image) => {
    setWorkers((p) => {
      const w = p[id];
      if (!w) return p;
      const v = { id: crypto.randomUUID(), verifiedAt: Date.now(), image };
      return { ...p, [id]: { ...w, verifications: [v, ...w.verifications] } };
    });
    setVerified((p) => [{ id: crypto.randomUUID(), workerId: id, verifiedAt: Date.now(), image }, ...p]);
    setPending((p) => p.filter((x) => x !== id));
  };

  const value: WorkersState = { workers, pendingIds, verified, addWorker, verify };
  return <WorkersContext.Provider value={value}>{children}</WorkersContext.Provider>;
}

export function useWorkers() {
  const ctx = useContext(WorkersContext);
  if (!ctx) throw new Error("useWorkers must be used within WorkersProvider");
  return ctx;
}
