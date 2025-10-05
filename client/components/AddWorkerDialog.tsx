import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/context/I18nContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useWorkers } from "@/context/WorkersContext";
import { useCamera } from "@/hooks/useCamera";
import {
  detectSingleDescriptor,
  checkLivenessFlexible,
  captureSnapshot,
} from "@/lib/face";
import { toast } from "sonner";

export interface AddWorkerPayload {
  name: string;
  arrivalDate: number;
  branchId: string;
  plan: "with_expense" | "no_expense";
  orDataUrl?: string;
  passportDataUrl?: string;
  avatarDataUrl?: string;
}

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
function normalizeDigits(s: string) {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(arabicDigits.indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(persianDigits.indexOf(d)));
}

// Strictly accepts only dd/mm/yyyy
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

export default function AddWorkerDialog({
  onAdd,
  defaultBranchId,
}: {
  onAdd: (payload: AddWorkerPayload) => void;
  defaultBranchId?: string;
}) {
  const { branches } = useWorkers();
  const branchList = useMemo(() => Object.values(branches), [branches]);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dateText, setDateText] = useState("");
  const [branchId, setBranchId] = useState<string | undefined>(
    defaultBranchId ?? branchList[0]?.id,
  );
  const [orDataUrl, setOrDataUrl] = useState<string | undefined>(undefined);
  const [passportDataUrl, setPassportDataUrl] = useState<string | undefined>(
    undefined,
  );
  const [plan, setPlan] = useState<"with_expense" | "no_expense" | "">("");

  // Face capture
  const cam = useCamera();
  const [capturedFace, setCapturedFace] = useState<string | null>(null);
  const [faceEmbedding, setFaceEmbedding] = useState<number[] | null>(null);
  const [busyEnroll, setBusyEnroll] = useState(false);

  const parsedDate = useMemo(() => parseManualDateToTs(dateText), [dateText]);
  const dateValid = parsedDate != null;
  const canSave =
    !!capturedFace &&
    !!faceEmbedding &&
    !!name.trim() &&
    dateValid &&
    !!branchId &&
    !!plan;

  function reset() {
    setName("");
    setDateText("");
    setBranchId(defaultBranchId ?? branchList[0]?.id);
    setOrDataUrl(undefined);
    setPassportDataUrl(undefined);
    setCapturedFace(null);
    setFaceEmbedding(null);
    setPlan("");
    cam.stop();
  }

  function toDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function doCaptureFace() {
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
        toast.error(
          useI18n().tr("لم يتم اكتشاف وجه واضح", "No clear face detected"),
        );
        return;
      }
      const snap = await captureSnapshot(cam.videoRef.current!);
      setCapturedFace(snap);
      setFaceEmbedding(det.descriptor);
      toast.success("تم التقاط صورة الوجه");
    } catch (e: any) {
      toast.error(
        e?.message ||
          useI18n().tr("تعذر التقاط الصورة", "Failed to capture photo"),
      );
    }
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(useI18n().tr("الاسم مطلوب", "Name is required"));
      return;
    }
    if (!dateValid || parsedDate == null) {
      toast.error(
        useI18n().tr(
          "صيغة التاريخ يجب أن تكون dd/mm/yyyy",
          "Date must be dd/mm/yyyy",
        ),
      );
      return;
    }
    if (!branchId) {
      toast.error(useI18n().tr("اختر الفرع", "Select a branch"));
      return;
    }
    if (!plan) {
      toast.error(useI18n().tr("اختر نوع الإقامة", "Select residency type"));
      return;
    }
    if (!capturedFace || !faceEmbedding) {
      toast.error(useI18n().tr("التقط صورة الوجه أولاً", "Capture face first"));
      return;
    }

    setBusyEnroll(true);
    try {
      // Ensure worker exists in backend and get id
      const up = await fetch("/api/workers/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-name": trimmed, "x-arrival": String(parsedDate) },
        body: JSON.stringify({ name: trimmed, arrivalDate: parsedDate }),
      });
      const uj = await up.json().catch(() => ({}) as any);
      if (!up.ok || !uj?.id) {
        toast.error(
          uj?.message ||
            useI18n().tr(
              "تعذر حفظ بيانات العاملة في القاعدة",
              "Failed to save worker in database",
            ),
        );
        return;
      }
      const workerId = uj.id as string;
      // Enroll face embedding with snapshot
      const enr = await fetch("/api/face/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId,
          embedding: faceEmbedding,
          snapshot: capturedFace,
        }),
      });
      const ej = await enr.json().catch(() => ({}) as any);
      if (!enr.ok || !ej?.ok) {
        toast.error(
          ej?.message ||
            useI18n().tr("تعذر حفظ صورة الوجه", "Failed to save face photo"),
        );
        return;
      }
      const payload: AddWorkerPayload = {
        name: trimmed,
        arrivalDate: parsedDate,
        branchId,
        plan: plan as "with_expense" | "no_expense",
        orDataUrl,
        passportDataUrl,
        avatarDataUrl: capturedFace || undefined,
      };
      onAdd(payload);
      toast.success("تم الحفظ");
      setOpen(false);
      reset();
    } finally {
      setBusyEnroll(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>{useI18n().tr("إضافة عاملة", "Add worker")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة عاملة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="aw-name">{useI18n().tr("الاسم", "Name")}</Label>
            <Input
              id="aw-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="اسم العاملة"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="aw-date">
                {useI18n().tr("تاريخ الوصول", "Arrival date")} (dd/mm/yyyy)
              </Label>
              <Input
                id="aw-date"
                inputMode="numeric"
                pattern="\\d{2}/\\d{2}/\\d{4}"
                placeholder="مثال: 05/09/2024"
                value={dateText}
                onChange={(e) => setDateText(e.target.value)}
              />
              {!dateValid && dateText.trim() !== "" ? (
                <p className="text-xs text-rose-700">
                  الرجاء إدخال التاريخ بهذه الصيغة فقط: dd/mm/yyyy
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>{useI18n().tr("الفرع", "Branch")}</Label>
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
            <Label>
              {useI18n().tr(
                "نوع الإقامة (إلزامي)",
                "Residency type (required)",
              )}
            </Label>
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm">
                <RadioGroup
                  value={plan}
                  onValueChange={(v) => setPlan(v as any)}
                  className="grid grid-cols-2 gap-4"
                >
                  <div className="inline-flex items-center gap-2 rounded-md border px-3 py-2">
                    <RadioGroupItem value="with_expense" id="plan1" />
                    <label htmlFor="plan1" className="cursor-pointer">
                      {useI18n().tr("إقامة + مصروف", "Residency + allowance")}
                    </label>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-md border px-3 py-2">
                    <RadioGroupItem value="no_expense" id="plan2" />
                    <label htmlFor="plan2" className="cursor-pointer">
                      {useI18n().tr(
                        "إقامة بدون مصروف",
                        "Residency without allowance",
                      )}
                    </label>
                  </div>
                </RadioGroup>
              </label>
            </div>
          </div>

          {/* Face capture box */}
          <div className="space-y-2">
            <Label>
              {useI18n().tr(
                "التقاط صورة الوجه (إلزامي)",
                "Capture face (required)",
              )}
            </Label>
            <div className="relative aspect-video w-full rounded-md overflow-hidden border bg-black/60">
              {capturedFace ? (
                <img
                  src={capturedFace}
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
                  <Button size="sm" onClick={doCaptureFace}>
                    التقاط صورة
                  </Button>
                </>
              )}
              {capturedFace ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCapturedFace(null);
                    setFaceEmbedding(null);
                  }}
                >
                  إعادة الالتقاط
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="aw-or">
                {useI18n().tr("صورة OR (اختياري)", "OR photo (optional)")}
              </Label>
              <input
                id="aw-or"
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
                <label htmlFor="aw-or" className="cursor-pointer">
                  {useI18n().tr("رفع صورة OR", "Upload OR photo")}
                </label>
              </Button>
              {orDataUrl ? (
                <img
                  src={orDataUrl}
                  alt="OR"
                  className="max-h-32 rounded-md border"
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="aw-pass">
                {useI18n().tr(
                  "صورة الجواز (اختياري)",
                  "Passport photo (optional)",
                )}
              </Label>
              <input
                id="aw-pass"
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
                <label htmlFor="aw-pass" className="cursor-pointer">
                  {useI18n().tr("رفع صورة الجواز", "Upload passport photo")}
                </label>
              </Button>
              {passportDataUrl ? (
                <img
                  src={passportDataUrl}
                  alt="الجواز"
                  className="max-h-32 rounded-md border"
                />
              ) : null}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            {useI18n().tr("إلغاء", "Cancel")}
          </Button>
          {capturedFace ? (
            <Button onClick={handleSubmit} disabled={!canSave || busyEnroll}>
              {busyEnroll
                ? useI18n().tr("جارٍ الحفظ…", "Saving…")
                : useI18n().tr("حفظ", "Save")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
