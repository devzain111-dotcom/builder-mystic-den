import { AlarmClock, AlertTriangle } from "lucide-react";
import { useWorkers, SPECIAL_REQ_GRACE_MS } from "@/context/WorkersContext";

function timeLeft(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}س ${m}د`;
}

export default function AlertsBox() {
  const { specialRequests, workers } = useWorkers();
  const now = Date.now();
  const unregistered = specialRequests.filter((r) => r.type === "worker" && (!!r.unregistered || !r.workerId || !workers[r.workerId!]))
    .map((r) => ({
      id: r.id,
      name: r.workerName || (r.workerId ? workers[r.workerId]?.name : "") || "اسم غير محدد",
      createdAt: r.createdAt,
      amount: r.amount,
      left: r.createdAt + SPECIAL_REQ_GRACE_MS - now,
    }))
    .sort((a, b) => a.left - b.left);

  if (unregistered.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-amber-900">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-white">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-extrabold">عاملات يجب إدخال بياناتهم</h2>
      </div>
      <ul className="divide-y">
        {unregistered.map((r) => (
          <li key={r.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{r.name}</div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.left <= 0 ? "bg-red-600 text-white" : "bg-amber-200 text-amber-900"}`}>
                  {r.left <= 0 ? "محظورة" : `متبقّي ${timeLeft(r.left)}`}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <AlarmClock className="h-3 w-3" />
                  منذ {new Date(r.createdAt).toLocaleString("ar-EG")}
                </span>
                <span className="text-xs">المبلغ: ₱ {r.amount}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
