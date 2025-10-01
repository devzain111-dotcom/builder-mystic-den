import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkers } from "@/context/WorkersContext";
import { toast } from "sonner";

export interface AddWorkerPayload { name: string; arrivalDate: number; branchId: string; orDataUrl?: string; passportDataUrl?: string }

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
function normalizeDigits(s: string) { return s.replace(/[\u0660-\u0669]/g, (d) => String(arabicDigits.indexOf(d))).replace(/[\u06F0-\u06F9]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))); }
function parseManualDateToTs(input: string): number | null {
  const t = normalizeDigits(input).trim();
  const m = t.match(/(\d{1,4})\D(\d{1,2})\D(\d{2,4})/);
  if (m) {
    let a = Number(m[1]); let b = Number(m[2]); let c = Number(m[3]);
    let y = a > 31 ? a : c; let d = a > 31 ? c : a; let mo = b; if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) { const ts = new Date(y, mo - 1, d, 12, 0, 0, 0).getTime(); if (!isNaN(ts)) return ts; }
  }
  const parsed = new Date(t); if (!isNaN(parsed.getTime())) return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0).getTime();
  return null;
}

export default function AddWorkerDialog({ onAdd, defaultBranchId }: { onAdd: (p: AddWorkerPayload) => void; defaultBranchId?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dateText, setDateText] = useState("");
  const { branches } = useWorkers();
  const [branchId, setBranchId] = useState<string>(defaultBranchId || Object.keys(branches)[0]);
  const [orDataUrl, setOrDataUrl] = useState<string | null>(null);
  const [passportDataUrl, setPassportDataUrl] = useState<string | null>(null);
  const [fpStatus, setFpStatus] = useState<"idle" | "capturing" | "success" | "error">("idle");
  const [fpMessage, setFpMessage] = useState<string>("");

  async function handleCaptureFingerprint() {
    if (!name.trim()) { toast.error("أدخل الاسم أولاً"); return; }
    setFpStatus("capturing"); setFpMessage("");
    const payload = { name: name.trim() };

    async function withTimeout(url: string, init: RequestInit, ms = 10000) {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), ms);
      try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
    }

    try {
      const FP_PUBLIC = (import.meta.env.VITE_FP_PUBLIC_URL as string | undefined)?.replace(/\/$/, "");
      const isHttpsPage = typeof window !== "undefined" && window.location.protocol === "https:";
      const canUsePublicDirect = FP_PUBLIC && (!isHttpsPage || (FP_PUBLIC?.startsWith("https://")));

      const endpoints: { url: string; init: RequestInit; timeout: number }[] = [];
      // Try server proxy first (no CORS issues)
      endpoints.push({ url: "/api/fingerprint/register", init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, timeout: 2500 });
      // Then fallback to direct public URL if allowed
      if (canUsePublicDirect) {
        endpoints.push({ url: `${FP_PUBLIC}/register`, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), mode: "cors" }, timeout: 8000 });
      }

      let res: Response | null = null;
      let lastErrText = "";
      for (const ep of endpoints) {
        try {
          const r = await withTimeout(ep.url, ep.init, ep.timeout);
          if (r.ok) { res = r; break; }
          lastErrText = await r.text();
        } catch (e: any) {
          lastErrText = e?.message || String(e);
          continue;
        }
      }

      if (res && res.ok) {
        setFpStatus("success"); setFpMessage("تم التحقق من البصمة"); toast.success("تم التقاط البصمة بنجاح");
      } else {
        if (isHttpsPage && FP_PUBLIC && FP_PUBLIC.startsWith("http://")) {
          setFpStatus("error"); setFpMessage("رابط البوابة http غير مسموح ضمن https. استخدم رابط HTTPS (ngrok/Cloudflare)");
          toast.error("استخدم رابط HTTPS للنفق العام");
          return;
        }
        setFpStatus("error"); setFpMessage(lastErrText || "فشل في التقاط البصمة"); toast.error(lastErrText || "فشل في التقاط البصمة");
      }
    } catch (e: any) {
      const msg = e?.message || "تعذر الاتصال ببوابة قارئ البصمة";
      setFpStatus("error"); setFpMessage(msg);
      toast.error(msg);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); if (!name.trim() || !dateText.trim() || !branchId) return; const arrivalTs = parseManualDateToTs(dateText.trim()); if (!arrivalTs) return;
    if (fpStatus !== "success") { toast.info("يرجى وضع البصمة أولاً"); return; }
    onAdd({ name: name.trim(), arrivalDate: arrivalTs, branchId, orDataUrl: orDataUrl ?? undefined, passportDataUrl: passportDataUrl ?? undefined });
    setName(""); setDateText(""); setOrDataUrl(null); setPassportDataUrl(null); setFpStatus("idle"); setFpMessage(""); setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4"/>إضافة عاملة</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة عاملة جديدة</DialogTitle>
          <DialogDescription>أدخل البيانات ثم اضغط "ضع البصمة" للتسجيل قبل الحفظ.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">اسم العاملة</Label>
            <Input id="name" value={name} onChange={(e)=>setName(e.target.value)} required placeholder="مثال: فاطمة"/>
          </div>
          <div className="space-y-2">
            <Label htmlFor="arrival">تاريخ الوصول</Label>
            <Input id="arrival" dir="ltr" inputMode="numeric" placeholder="مثال: 2025-09-28 أو 28/09/2025" value={dateText} onChange={(e)=>setDateText(e.target.value)} required />
            <p className="text-xs text-muted-foreground">اكتب التاريخ يدوياً (yyyy-mm-dd أو dd/mm/yyyy).</p>
          </div>
          <div className="space-y-2">
            <Label>الفرع</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="اختر الفرع"/></SelectTrigger>
              <SelectContent>
                {Object.values(branches).map((b)=> (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>OR</Label>
              <input id="or-file" type="file" accept="image/*" className="hidden" onChange={(e)=>{ const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=()=> setOrDataUrl(String(r.result)); r.readAsDataURL(f); }} />
              <Button asChild variant="outline"><label htmlFor="or-file" className="cursor-pointer">رفع OR</label></Button>
              {orDataUrl && <img src={orDataUrl} alt="OR" className="max-h-24 rounded-md border" />}
            </div>
            <div className="space-y-2">
              <Label>Passport</Label>
              <input id="passport-file" type="file" accept="image/*" className="hidden" onChange={(e)=>{ const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=()=> setPassportDataUrl(String(r.result)); r.readAsDataURL(f); }} />
              <Button asChild variant="outline"><label htmlFor="passport-file" className="cursor-pointer">رفع Passport</label></Button>
              {passportDataUrl && <img src={passportDataUrl} alt="Passport" className="max-h-24 rounded-md border" />}
            </div>
          </div>
          <div className="text-sm space-y-2">
            <div>
              الحال��: {orDataUrl && passportDataUrl ? <span className="text-emerald-700 font-semibold">ملف مكتمل</span> : <span className="text-amber-700 font-semibold">ملف غير مكتمل</span>}
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" variant={fpStatus === "success" ? "secondary" : "outline"} onClick={handleCaptureFingerprint} disabled={fpStatus === "capturing" || fpStatus === "success"}>
                {fpStatus === "capturing" ? "جارٍ الالتقاط…" : fpStatus === "success" ? "تم التقاط البصمة" : "ضع البصمة"}
              </Button>
              {fpStatus === "error" && (<span className="text-xs text-destructive">{fpMessage}</span>)}
              {fpStatus === "success" && (<span className="text-xs text-emerald-700">{fpMessage || "جاهز للحفظ"}</span>)}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={()=>setOpen(false)}>إلغاء</Button>
            <Button type="submit" disabled={fpStatus !== "success"}>حفظ</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
