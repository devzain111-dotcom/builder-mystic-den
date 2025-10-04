import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkers } from "@/context/WorkersContext";
import { toast } from "sonner";

export interface AddWorkerPayload {
  name: string;
  arrivalDate: number;
  branchId: string;
  orDataUrl?: string;
  passportDataUrl?: string;
}

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
function normalizeDigits(s: string) {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(arabicDigits.indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(persianDigits.indexOf(d)));
}

// Strictly accepts only dd/mm/yyyy (two-digit day, two-digit month, four-digit year) and returns a local noon timestamp
function parseManualDateToTs(input: string): number | null {
  const t = normalizeDigits(input).trim();
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() + 1 !== mo ||
    dt.getDate() !== d
  )
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
  const [branchId, setBranchId] = useState<string | undefined>(defaultBranchId ?? branchList[0]?.id);
  const [orDataUrl, setOrDataUrl] = useState<string | undefined>(undefined);
  const [passportDataUrl, setPassportDataUrl] = useState<string | undefined>(undefined);

  const parsedDate = useMemo(() => parseManualDateToTs(dateText), [dateText]);
  const dateValid = parsedDate != null;

  function reset() {
    setName("");
    setDateText("");
    setBranchId(defaultBranchId ?? branchList[0]?.id);
    setOrDataUrl(undefined);
    setPassportDataUrl(undefined);
  }

  function toDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
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
    const payload: AddWorkerPayload = {
      name: trimmed,
      arrivalDate: parsedDate,
      branchId,
      orDataUrl,
      passportDataUrl,
    };
    onAdd(payload);
    setOpen(false);
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button>إضافة عاملة</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة عاملة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="aw-name">الاسم</Label>
            <Input id="aw-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم العاملة" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="aw-date">تاريخ الوصول (dd/mm/yyyy)</Label>
              <Input
                id="aw-date"
                inputMode="numeric"
                pattern="\d{2}/\d{2}/\d{4}"
                placeholder="مثال: 05/09/2024"
                value={dateText}
                onChange={(e) => setDateText(e.target.value)}
              />
              {!dateValid && dateText.trim() !== "" ? (
                <p className="text-xs text-rose-700">الرجاء إدخال التاريخ بهذه الصيغة فقط: dd/mm/yyyy</p>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="aw-or">صورة OR (اختياري)</Label>
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
                <label htmlFor="aw-or" className="cursor-pointer">رفع صورة OR</label>
              </Button>
              {orDataUrl ? (
                <img src={orDataUrl} alt="OR" className="max-h-32 rounded-md border" />
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="aw-pass">صورة الجواز (اختياري)</Label>
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
                <label htmlFor="aw-pass" className="cursor-pointer">رفع صورة الجواز</label>
              </Button>
              {passportDataUrl ? (
                <img src={passportDataUrl} alt="الجواز" className="max-h-32 rounded-md border" />
              ) : null}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setOpen(false); }}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit}>حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
