import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkers } from "@/context/WorkersContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

const arabicDigits = "٠١٢٣٤٥٦٧٨٩"; const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const normalizeDigits = (s: string) => s.replace(/[\u0660-\u0669]/g, (d) => String(arabicDigits.indexOf(d))).replace(/[\u06F0-\u06F9]/g, (d) => String(persianDigits.indexOf(d)));
const parseDateText = (t: string): number | null => { const s = normalizeDigits(t).trim(); if (!s) return null; const m = s.match(/(\d{1,4})\D(\d{1,2})\D(\d{2,4})/); if (m) { const a = Number(m[1]); const b = Number(m[2]); const c = Number(m[3]); const y = a > 31 ? a : c; const d = a > 31 ? c : a; const mo = b; const Y = y < 100 ? y + 2000 : y; const ts = new Date(Y, mo - 1, d, 0, 0, 0, 0).getTime(); if (!isNaN(ts)) return ts; } const d2 = new Date(s); if (!isNaN(d2.getTime())) return new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 0, 0, 0, 0).getTime(); return null; };

function BranchDialog() {
  const { branches, setSelectedBranchId, createBranch } = useWorkers() as any;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  async function save() {
    const n = name.trim(); if (!n || !password) return;
    let b = null;
    if (createBranch) b = await createBranch(n, password);
    if (!b) {
      try {
        const r = await fetch("/api/branches/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n, password }) });
        const j = await r.json(); if (r.ok && j?.ok) b = j.branch;
      } catch {}
    }
    if (b?.id) { setSelectedBranchId(b.id); setOpen(false); setName(""); setPassword(""); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">الفروع</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>إضافة فرع جديد</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="text-sm mb-1">الاسم</div>
            <Input value={name} onChange={(e)=>setName(e.target.value)} placeholder="مثال: الفرع 2" />
          </div>
          <div>
            <div className="text-sm mb-1">كلمة المرور</div>
            <Input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="•••���••" />
          </div>
          <div className="text-xs text-muted-foreground">سيُضاف الفرع في قاعدة البيانات وسيظهر في قائمة الفروع.</div>
          <div className="text-sm">الفروع الحالية: {Object.values(branches).map((b:any)=>b.name).join("، ") || "—"}</div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={()=>setOpen(false)}>إلغاء</Button>
          <Button onClick={save}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminReport() {
  const navigate = useNavigate();
  const { branches, workers, specialRequests, decideUnlock, selectedBranchId, setSelectedBranchId } = useWorkers() as any;
  const [branchId, setBranchId] = useState<string | undefined>(selectedBranchId ?? Object.keys(branches)[0]);
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

  useEffect(() => {
    setBranchId(selectedBranchId ?? Object.keys(branches)[0]);
  }, [selectedBranchId, branches]);

  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const [zoom, setZoom] = useState(1);

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
          <BranchDialog />
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
              {r.imageDataUrl && (
                <div className="mt-3 space-y-2">
                  <img
                    src={r.imageDataUrl}
                    alt="صورة الطلب"
                    className="max-h-40 rounded-md border cursor-zoom-in"
                    onClick={()=> setPreview({ src: r.imageDataUrl!, name: "request-image.png" })}
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={()=> setPreview({ src: r.imageDataUrl!, name: "request-image.png" })}>تكبير</Button>
                    <Button size="sm" variant="secondary" asChild>
                      <a href={r.imageDataUrl} download={"request-image.png"}>تنزيل</a>
                    </Button>
                  </div>
                </div>
              )}
              {r.attachmentDataUrl && (
                <div className="mt-3 space-y-2">
                  {r.attachmentMime?.includes("pdf") || (r.attachmentName||"").toLowerCase().endsWith(".pdf") ? (
                    <a href={r.attachmentDataUrl} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border px-3 py-1 text-sm text-primary hover:bg-secondary/40">عرض الملف (PDF): {r.attachmentName || "مرفق"}</a>
                  ) : (
                    <>
                      <img
                        src={r.attachmentDataUrl}
                        alt={r.attachmentName || "مرفق"}
                        className="max-h-40 rounded-md border cursor-zoom-in"
                        onClick={()=> setPreview({ src: r.attachmentDataUrl!, name: r.attachmentName || "attachment" })}
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={()=> setPreview({ src: r.attachmentDataUrl!, name: r.attachmentName || "attachment" })}>تكبير</Button>
                        <Button size="sm" variant="secondary" asChild>
                          <a href={r.attachmentDataUrl} download={r.attachmentName || "attachment"}>تنزيل</a>
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      {/* Image Preview Dialog */}
      <Dialog open={!!preview} onOpenChange={(o)=>{ if (!o) { setPreview(null); setZoom(1);} }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>معاينة الصورة</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={()=> setZoom((z)=> Math.max(0.5, Number((z - 0.25).toFixed(2))))}>−</Button>
                <div className="min-w-16 text-center text-sm">{Math.round(zoom*100)}%</div>
                <Button size="sm" variant="outline" onClick={()=> setZoom((z)=> Math.min(3, Number((z + 0.25).toFixed(2))))}>+</Button>
                <Button size="sm" variant="ghost" onClick={()=> setZoom(1)}>إعادة الضبط</Button>
                <div className="ms-auto">
                  <Button size="sm" variant="secondary" asChild>
                    <a href={preview.src} download={preview.name}>تنزيل</a>
                  </Button>
                </div>
              </div>
              <div className="max-h-[75vh] overflow-auto rounded-md border bg-muted/20 p-2">
                <div className="flex items-center justify-center">
                  <img src={preview.src} alt={preview.name} style={{ transform: `scale(${zoom})`, transformOrigin: "center" }} className="max-h-[70vh] object-contain" />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
