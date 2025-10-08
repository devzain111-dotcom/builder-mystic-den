import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkers } from "@/context/WorkersContext";
import { useCamera } from "@/hooks/useCamera";
import FaceOverlay from "@/components/FaceOverlay";
import { toast } from "sonner";
import { useI18n } from "@/context/I18nContext";

export default function SpecialRequestDialog() {
  const { tr } = useI18n();
  const { workers, addSpecialRequest, selectedBranchId } = useWorkers();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"worker" | "admin" | "">("");
  const [nameText, setNameText] = useState("");
  // الطلب الخاص للعاملات غير المسجلات: نستخدم إدخال الاسم فقط ولا نحتفظ بأي مُعرّف
  const [amountWorker, setAmountWorker] = useState<string>("");

  const list = useMemo(
    () =>
      Object.values(workers).sort((a, b) => a.name.localeCompare(b.name, "ar")),
    [workers],
  );
  const suggestions = useMemo(() => {
    const q = nameText.trim().toLowerCase();
    if (!q) return list.slice(0, 8);
    return list.filter((w) => w.name.toLowerCase().includes(q)).slice(0, 8);
  }, [nameText, list]);

  const cam = useCamera();
  const [repName, setRepName] = useState("");
  const [amountAdmin, setAmountAdmin] = useState<string>("");
  const [captured, setCaptured] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{
    dataUrl: string;
    name: string;
    mime: string;
  } | null>(null);

  const reset = () => {
    setMode("");
    setNameText("");
    setAmountWorker("");
    setRepName("");
    setAmountAdmin("");
    setCaptured(null);
    setAttachment(null);
  };

  async function saveWorker() {
    const amount = Number(amountWorker);
    if (!amount || amount <= 0) return;
    const typed = nameText.trim();
    if (!typed) return;
    const exists = list.some((x) => x.name === typed);
    if (exists) {
      toast.error(
        tr(
          "هذه ال��املة مسجلة بالفعل. الطلب الخاص مخصص لغير المسجلات.",
          "This applicant already exists. Special request is for unregistered applicants.",
        ),
      );
      return;
    }
    addSpecialRequest({
      type: "worker",
      workerName: typed,
      amount,
      unregistered: true,
      branchId: selectedBranchId ?? undefined,
    });
    toast.success(
      tr(
        "تم إنشاء الطلب الخاص للعاملة غير المسجلة",
        "Special request created for unregistered applicant",
      ),
    );
    setOpen(false);
    reset();
  }

  async function capturePhoto() {
    try {
      if (!cam.isActive) await cam.start();
      const data = await cam.capture();
      setCaptured(data);
    } catch {}
  }

  function onAttachmentChange(file: File | undefined | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({
        dataUrl: String(reader.result),
        name: file.name,
        mime: file.type || "",
      });
    };
    reader.readAsDataURL(file);
  }

  function saveAdminRequest() {
    const amount = Number(amountAdmin);
    if (!repName.trim() || !amount || amount <= 0) return;
    if (!captured && !attachment) {
      toast.error(
        tr(
          "يرجى التقاط صورة أو رفع ملف موقّع (PDF/صورة)",
          "Please capture a photo or upload a signed file (PDF/Image)",
        ),
      );
      return;
    }
    addSpecialRequest({
      type: "admin",
      adminRepName: repName.trim(),
      amount,
      imageDataUrl: captured ?? undefined,
      attachmentDataUrl: attachment?.dataUrl,
      attachmentName: attachment?.name,
      attachmentMime: attachment?.mime,
      branchId: selectedBranchId ?? undefined,
    });
    toast.success(tr("تم إنشاء طلب المبلغ", "Amount request created"));
    cam.stop();
    setOpen(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          cam.stop();
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          {tr("طلب مبلغ خاص", "Special amount request")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {tr("طلب مبلغ خاص", "Special amount request")}
          </DialogTitle>
          <DialogDescription>
            {tr(
              "اختر نوع الطلب ثم أدخل التفاصيل المطلوبة.",
              "Choose the request type, then enter the required details.",
            )}
          </DialogDescription>
        </DialogHeader>

        {!mode && (
          <div className="grid grid-cols-2 gap-3">
            <Button className="h-20" onClick={() => setMode("worker")}>
              {tr("لعاملة", "For applicant")}
            </Button>
            <Button
              className="h-20"
              variant="secondary"
              onClick={() => setMode("admin")}
            >
              {tr("لإدارة الفرع", "For branch admin")}
            </Button>
          </div>
        )}

        {mode === "worker" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tr("اسم العاملة", "Applicant name")}</Label>
              <Input
                value={nameText}
                onChange={(e) => {
                  setNameText(e.target.value);
                }}
                placeholder={tr("ابدأ الكتابة للبحث", "Start typing to search")}
              />
              <p className="text-xs text-amber-700">
                {tr(
                  "الطلب هنا مخصص للعاملات غير المسجلات فقط. اكتب الاسم يدوياً إذا لم تكن موجودة في النظام. لا تُعرض أي قائمة أسماء هنا.",
                  "This request is for unregistered applicants only. Type the name manually if not in the system. No list of names is shown here.",
                )}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{tr("المبلغ (₱)", "Amount (₱)")}</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={amountWorker}
                onChange={(e) => setAmountWorker(e.target.value)}
                placeholder={tr("مثال: 500", "e.g., 500")}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setMode("");
                }}
              >
                {tr("رجوع", "Back")}
              </Button>
              <Button onClick={saveWorker}>{tr("حفظ", "Save")}</Button>
            </div>
          </div>
        )}

        {mode === "admin" && (
          <div className="space-y-4">
            <div className="aspect-video relative overflow-hidden rounded-md border bg-black/60">
              <video
                ref={cam.videoRef}
                className="h-full w-full object-cover"
                playsInline
                muted
              />
              <FaceOverlay videoRef={cam.videoRef} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {!cam.isActive ? (
                <Button onClick={cam.start}>
                  {tr("بدء الكاميرا", "Start camera")}
                </Button>
              ) : (
                <Button variant="secondary" onClick={cam.stop}>
                  {tr("إيقاف", "Stop")}
                </Button>
              )}
              <Button onClick={capturePhoto}>
                {tr("التقاط صورة", "Capture photo")}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-2">
                <Label htmlFor="admin-attachment">
                  {tr("ملف موقّع (PDF/صورة)", "Signed file (PDF/Image)")}
                </Label>
                <input
                  id="admin-attachment"
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    onAttachmentChange(f);
                  }}
                />
                <Button asChild variant="outline">
                  <label htmlFor="admin-attachment" className="cursor-pointer">
                    {tr("رفع طلب من التوقيع", "Upload signed request")}
                  </label>
                </Button>
                {attachment && (
                  <div className="rounded-md border p-2 text-sm">
                    {attachment.mime.includes("pdf") ? (
                      <a
                        href={attachment.dataUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {tr("عرض الملف (PDF):", "View file (PDF):")}{" "}
                        {attachment.name}
                      </a>
                    ) : (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="max-h-40 rounded-md border"
                      />
                    )}
                  </div>
                )}
              </div>
              {captured && (
                <div className="rounded-md border p-2">
                  <img
                    src={captured}
                    alt={tr("لقطة الإدارة", "Admin capture")}
                    className="max-h-40 mx-auto"
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>
                  {tr("اسم ممثل الإدارة", "Branch representative name")}
                </Label>
                <Input
                  value={repName}
                  onChange={(e) => setRepName(e.target.value)}
                  placeholder={tr("مثال: أبو أحمد", "e.g., John Doe")}
                />
              </div>
              <div className="space-y-2">
                <Label>{tr("المبلغ (₱)", "Amount (₱)")}</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={amountAdmin}
                  onChange={(e) => setAmountAdmin(e.target.value)}
                  placeholder={tr("مثال: 750", "e.g., 750")}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setMode("");
                }}
              >
                {tr("رجوع", "Back")}
              </Button>
              <Button onClick={saveAdminRequest}>
                {tr("حفظ الطلب", "Save request")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
