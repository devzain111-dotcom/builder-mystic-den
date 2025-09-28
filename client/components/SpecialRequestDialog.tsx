import { useMemo, useState } from "react";
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkers } from "@/context/WorkersContext";
import { useCamera } from "@/hooks/useCamera";
import FaceOverlay from "@/components/FaceOverlay";
import { toast } from "sonner";

export default function SpecialRequestDialog() {
  const { workers, addSpecialRequest } = useWorkers();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"worker" | "admin" | "">("");
  const [nameText, setNameText] = useState("");
  // الطلب الخاص للعاملات غير المسجلات: نستخدم إدخال الاسم فقط ولا نحتفظ بأي مُعرّف
  const [amountWorker, setAmountWorker] = useState<string>("");

  const list = useMemo(() => Object.values(workers).sort((a,b)=>a.name.localeCompare(b.name,"ar")), [workers]);
  const suggestions = useMemo(() => {
    const q = nameText.trim().toLowerCase();
    if (!q) return list.slice(0, 8);
    return list.filter(w => w.name.toLowerCase().includes(q)).slice(0, 8);
  }, [nameText, list]);

  const cam = useCamera();
  const [repName, setRepName] = useState("");
  const [amountAdmin, setAmountAdmin] = useState<string>("");
  const [captured, setCaptured] = useState<string | null>(null);

  const reset = () => { setMode(""); setNameText(""); setAmountWorker(""); setRepName(""); setAmountAdmin(""); setCaptured(null); };

  async function saveWorker() {
    const amount = Number(amountWorker);
    if (!amount || amount <= 0) return;
    const typed = nameText.trim();
    if (!typed) return;
    const exists = list.some((x) => x.name === typed);
    if (exists) {
      toast.error("هذه العاملة مسجلة بالفعل. الطلب الخاص مخصص لغير المسجلات.");
      return;
    }
    addSpecialRequest({ type: "worker", workerName: typed, amount, unregistered: true });
    toast.success("تم إنشاء الطلب الخاص للعاملة غير المسجلة");
    setOpen(false); reset();
  }

  async function captureAndSaveAdmin() {
    const amount = Number(amountAdmin); if (!repName.trim() || !amount || amount <= 0) return;
    try { if (!cam.isActive) await cam.start(); const data = await cam.capture(); setCaptured(data); addSpecialRequest({ type: "admin", adminRepName: repName.trim(), amount, imageDataUrl: data }); cam.stop(); setOpen(false); reset(); } catch {}
  }

  return (
    <Dialog open={open} onOpenChange={(v)=>{setOpen(v); if (!v) {cam.stop(); reset();}}}>
      <DialogTrigger asChild>
        <Button variant="outline">طلب مبلغ خاص</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>طلب مبلغ خاص</DialogTitle>
          <DialogDescription>اختر نوع الطلب ثم أدخل التفاصيل المطلوبة.</DialogDescription>
        </DialogHeader>

        {!mode && (
          <div className="grid grid-cols-2 gap-3">
            <Button className="h-20" onClick={()=>setMode("worker")}>لعاملة</Button>
            <Button className="h-20" variant="secondary" onClick={()=>setMode("admin")}>لإدارة الفرع</Button>
          </div>
        )}

        {mode === "worker" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>اسم العاملة</Label>
              <Input value={nameText} onChange={(e)=>{setNameText(e.target.value);}} placeholder="ابدأ الكتابة للبحث" />
              <p className="text-xs text-amber-700">الطلب هنا مخصص للعاملات غير المسجلات فقط. اكتب الاسم يدوياً إذا لم تكن موجودة في النظام. لا تُعرض أي قائمة أسماء هنا.</p>
            </div>
            <div className="space-y-2">
              <Label>المبلغ (₱)</Label>
              <Input type="number" inputMode="numeric" value={amountWorker} onChange={(e)=>setAmountWorker(e.target.value)} placeholder="مثال: 500" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={()=>{setMode("")}}>رجوع</Button>
              <Button onClick={saveWorker}>حفظ</Button>
            </div>
          </div>
        )}

        {mode === "admin" && (
          <div className="space-y-4">
            <div className="aspect-video relative overflow-hidden rounded-md border bg-black/60">
              <video ref={cam.videoRef} className="h-full w-full object-cover" playsInline muted />
              <FaceOverlay videoRef={cam.videoRef} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {!cam.isActive ? (
                <Button onClick={cam.start}>بدء الكاميرا</Button>
              ) : (
                <Button variant="secondary" onClick={cam.stop}>إيقاف</Button>
              )}
              <Button onClick={captureAndSaveAdmin}>التقاط الصورة وحفظ</Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>اسم ممثل الإدارة</Label>
                <Input value={repName} onChange={(e)=>setRepName(e.target.value)} placeholder="مثال: أبو أحمد" />
              </div>
              <div className="space-y-2">
                <Label>المبلغ (₱)</Label>
                <Input type="number" inputMode="numeric" value={amountAdmin} onChange={(e)=>setAmountAdmin(e.target.value)} placeholder="مثال: 750" />
              </div>
            </div>
            {captured && (
              <div className="rounded-md border p-2"><img src={captured} alt="لقطة الإدار��" className="max-h-48 mx-auto" /></div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={()=>{setMode("")}}>رجوع</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
