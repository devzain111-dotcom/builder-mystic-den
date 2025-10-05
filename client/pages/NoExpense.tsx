import { Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function NoExpense() {
  const { branches, workers, selectedBranchId, setSelectedBranchId } = useWorkers();
  const [qDraft, setQDraft] = useState("");
  const [query, setQuery] = useState("");
  const listAll = Object.values(workers).filter(w => w.plan === "no_expense").sort((a,b)=>a.name.localeCompare(b.name,"ar"));
  const list = listAll.filter((w) => (!selectedBranchId || w.branchId === selectedBranchId) && (!query || w.name.toLowerCase().includes(query.toLowerCase())));

  return (
    <main className="container py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">إقامة بدون مصروف</h1>
          <p className="text-muted-foreground text-sm">اضغط على اسم العاملة لعرض جميع التفاصيل.</p>
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
          <thead className="bg-secondary/50"><tr className="text-sm"><th className="p-3">الاسم</th><th className="p-3">تاريخ الوصول</th><th className="p-3">الفرع</th><th className="p-3">عرض</th></tr></thead>
          <tbody className="divide-y">
            {list.map((w) => (
              <tr key={w.id} className="hover:bg-secondary/40">
                <td className="p-3 font-medium">{w.name}</td>
                <td className="p-3 text-sm text-muted-foreground">{new Date(w.arrivalDate).toLocaleDateString("ar-EG")}</td>
                <td className="p-3 text-sm">{branches[w.branchId]?.name || ""}</td>
                <td className="p-3 text-sm"><Link to={`/workers/${w.id}`} className="text-primary hover:underline">تفاصيل</Link></td>
              </tr>
            ))}
            {list.length === 0 && (<tr><td colSpan={4} className="p-6 text-center text-muted-foreground">لا يوجد عناصر.</td></tr>)}
          </tbody>
        </table>
      </div>
    </main>
  );
}
