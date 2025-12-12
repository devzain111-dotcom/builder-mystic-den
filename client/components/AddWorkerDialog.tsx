import { useMemo, useState, useEffect } from "react";
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
  id?: string;
  name: string;
  arrivalDate: number;
  branchId: string;
  plan: "with_expense" | "no_expense";
  assignedArea?: string;
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

// Auto-format date input to dd/mm/yyyy
function formatDateInput(input: string): string {
  const normalized = normalizeDigits(input).replace(/\D/g, "");
  const digits = normalized.slice(0, 8);

  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + "/" + digits.slice(2);
  return digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
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
  open,
  onOpenChange,
  defaultName,
  specialRequestId,
}: {
  onAdd: (payload: AddWorkerPayload) => void;
  defaultBranchId?: string;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  defaultName?: string;
  specialRequestId?: string;
}) {
  const { branches, selectedBranchId, resolveWorkerRequest } = useWorkers();
  const { tr } = useI18n();
  const visibleBranches = useMemo(() => {
    const all = Object.values(branches);
    if (selectedBranchId) return all.filter((b) => b.id === selectedBranchId);
    return all;
  }, [branches, selectedBranchId]);

  const [internalOpen, setInternalOpen] = useState(false);
  const dialogOpen = open ?? internalOpen;
  const setDialogOpen = onOpenChange ?? setInternalOpen;

  const [name, setName] = useState(defaultName ?? "");
  const [dateText, setDateText] = useState("");
  const [branchId, setBranchId] = useState<string | undefined>(
    defaultBranchId ?? selectedBranchId ?? Object.values(branches)[0]?.id,
  );
  const [assignedArea, setAssignedArea] = useState<string | undefined>(
    undefined,
  );
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

  // Sync defaultName when dialog opens
  useEffect(() => {
    if (defaultName && dialogOpen) {
      setName(defaultName);
    }
  }, [defaultName, dialogOpen]);

  // Sync default/selected branch into local state
  useEffect(() => {
    setBranchId((prev) => {
      const target = defaultBranchId ?? selectedBranchId ?? prev;
      if (!target) return prev;
      return target;
    });
  }, [defaultBranchId, selectedBranchId]);
  const dateValid = parsedDate != null;
  const canSave =
    !!capturedFace &&
    !!faceEmbedding &&
    !!name.trim() &&
    dateValid &&
    !!branchId;

  function reset() {
    setName("");
    setDateText("");
    setBranchId(
      defaultBranchId ?? selectedBranchId ?? Object.values(branches)[0]?.id,
    );
    setAssignedArea(undefined);
    setPassportDataUrl(undefined);
    setCapturedFace(null);
    setFaceEmbedding(null);
    setPlan("");
    cam.stop();
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

  async function doCaptureFace() {
    try {
      if (!cam.isActive) await cam.start();
      const live = await checkLivenessFlexible(cam.videoRef.current!, {
        tries: 10,
        intervalMs: 160,
        strict: false,
      });
      if (!live)
        toast.info(
          tr(
            "تخطّي فحص الحيوية بسبب ضعف الحركة/الإضاءة.",
            "Liveness relaxed due to low motion/light.",
          ),
        );
      const det = await detectSingleDescriptor(cam.videoRef.current!);
      if (!det) {
        toast.error(tr("لم يتم اكتشاف وجه واضح", "No clear face detected"));
        return;
      }
      const snap = await captureSnapshot(cam.videoRef.current!);
      setCapturedFace(snap);
      setFaceEmbedding(det.descriptor);
      toast.success(tr("تم التقاط صورة الوجه", "Face photo captured"));
    } catch (e: any) {
      toast.error(
        e?.message || tr("تعذر التقاط الصورة", "Failed to capture photo"),
      );
    }
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(tr("الاسم مطلوب", "Name is required"));
      return;
    }
    if (!dateValid || parsedDate == null) {
      toast.error(
        tr("صيغة التاريخ يجب أن تكون dd/mm/yyyy", "Date must be dd/mm/yyyy"),
      );
      return;
    }
    if (!branchId) {
      toast.error(tr("اختر الفرع", "Select a branch"));
      return;
    }
    if (!capturedFace || !faceEmbedding) {
      toast.error(tr("التقط صورة الوجه أولاً", "Capture face first"));
      return;
    }

    setBusyEnroll(true);
    try {
      // Auto-select plan based on document upload:
      // - with_expense if Passport is uploaded -> goes to "Registered Applicants"
      // - no_expense if NO documents are uploaded -> goes to "Residency without allowance"
      const hasDocs = !!passportDataUrl;
      const planFinal = hasDocs ? "with_expense" : "no_expense";

      console.log("[AddWorkerDialog] Submitting worker:", {
        name: trimmed,
        hasDocs,
        hasPassport: !!passportDataUrl,
        planFinal,
      });

      // Ensure worker exists in backend and get id
      const up = await fetch("/api/workers/upsert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-name": trimmed,
          "x-arrival": String(parsedDate),
          "x-branch-id": String(branchId || ""),
          "x-plan": planFinal,
        },
        body: JSON.stringify({
          name: trimmed,
          arrivalDate: parsedDate,
          branchId,
          plan: planFinal,
        }),
      });
      const uj = await up.json().catch(() => ({}) as any);
      if (!up.ok || !uj?.id) {
        toast.error(
          uj?.message ||
            tr(
              "تعذر حفظ بيانات العاملة في القاعدة",
              "Failed to save worker in database",
            ),
        );
        return;
      }
      const workerId = uj.id as string;
      // Enroll face embedding with snapshot
      const emb = Array.from(faceEmbedding as any);
      const enr = await fetch("/api/face/enroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-emb-len": String(emb.length),
          "x-snap-len": String((capturedFace || "").length),
        },
        body: JSON.stringify({
          workerId,
          embedding: emb,
          descriptor: emb,
          face: emb,
          snapshot: capturedFace,
        }),
      });
      let ej: any = null;
      try {
        ej = await enr.clone().json();
      } catch {
        try {
          ej = { raw: await enr.text() };
        } catch {}
      }
      if (!enr.ok || !ej?.ok) {
        // Surface server debug payload when available
        try {
          console.error("/api/face/enroll error:", ej);
        } catch {}
        toast.error(
          ej?.message || tr("تعذر حفظ صورة الوجه", "Failed to save face photo"),
        );
        return;
      }
      // Upload documents and assigned area if provided
      if (passportDataUrl || assignedArea) {
        try {
          const patch: any = {
            workerId,
            name: trimmed,
            branchId,
            arrivalDate: parsedDate,
          };
          if (passportDataUrl) patch.passportDataUrl = passportDataUrl;
          if (assignedArea) patch.assignedArea = assignedArea;

          console.log("[AddWorkerDialog] Uploading documents:", {
            workerId: workerId.slice(0, 8),
            hasPassport: !!passportDataUrl,
          });

          const docRes = await fetch("/api/workers/docs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });

          const docJson = await docRes.json().catch(() => ({}) as any);
          console.log("[AddWorkerDialog] Documents upload response:", {
            workerId: workerId.slice(0, 8),
            status: docRes.status,
            ok: docRes.ok,
            message: docJson?.message,
          });
          if (!docRes.ok) {
            console.error("[AddWorkerDialog] Document upload failed:", {
              status: docRes.status,
              message: docJson?.message,
            });
            toast.error(
              docJson?.message ||
                tr("فشل حفظ المستندات", "Failed to save documents"),
            );
          }
        } catch (err) {
          console.error("[AddWorkerDialog] Document upload failed:", err);
          toast.error(tr("خطأ في رفع المستندات", "Error uploading documents"));
        }
      }
      const payload: AddWorkerPayload = {
        id: workerId,
        name: trimmed,
        arrivalDate: parsedDate,
        branchId,
        plan: planFinal,
        assignedArea,
        passportDataUrl,
        avatarDataUrl: capturedFace || undefined,
      };
      onAdd(payload);
      if (specialRequestId) {
        resolveWorkerRequest(specialRequestId, workerId);
      }
      toast.success(tr("تم الحفظ", "Saved successfully"));
      setDialogOpen(false);
      reset();
    } finally {
      setBusyEnroll(false);
    }
  }

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(v) => {
        setDialogOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="w-full justify-center">
          {tr("إضافة متقدمة", "Add applicant")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("إضافة متقدمة", "Add applicant")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="aw-name">{tr("الاسم", "Name")}</Label>
            <Input
              id="aw-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr("اسم العاملة", "Applicant name")}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="aw-date">
                {tr("تاريخ الوصول", "Arrival date")} (dd/mm/yyyy)
              </Label>
              <Input
                id="aw-date"
                inputMode="numeric"
                pattern="\\d{2}/\\d{2}/\\d{4}"
                placeholder={tr("مثال: 05/09/2024", "Example: 05/09/2024")}
                value={dateText}
                onChange={(e) => setDateText(formatDateInput(e.target.value))}
              />
              {!dateValid && dateText.trim() !== "" ? (
                <p className="text-xs text-rose-700">
                  {tr(
                    "الرجاء إدخال التاريخ بهذه الصيغة فقط: dd/mm/yyyy",
                    "Please enter date in dd/mm/yyyy format",
                  )}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>{tr("الفرع", "Branch")}</Label>
              <Select value={branchId} onValueChange={(v) => setBranchId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={tr("اختر الفرع", "Select branch")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {visibleBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{tr("المنطقة المخصصة", "Assigned Area")}</Label>
            <Select
              value={assignedArea || ""}
              onValueChange={(v) => setAssignedArea(v || undefined)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tr("اختر المنطقة", "Select area")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">NONE</SelectItem>
                <SelectItem value="MUSANED">MUSANED</SelectItem>
                <SelectItem value="BRANCH">BRANCH</SelectItem>
                <SelectItem value="REGULAR_1">REGULAR 1</SelectItem>
                <SelectItem value="REGULAR_2">REGULAR 2</SelectItem>
                <SelectItem value="REGULAR_3">REGULAR 3</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 hidden">
            <Label>
              {tr("نوع الإقامة (إلزامي)", "Residency type (required)")}
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
                      {tr("إقامة + مصروف", "Residency + allowance")}
                    </label>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-md border px-3 py-2">
                    <RadioGroupItem value="no_expense" id="plan2" />
                    <label htmlFor="plan2" className="cursor-pointer">
                      {tr("إقامة بدون مصروف", "Residency without allowance")}
                    </label>
                  </div>
                </RadioGroup>
              </label>
            </div>
          </div>

          {/* Face capture box */}
          <div className="space-y-2">
            <Label>
              {tr("التقاط صورة الوجه (إلزامي)", "Capture face (required)")}
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
                  {tr("تشغيل الكاميرا", "Start camera")}
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={cam.stop}>
                    {tr("إيقاف", "Stop")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={cam.switchCamera}
                  >
                    {tr("تبديل الكاميرا", "Switch camera")}
                  </Button>
                  <Button size="sm" onClick={doCaptureFace}>
                    {tr("التقاط صورة", "Capture photo")}
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
                  {tr("إعادة الالتقاط", "Retake")}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            {/* Passport */}
            <div className="space-y-2">
              <Label htmlFor="aw-passport">
                {tr("صورة جواز السفر (اختياري)", "Passport photo (optional)")}
              </Label>
              <input
                id="aw-passport"
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
                <label htmlFor="aw-passport" className="cursor-pointer">
                  {tr("رفع الجواز", "Upload Passport")}
                </label>
              </Button>
              {passportDataUrl ? (
                <img
                  src={passportDataUrl}
                  alt="جواز السفر"
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
              setDialogOpen(false);
            }}
          >
            {tr("إلغاء", "Cancel")}
          </Button>
          {capturedFace ? (
            <Button onClick={handleSubmit} disabled={!canSave || busyEnroll}>
              {busyEnroll ? tr("جارٍ الحفظ…", "Saving…") : tr("حفظ", "Save")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
