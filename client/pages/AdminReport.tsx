import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const arabicDigits = "٠١٢٣٤٥٦٧٨٩"; const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const normalizeDigits = (s: string) => s.replace(/[\u0660-\u0669]/g, (d) => String(arabicDigits.indexOf(d))).replace(/[\u06F0-\u06F9]/g, (d) => String(persianDigits.indexOf(d)));
const parseDateText = (t: string): number | null => { const s = normalizeDigits(t).trim(); if (!s) return null; const m = s.match(/(\d{1,4})\D(\d{1,2})\D(\d{2,4})/); if (m) { const a = Number(m[1]); const b = Number(m[2]); const c = Number(m[3]); const y = a > 31 ? a : c; const d = a > 31 ? c : a; const mo = b; const Y = y < 100 ? y + 2000 : y; const ts = new Date(Y, mo - 1, d, 0, 0, 0, 0).getTime(); if (!isNaN(ts)) return ts; } const d2 = new Date(s); if (!isNaN(d2.getTime())) return new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 0, 0, 0, 0).getTime(); return null; };

export default function AdminReport() {
  const navigate = useNavigate();
  const { branches, workers, specialRequests, decideUnlock } = useWorkers();
  const [branchId, setBranchId] = useState<string | undefined>(Object.keys(branches)[0]);
  const [fromText, setFromText] = useState(""); const [toText, setToText] = useState(""); const [qDraft, setQDraft] = useState(""); const [query, setQuery] = useState("");
  useEffect(() => { if (localStorage.getItem("adminAuth") !== "1") navigate("/admin-login", { replace: true }); }, [navigate]);
  const fromTs = useMemo(() => parseDateText(fromText), [fromText]);
  const toTs = useMemo(() => { const t = parseDateText(toText); return t != null ? t + 24 * 60 * 60 * 1000 - 1 : null; }, [toText]);

  const branchWorkers = useMemo(() => {
    const list = Object.values(workers).filter((w) => (!branchId || w.branchId === branchId) && w.verifications.length > 0);
    const rows = list.flatMap((w) => w.verifications.map((v) => ({ workerId: w.id, name: w.name, arrivalDate: w.arrivalDate, verifiedAt: v.verifiedAt, payment: v.payment?.amount ?? null })));
    const filtered = rows.filter((r) => { if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false; if (fromTs != null && r.verifiedAt < fromTs) return false; if (toTs != null && r.verifiedAt > toTs) return false; return true; });
    filtered.sort((a,b)=> b.verifiedAt - a.verifiedAt); return filtered;
  }, [workers, branchId, query, fromTs, toTs]);

  const totalAmount = useMemo(() => branchWorkers.reduce((s, r) => s + (r.payment ?? 0), 0), [branchWorkers]);

  return (
    <main className="container py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">تقرير الإدارة</h1>
          <p className="text-muted-foreground text-sm">اختر الفرع وفلتر الفترة، ثم ابحث بالاسم.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">الفرع:</span>
          <Select value={branchId} onValueChange={(v) => setBranchId(v)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
            <SelectContent>
              {Object.values(branches).map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
            </SelectContent>
          </Select>
          <Input placeholder="من (yyyy-mm-dd)" dir="ltr" className="w-40" value={fromText} onChange={(e)=>setFromText(e.target.value)} />
          <Input placeholder="إلى (yyyy-mm-dd)" dir="ltr" className="w-40" value={toText} onChange={(e)=>setToText(e.target.value)} />
          <Input placeholder="ابحث بالاسم" className="w-40" value={qDraft} onChange={(e)=>setQDraft(e.target.value)} />
          <Button onClick={()=>setQuery(qDraft)}>بحث</Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-secondary/50"><tr className="text-sm"><th className="p-3">الاسم</th><th className="p-3">تاريخ الوصول</th><th className="p-3">وقت التحقق</th><th className="p-3">المبلغ</th></tr></thead>
          <tbody className="divide-y">
            {branchWorkers.map((r) => (
              <tr key={`${r.workerId}-${r.verifiedAt}`} className="hover:bg-secondary/40">
                <td className="p-3 font-medium"><Link className="text-primary hover:underline" to={`/workers/${r.workerId}`}>{r.name}</Link></td>
                <td className="p-3 text-sm text-muted-foreground">{new Date(r.arrivalDate).toLocaleDateString("ar-EG")}</td>
                <td className="p-3 text-sm">{new Date(r.verifiedAt).toLocaleString("ar-EG")}</td>
                <td className="p-3 text-sm">{r.payment != null ? `₱ ${r.payment}` : "—"}</td>
              </tr>
            ))}
            {branchWorkers.length === 0 && (<tr><td colSpan={4} className="p-6 text-center text-muted-foreground">لا توجد بيانات تحقق لهذا الفرع.</td></tr>)}
          </tbody>
          <tfoot><tr className="bg-muted/40 font-semibold"><td className="p-3" colSpan={3}>الإجمالي</td><td className="p-3">₱ {totalAmount}</td></tr></tfoot>
        </table>
      </div>

      <div className="mt-6 rounded-xl border bg-card overflow-hidden">
        <div className="p-4 border-b font-semibold">طلبات فتح ملفات العاملات</div>
        <ul className="divide-y">
          {specialRequests.filter(r=>r.type==="unlock").length === 0 && (<li className="p-6 text-center text-muted-foreground">لا توجد طلبات فتح بعد.</li>)}
          {specialRequests.filter(r=>r.type==="unlock").map((r) => (
            <li key={r.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium">طلب فتح لاسم: <Link className="text-primary hover:underline" to={`/workers/${r.workerId}`}>{r.workerName}</Link></div>
                <div className="text-xs text-muted-foreground">التاريخ: {new Date(r.createdAt).toLocaleString("ar-EG")}</div>
                <div className="text-sm">
                  {!r.decision ? (
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={()=>decideUnlock(r.id, true)}>موافقة</Button>
                      <Button size="sm" variant="destructive" onClick={()=>decideUnlock(r.id, false)}>رفض</Button>
                    </div>
                  ) : (
                    <span className={r.decision === "approved" ? "text-emerald-700" : "text-rose-700"}>{r.decision === "approved" ? "تمت الموافقة" : "تم الرفض"}</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 rounded-xl border bg-card overflow-hidden">
        <div className="p-4 border-b font-semibold">طلبات خاصة</div>
        <ul className="divide-y">
          {specialRequests.filter(r=>r.type!=="unlock").length === 0 && (<li className="p-6 text-center text-muted-foreground">لا توجد طلبات خاصة بعد.</li>)}
          {specialRequests.filter(r=>r.type!=="unlock").map((r) => (
            <li key={r.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium">{r.type === "worker" ? (<>طلب لعاملة: <Link className="text-primary hover:underline" to={`/workers/${r.workerId}`}>{r.workerName}</Link></>) : (<>طلب لإدارة الفرع — ممثل: <span className="font-semibold">{r.adminRepName}</span></>)}</div>
                <div className="text-sm">المبلغ: ₱ {r.amount}</div>
                <div className="text-xs text-muted-foreground">التاريخ: {new Date(r.createdAt).toLocaleString("ar-EG")}</div>
              </div>
              {r.imageDataUrl && (<div className="mt-3"><img src={r.imageDataUrl} alt="صورة الطلب" className="max-h-40 rounded-md border" /></div>)}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
