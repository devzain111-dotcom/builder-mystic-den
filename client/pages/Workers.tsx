import { Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function Workers() {
  const { branches, workers, selectedBranchId, setSelectedBranchId } = useWorkers();
  const [qDraft, setQDraft] = useState("");
  const [query, setQuery] = useState("");
  const listAll = Object.values(workers).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const list = listAll.filter((w) => (w.plan !== "no_expense") && (!selectedBranchId || w.branchId === selectedBranchId) && (!query || w.name.toLowerCase().includes(query.toLowerCase())));
  const totalLastPayments = list.reduce((sum, w) => sum + (w.verifications.find((v)=>v.payment)?.payment?.amount ?? 0), 0);

  return (
    <main className="container py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">العاملات المسجلات</h1>
          <p className="text-muted-foreground text-sm">اضغط على اسم العاملة لعرض جميع عمليات التحقق والمبالغ.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">الفرع:</span>
          <Select value={selectedBranchId ?? undefined} onValueChange={(v) => setSelectedBranchId(v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
            <SelectContent>
              {Object.values(branches).map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
            </SelectContent>
          </Select>
          <input className="ms-4 w-48 rounded-md border bg-background px-3 py-2 text-sm" placeholder="ابحث بالاسم" value={qDraft} onChange={(e)=>setQDraft(e.target.value)} />
          <button className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90" onClick={()=>setQuery(qDraft)} type="button">بحث</button>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-secondary/50"><tr className="text-sm"><th className="p-3">الاسم</th><th className="p-3">تاريخ الوصول</th><th className="p-3">تاريخ الخروج</th><th className="p-3">عدد عمليات التحقق</th><th className="p-3">الملف</th><th className="p-3">آخر مبلغ</th><th className="p-3">عرض</th></tr></thead>
          <tbody className="divide-y">
            {list.map((w) => {
              const lastPayment = w.verifications.find((v) => v.payment)?.payment?.amount;
              const complete = !!(w.docs?.or && w.docs?.passport);
              return (
                <tr key={w.id} className="hover:bg-secondary/40">
                  <td className="p-3 font-medium">
                    <div className="flex flex-col">
                      <span>{w.name}</span>
                      {(() => { const locked = !!w.exitDate && w.status !== "active"; if (!locked) return null; const pending = w.status === "unlock_requested"; return (
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <span className="inline-flex items-center rounded-full bg-rose-600/10 px-2 py-0.5 font-semibold text-rose-700">مقفولة</span>
                          {pending ? <span className="text-muted-foreground">قيد انتظار الإدارة</span> : null}
                        </div>
                      ); })()}
                    </div>
                  </td>
                  <td className="p-3 text-sm text-muted-foreground">{new Date(w.arrivalDate).toLocaleDateString("ar-EG")}</td>
                  <td className="p-3 text-sm text-muted-foreground">{w.exitDate ? new Date(w.exitDate).toLocaleDateString("ar-EG") : "—"}</td>
                  <td className="p-3 text-sm">{w.verifications.length}</td>
                  <td className="p-3 text-sm">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${complete ? "bg-emerald-600/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>
                      {complete ? "مكتمل" : "غير مكتمل"}
                    </span>
                  </td>
                  <td className="p-3 text-sm">{lastPayment != null ? `₱ ${lastPayment}` : "—"}</td>
                  <td className="p-3 text-sm"><Link to={`/workers/${w.id}`} className="text-primary hover:underline">تفاصيل</Link></td>
                </tr>
              );
            })}
            {list.length === 0 && (<tr><td colSpan={6} className="p-6 text-center text-muted-foreground">لا توجد عاملات في هذا الفرع.</td></tr>)}
          </tbody>
          <tfoot><tr className="bg-muted/40 font-semibold"><td className="p-3" colSpan={5}>إجمالي آخر المبالغ</td><td className="p-3">₱ {totalLastPayments}</td><td /></tr></tfoot>
        </table>
      </div>
    </main>
  );
}
