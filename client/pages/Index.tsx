import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCamera } from "@/hooks/useCamera";
import { CheckCircle2, Camera, CircleUserRound, Image as ImageIcon, Upload, UsersRound, Download } from "lucide-react";
import AddWorkerDialog, { AddWorkerPayload } from "@/components/AddWorkerDialog";
import * as XLSX from "xlsx";
import { useWorkers } from "@/context/WorkersContext";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import SpecialRequestDialog from "@/components/SpecialRequestDialog";
import FaceOverlay from "@/components/FaceOverlay";
import PersonSelect from "@/components/PersonSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Index() {
  const { branches, workers, sessionPendingIds, sessionVerifications, selectedBranchId, setSelectedBranchId, addWorker, addWorkersBulk, addVerification, savePayment } = useWorkers();
  const pendingAll = sessionPendingIds.map((id) => workers[id]).filter(Boolean);
  const pending = pendingAll.filter((w) => !selectedBranchId || w.branchId === selectedBranchId);
  const verified = sessionVerifications;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { videoRef, isActive, isSupported, error, start, stop, capture } = useCamera();

  useEffect(() => { if (!selectedId) { stop(); } }, [selectedId, stop]);

  const selectedPerson = useMemo(() => pending.find((p) => p.id === selectedId) || null, [pending, selectedId]);

  async function handleSelect(id: string) { setSelectedId(id); await start(); }

  async function handleCapture() { if (!selectedPerson) return; await capture(); const now = Date.now(); addVerification(selectedPerson.id, now); setSelectedId(null); stop(); }

  function handleAddWorker(payload: AddWorkerPayload) { addWorker(payload.name, payload.arrivalDate, payload.branchId); }

  function handleDownloadDaily() {
    const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime(); const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
    const rows = verified.filter((v) => v.verifiedAt >= start && v.verifiedAt <= end).map((v) => { const w = workers[v.workerId]; const branchName = w ? branches[w.branchId]?.name || "" : ""; return { الاسم: w?.name || "", التاريخ: new Date(v.verifiedAt).toLocaleString("ar-EG"), الفرع: branchName, "المبلغ (₱)": v.payment?.amount ?? "" }; });
    if (rows.length === 0) { toast.info("لا توجد بيانات تحقق اليوم"); return; }
    const ws = XLSX.utils.json_to_sheet(rows, { header: ["الاسم", "التاريخ", "الفرع", "المبلغ (₱)"] }); ws["!cols"] = [12, 22, 12, 12].map((w) => ({ wch: w })); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "تقرير اليوم"); const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, "0"); const d = String(now.getDate()).padStart(2, "0"); XLSX.writeFile(wb, `daily-report-${y}-${m}-${d}.xlsx`);
  }

  async function handleExcel(file: File) {
    const data = await file.arrayBuffer(); const wb = XLSX.read(data, { type: "array" }); const firstSheet = wb.Sheets[wb.SheetNames[0]]; const rows: any[] = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
    const parsed = rows.map((r) => { const name = r.name || r["الاسم"] || r["اسم"] || r["اسم العاملة"] || r["worker"] || ""; let arrival = r.arrival || r["تاريخ الوصول"] || r["الوصول"] || r["date"] || r["arrivalDate"] || ""; let ts: number | null = null; if (typeof arrival === "number") { const d = XLSX.SSF.parse_date_code(arrival); if (d) { const date = new Date(Date.UTC(d.y, (d.m || 1) - 1, d.d || 1) + 12 * 60 * 60 * 1000); ts = date.getTime(); } } else if (typeof arrival === "string" && arrival.trim()) { const parsedDate = new Date(arrival); if (!isNaN(parsedDate.getTime())) { const midLocal = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate(), 12, 0, 0, 0); ts = midLocal.getTime(); } } if (!name) return null; const branch = r.branch || r["الفرع"] || r["branchName"] || (selectedBranchId ? Object.values(branches).find(b=>b.id===selectedBranchId)?.name : ""); return { name: String(name).trim(), arrivalDate: ts ?? Date.now(), branchName: branch || undefined } as { name: string; arrivalDate: number; branchName?: string }; }).filter(Boolean) as { name: string; arrivalDate: number; branchName?: string }[];
    if (parsed.length) addWorkersBulk(parsed);
  }

  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({});
  function handleSaveAmount(verificationId: string) { const raw = amountDraft[verificationId]; const amount = Number(raw); if (!isFinite(amount) || amount <= 0) return; savePayment(verificationId, amount); setAmountDraft((p) => ({ ...p, [verificationId]: "" })); toast.success("تم التحقق والدفع"); const nextId = sessionPendingIds.find((id) => id !== selectedId); if (nextId) { setSelectedId(nextId); start(); } else { setSelectedId(null); stop(); } }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-secondary to-white">
      <section className="container py-8">
        <div className="mb-6 flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold text-foreground">نظام تحقق المقيمين في السكن</h1>
          <p className="text-muted-foreground">اختر اسم العامل من القائمة ثم التقط صورة عبر كاميرا الجهاز لإثبات الحضور. سيتم نقل الاسم إلى قائمة "تم التحقق" باللون الأخضر مع علامة موثوق.</p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <AddWorkerDialog onAdd={handleAddWorker} defaultBranchId={selectedBranchId ?? undefined} />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">الفرع:</span>
            <Select value={selectedBranchId ?? undefined} onValueChange={(v) => setSelectedBranchId(v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
              <SelectContent>{Object.values(branches).map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}</SelectContent>
            </Select>
          </div>
          <input id="excel-input" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleExcel(f); e.currentTarget.value = ""; }} />
          <Button variant="outline" className="gap-2" asChild><label htmlFor="excel-input" className="cursor-pointer flex items-center gap-2"><Upload className="h-4 w-4" />رفع ملف إكسل</label></Button>
          <Button variant="secondary" className="gap-2" asChild><Link to="/workers"><UsersRound className="h-4 w-4" />العاملات</Link></Button>
          <Button variant="admin" asChild><Link to="/admin-login">الإدارة</Link></Button>
          <SpecialRequestDialog />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="p-4 flex items-center justify-between border-b">
              <div className="font-bold">الكاميرا المباشرة</div>
              <div className="text-sm text-muted-foreground flex items-center gap-2"><Camera className="h-4 w-4" />{isActive ? "قيد التشغيل" : "متوقفة"}</div>
            </div>
            <div className="p-4">
              {selectedPerson ? (
                <div className="space-y-4">
                  <div className="relative aspect-video overflow-hidden rounded-lg border bg-black">
                    <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
                    <FaceOverlay videoRef={videoRef} />
                    <div className="absolute top-3 end-3 z-10 flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-primary"><CircleUserRound className="h-4 w-4" /><span className="text-sm font-semibold">{selectedPerson.name}</span></div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button onClick={handleCapture} className="gap-2"><ImageIcon className="h-4 w-4" />التقاط الصورة وتأكيد الحضور</Button>
                    <Button variant="ghost" onClick={() => setSelectedId(null)}>إلغاء الاختيار</Button>
                  </div>
                  {!isSupported && (<p className="text-destructive">الكاميرا غير مدعومة على هذا المتصفح.</p>)}
                  {error && <p className="text-destructive">{error}</p>}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                  <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><Camera className="h-6 w-6" /></div>
                  <div className="max-w-prose"><p className="font-semibold">اختر اسماً من القائمة اليمنى لبدء الكاميرا</p><p className="text-muted-foreground text-sm">بعد اختيار الاسم سيتم تشغيل الكاميرا مباشرة لتصوير العامل والتحقق منه.</p></div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-rows-2 gap-6">
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between"><div className="font-bold">قائمة للتحقق</div><div className="text-sm text-muted-foreground">{pending.length} أشخاص</div></div>
              <div className="p-4 space-y-3">
                {pending.length === 0 ? (<div className="p-6 text-center text-muted-foreground">لا يوجد أسماء للتحقق حالياً</div>) : (<><PersonSelect options={pending} onSelect={handleSelect} /><p className="text-xs text-muted-foreground">ابدأ الكتابة للبحث عن الاسم ثم اختره لبدء الكاميرا.</p></>)}
              </div>
            </div>

            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="font-bold text-emerald-700">تم التحقق</div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleDownloadDaily} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"><Download className="h-4 w-4" /> تحميل التقرير اليومي</button>
                  <div className="text-sm text-muted-foreground">{verified.length} موثَّق</div>
                </div>
              </div>
              <ul className="max-h-[340px] overflow-auto divide-y">
                {verified.length === 0 && (<li className="p-6 text-center text-muted-foreground">لا يوجد عمليات تحقق بعد</li>)}
                {verified.map((v) => (
                  <li key={v.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex items-center justify-center rounded-full bg-green-600/10 text-green-700 p-1"><CheckCircle2 className="h-4 w-4" /></span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between"><span className="font-semibold text-green-700">{workers[v.workerId]?.name}</span><time className="text-xs text-muted-foreground">{new Date(v.verifiedAt).toLocaleString("ar")}</time></div>
                        <div className="mt-2 flex items-center gap-4">
                          {v.payment ? (<div className="flex items-center gap-2"><span className="inline-flex items-center rounded-full bg-emerald-600/10 text-emerald-700 px-3 py-1 text-xs font-medium">تم التحقق</span></div>) : (<div className="flex items-center gap-2"><Input type="number" placeholder="المبلغ بالبيسو" value={(amountDraft[v.id] ?? "")} onChange={(e) => setAmountDraft((p) => ({ ...p, [v.id]: e.target.value }))} className="w-40" /><span className="text-sm text-muted-foreground">₱ بيسو فلبيني</span><Button onClick={() => handleSaveAmount(v.id)}>حفظ</Button></div>)}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
