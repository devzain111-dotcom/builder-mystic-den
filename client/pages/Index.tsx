import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCamera } from "@/hooks/useCamera";
import { useWorkers } from "@/context/WorkersContext";

export default function Index() {
  const { workers, pendingIds, verified, addWorker, verify } = useWorkers();
  const pending = useMemo(() => pendingIds.map((id) => workers[id]).filter(Boolean), [pendingIds, workers]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [search, setSearch] = useState("");

  const cam = useCamera();

  useEffect(() => {
    if (!selectedId) cam.stop();
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? pending.filter((w) => w.name.toLowerCase().includes(q)) : pending;
  }, [search, pending]);

  async function startFor(id: string) {
    setSelectedId(id);
    await cam.start();
  }

  async function captureAndVerify() {
    if (!selectedId) return;
    try {
      await cam.capture(); // we don't persist the photo in this MVP
      verify(selectedId);
      setSelectedId(null);
      cam.stop();
    } catch {}
  }

  function addNew() {
    const name = nameDraft.trim();
    if (!name) return;
    addWorker(name, Date.now());
    setNameDraft("");
  }

  const selected = selectedId ? workers[selectedId] : undefined;

  return (
    <main className="min-h-screen bg-gradient-to-br from-secondary to-white" dir="rtl">
      <section className="container py-6 space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold">نظا�� تحقق المقيمين في السكن</h1>
            <p className="text-sm text-muted-foreground">اختر اسماً ثم التقط صورة للتوثيق، سينتقل الاسم إلى قائمة تم التحقق باللون الأخضر.</p>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="اسم جديد" value={nameDraft} onChange={(e)=>setNameDraft(e.target.value)} className="w-48" />
            <Button onClick={addNew}>إضافة عاملة</Button>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* الكاميرا */}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-bold">الكاميرا المباشرة</div>
              <div className="text-sm text-muted-foreground">{cam.isActive ? "قيد التشغيل" : "متوقفة"}</div>
            </div>
            <div className="p-4 space-y-4">
              {selected ? (
                <>
                  <div className="relative aspect-video overflow-hidden rounded-lg border bg-black">
                    <video ref={cam.videoRef} className="h-full w-full object-cover" playsInline muted />
                    <div className="absolute top-3 end-3 z-10 rounded-full bg-primary/10 px-3 py-1 text-primary text-sm font-semibold">{selected.name}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button onClick={captureAndVerify}>التقاط الصورة وتأكيد الحضور</Button>
                    <Button variant="ghost" onClick={()=>{ setSelectedId(null); cam.stop(); }}>إلغاء</Button>
                  </div>
                  {!cam.isSupported && <p className="text-destructive">الكاميرا غير مدعومة على هذا الجهاز.</p>}
                  {cam.error && <p className="text-destructive">{cam.error}</p>}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                  <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3"/></svg>
                  </div>
                  <div className="max-w-prose text-sm text-muted-foreground">اختر اسماً من القائمة اليمنى لبدء الكاميرا</div>
                </div>
              )}
            </div>
          </div>

          {/* القوائم */}
          <div className="grid grid-rows-2 gap-6">
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="font-bold">قائمة للتحقق</div>
                <div className="text-sm text-muted-foreground">{pending.length} أشخاص</div>
              </div>
              <div className="p-4 space-y-3">
                {pending.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">لا يوجد أسماء للتحقق حالياً</div>
                ) : (
                  <>
                    <Input placeholder="ابحث بالاسم" value={search} onChange={(e)=>setSearch(e.target.value)} />
                    <ul className="max-h-64 overflow-auto divide-y rounded-md border">
                      {filtered.map((w) => (
                        <li key={w.id} className="flex items-center justify-between px-3 py-2 hover:bg-accent">
                          <span className="font-medium">{w.name}</span>
                          <Button size="sm" onClick={() => startFor(w.id)}>اختيار</Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="font-bold text-emerald-700">تم التحقق</div>
                <div className="text-sm text-muted-foreground">{verified.length} موثَّق</div>
              </div>
              <ul className="max-h-64 overflow-auto divide-y">
                {verified.length === 0 && (
                  <li className="p-6 text-center text-muted-foreground">لا يوجد عمليات تحقق بعد</li>
                )}
                {verified.map((v) => (
                  <li key={v.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-green-700">{workers[v.workerId]?.name}</span>
                      <time className="text-xs text-muted-foreground">{new Date(v.verifiedAt).toLocaleString("ar-EG")}</time>
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
