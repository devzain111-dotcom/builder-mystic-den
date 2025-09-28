import { useParams, Link } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

export default function WorkerDetails() {
  const { id } = useParams();
  const { workers, setWorkerExitDate, requestUnlock } = useWorkers();
  const worker = id ? workers[id] : undefined;

  if (!worker) {
    return (
      <main className="container py-12">
        <p className="text-muted-foreground">لا توجد بيانات للعاملة المطلوبة.</p>
        <Link to="/workers" className="text-primary hover:underline">��لعودة إلى قائمة العاملات</Link>
      </main>
    );
  }

  const total = worker.verifications.reduce((sum, v) => sum + (v.payment?.amount ?? 0), 0);
  const complete = !!(worker.docs?.or && worker.docs?.passport);
  const locked = !!worker.exitDate && worker.status !== "active";
  const [exitText, setExitText] = useState("");
  function parseDateText(t: string): number | null { const s = t.trim(); if (!s) return null; const m = s.match(/(\d{1,4})\D(\d{1,2})\D(\d{2,4})/); if (m) { const a=Number(m[1]), b=Number(m[2]), c=Number(m[3]); const y=a>31?a:c; const d=a>31?c:a; const mo=b; const Y=y<100?y+2000:y; const ts=new Date(Y,mo-1,d,12,0,0,0).getTime(); if(!isNaN(ts)) return ts; } const d2=new Date(s); if(!isNaN(d2.getTime())) return new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 12,0,0,0).getTime(); return null; }

  return (
    <main className="container py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">بيانات العاملة: {worker.name}</h1>
          <p className="text-sm text-muted-foreground">تاريخ الوصول: {new Date(worker.arrivalDate).toLocaleDateString("ar-EG")}</p>
          <p className="mt-1 text-sm">الملف: <span className={`${complete ? "text-emerald-700" : "text-amber-700"} font-semibold`}>{complete ? "مكتمل" : "غير مكتمل"}</span></p>
        </div>
        <Link to="/workers" className="text-primary hover:underline">العودة</Link>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">الحالة وتاريخ الخروج</div>
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>الحالة: {locked ? (<span className="inline-flex items-center gap-1 rounded-full bg-rose-600/10 px-3 py-1 text-rose-700 text-sm font-semibold"><Lock className="h-3 w-3"/> مقفولة</span>) : (<span className="inline-flex items-center rounded-full bg-emerald-600/10 px-3 py-1 text-emerald-700 text-sm font-semibold">نشطة</span>)}</div>
            {locked ? (
              worker.status === "unlock_requested" ? (
                <span className="text-xs text-muted-foreground">تم إرسال طلب فتح الملف — بانتظار الإدارة</span>
              ) : (
                <Button variant="outline" size="sm" onClick={()=>requestUnlock(worker.id)}>اطلب من الإدارة فتح ملف العاملة</Button>
              )
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">تاريخ الخروج:</span>
            <Input value={exitText} onChange={(e)=>setExitText(e.target.value)} dir="ltr" placeholder="yyyy-mm-dd أو dd/mm/yyyy" className="w-60" />
            <Button size="sm" onClick={()=>{ const ts=parseDateText(exitText); if (ts!=null) setWorkerExitDate(worker.id, ts); }}>حفظ</Button>
            <Button size="sm" variant="ghost" onClick={()=>setWorkerExitDate(worker.id, null)}>إزالة تاريخ الخروج</Button>
            {worker.exitDate ? (<span className="text-xs text-muted-foreground">الحالي: {new Date(worker.exitDate).toLocaleDateString("ar-EG")}</span>) : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">الوثائق</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
          <div>
            <div className="mb-2 text-sm font-semibold">OR</div>
            {worker.docs?.or ? (<img src={worker.docs.or} alt="OR" className="max-h-64 rounded-md border" />) : (<div className="rounded-md border p-6 text-center text-muted-foreground">لا يوجد</div>)}
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold">Passport</div>
            {worker.docs?.passport ? (<img src={worker.docs.passport} alt="Passport" className="max-h-64 rounded-md border" />) : (<div className="rounded-md border p-6 text-center text-muted-foreground">لا يوجد</div>)}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-semibold">سجل عمليات التحقق والمبالغ</div>
        <ul className="divide-y">
          {worker.verifications.length === 0 && (<li className="p-6 text-center text-muted-foreground">لا توجد عمليات تحقق بعد</li>)}
          {worker.verifications.map((v) => (
            <li key={v.id} className="p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">تاريخ التحقق: {new Date(v.verifiedAt).toLocaleString("ar")}</div>
                    <div className="text-sm text-muted-foreground">{v.payment ? (<span>تم التحقق — ₱ {v.payment.amount} — محفوظ بتاريخ {new Date(v.payment.savedAt).toLocaleString("ar")}</span>) : (<span>لا يوجد مبلغ محفوظ</span>)}</div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t p-4 text-right font-semibold">الإجمالي: ₱ {total}</div>
      </div>
    </main>
  );
}
