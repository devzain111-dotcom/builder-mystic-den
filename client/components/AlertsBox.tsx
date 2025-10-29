import { AlarmClock, AlertTriangle } from "lucide-react";
import { useWorkers, SPECIAL_REQ_GRACE_MS } from "@/context/WorkersContext";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
/* removed residency type selection */
import { useCamera } from "@/hooks/useCamera";
import {
  detectSingleDescriptor,
  checkLivenessFlexible,
  captureSnapshot,
} from "@/lib/face";
import { toast } from "sonner";
import { useI18n } from "@/context/I18nContext";

function timeLeft(ms: number, locale: "ar" | "en") {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hAbbr = locale === "ar" ? "س" : "h";
  const mAbbr = locale === "ar" ? "د" : "m";
  return `${h}${hAbbr} ${m}${mAbbr}`;
}

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
function normalizeDigits(s: string) {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(arabicDigits.indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(persianDigits.indexOf(d)));
}
function parseManualDateToTs(input: string): number | null {
  const t = normalizeDigits(input).trim();
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d)
    return null;
  const ts = dt.getTime();
  return Number.isFinite(ts) ? ts : null;
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = document.createElement("img");
      img.onload = () => {
        const maxDim = 1200;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no-ctx"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AlertsBox() {
  const {
    specialRequests,
    workers,
    branches,
    addWorker,
    resolveWorkerRequest,
    selectedBranchId,
  } = useWorkers();
  const { tr, t, locale } = useI18n();
  const branchList = useMemo(() => Object.values(branches), [branches]);
  const now = Date.now();
  const perBranch = specialRequests.filter((r) => {
    if (r.type !== "worker") return false;
    const worker = r.workerId ? workers[r.workerId] : undefined;
    const b = worker?.branchId || r.branchId || null;
    return selectedBranchId ? b === selectedBranchId : true;
  });
  const unregistered = perBranch
    .filter((r) => !!r.unregistered || !r.workerId || !workers[r.workerId!])
    .map((r) => ({
      id: r.id,
      name:
        r.workerName ||
        (r.workerId ? workers[r.workerId]?.name : "") ||
        "اسم غير محدد",
      createdAt: r.createdAt,
      amount: r.amount,
      left: r.createdAt + SPECIAL_REQ_GRACE_MS - now,
    }))
    .sort((a, b) => a.left - b.left);

  const [openFor, setOpenFor] = useState<string | null>(null);
  const current = unregistered.find((x) => x.id === openFor) || null;
  const [name, setName] = useState("");
  const [dateText, setDateText] = useState("");
  const [branchId, setBranchId] = useState<string | undefined>(
    branchList[0]?.id,
  );
  // plan is determined later based on documents; default to no_expense at creation
  const parsedDate = useMemo(() => parseManualDateToTs(dateText), [dateText]);
  const dateValid = parsedDate != null;

  const cam = useCamera();
  const [captured, setCaptured] = useState<string | null>(null);
  const [embedding, setEmbedding] = useState<number[] | null>(null);
  const [orDataUrl, setOrDataUrl] = useState<string | undefined>(undefined);
  const [passportDataUrl, setPassportDataUrl] = useState<string | undefined>(
    undefined,
  );

  async function doCapture() {
    try {
      if (!cam.isActive) await cam.start();
      const live = await checkLivenessFlexible(cam.videoRef.current!, {
        tries: 10,
        intervalMs: 160,
        strict: false,
      });
      if (!live) toast.info("تخطّي فحص الحيوية بسبب ضعف الحركة/الإضاءة.");
      const det = await detectSingleDescriptor(cam.videoRef.current!);
      if (!det) {
        toast.error("لم يتم اكتشاف وجه واضح");
        return;
      }
      const snap = await captureSnapshot(cam.videoRef.current!);
      setCaptured(snap);
      setEmbedding(det.descriptor);
    } catch (e: any) {
      toast.error(e?.message || "تعذر الالتقاط");
    }
  }

  function resetDialog() {
    setName("");
    setDateText("");
    setBranchId(branchList[0]?.id);
    setCaptured(null);
    setEmbedding(null);
    setOrDataUrl(undefined);
    setPassportDataUrl(undefined);
    cam.stop();
  }

  async function save() {
    const nm = (name || current?.name || "").trim();
    if (!nm) {
      toast.error("الاسم مطلوب");
      return;
    }
    if (!dateValid || parsedDate == null) {
      toast.error("صيغة التاريخ يجب أن تكون dd/mm/yyyy");
      return;
    }
    if (!branchId) {
      toast.error("اختر الفرع");
      return;
    }
    if (!captured || !embedding) {
      toast.error("التقط صورة الوجه أولاً");
      return;
    }
    const hasDocs = !!orDataUrl || !!passportDataUrl;
    const w = addWorker(
      nm,
      parsedDate,
      branchId,
      { avatar: captured, or: orDataUrl, passport: passportDataUrl },
      (hasDocs ? "with_expense" : "no_expense") as any,
    );
    resolveWorkerRequest(openFor!, w.id);
    toast.success("تم الإدخال وحفظ البيانات");
    setOpenFor(null);
    resetDialog();
  }

  if (unregistered.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-amber-900">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-white">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-extrabold">
          {tr("متقدمات يجب إدخال بياناتهن", "Applicants needing data entry")}
        </h2>
      </div>
      <ul className="divide-y">
        {unregistered.map((r) => (
          <li key={r.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{r.name}</div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.left <= 0 ? "bg-red-600 text-white" : "bg-amber-200 text-amber-900"}`}
                >
                  {r.left <= 0 ? "محظورة" : `متبقّي ${timeLeft(r.left)}`}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <AlarmClock className="h-3 w-3" />
                  منذ {new Date(r.createdAt).toLocaleString("ar-EG")}
                </span>
                <span className="text-xs">المبلغ: ₱ {r.amount}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOpenFor(r.id);
                    setName(r.name || "");
                  }}
                >
                  إدخال
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={!!openFor}
        onOpenChange={(v) => {
          if (!v) {
            setOpenFor(null);
            resetDialog();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>متابعة إدخال بيانات العاملة</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>الاسم</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={current?.name || "اسم العاملة"}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>تاريخ الوصول (dd/mm/yyyy)</Label>
                <Input
                  value={dateText}
                  onChange={(e) => setDateText(e.target.value)}
                  placeholder="مثال: 05/09/2024"
                  inputMode="numeric"
                />
                {!dateValid && dateText.trim() !== "" ? (
                  <p className="text-xs text-rose-700">
                    الرجاء إدخال التاريخ بهذه الصيغة فقط: dd/mm/yyyy
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>الفرع</Label>
                <Select value={branchId} onValueChange={(v) => setBranchId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="اختر الفرع" />
                  </SelectTrigger>
                  <SelectContent>
                    {branchList.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>التقاط صورة الوجه (إلزامي)</Label>
              <div className="relative aspect-video w-full rounded-md overflow-hidden border bg-black/60">
                {captured ? (
                  <img
                    src={captured}
                    alt="صورة الوجه"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <video
                    ref={cam.videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                  />
                )}
                {cam.error ? (
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 text-red-200 text-xs p-2">
                    {cam.error}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {!cam.isActive ? (
                  <Button size="sm" onClick={cam.start}>
                    تشغيل الكاميرا
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" onClick={cam.stop}>
                      إيقاف
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cam.switchCamera}
                    >
                      تبديل الكاميرا
                    </Button>
                    <Button size="sm" onClick={doCapture}>
                      التقاط صورة
                    </Button>
                  </>
                )}
                {captured ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCaptured(null);
                      setEmbedding(null);
                    }}
                  >
                    إعادة الالتقاط
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ab-or">صورة OR (اختياري)</Label>
                <input
                  id="ab-or"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setOrDataUrl(await toDataUrl(f));
                    e.currentTarget.value = "";
                  }}
                />
                <Button variant="outline" asChild>
                  <label htmlFor="ab-or" className="cursor-pointer">
                    رفع صورة OR
                  </label>
                </Button>
                {orDataUrl ? (
                  <img src={orDataUrl} alt="OR" className="max-h-32 rounded-md border" />
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ab-pass">صورة الجواز (ا��تياري)</Label>
                <input
                  id="ab-pass"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setPassportDataUrl(await toDataUrl(f));
                    e.currentTarget.value = "";
                  }}
                />
                <Button variant="outline" asChild>
                  <label htmlFor="ab-pass" className="cursor-pointer">
                    رفع صورة الجواز
                  </label>
                </Button>
                {passportDataUrl ? (
                  <img src={passportDataUrl} alt="الجواز" className="max-h-32 rounded-md border" />
                ) : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpenFor(null);
                resetDialog();
              }}
            >
              إلغاء
            </Button>
            {captured ? <Button onClick={save}>حفظ</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
