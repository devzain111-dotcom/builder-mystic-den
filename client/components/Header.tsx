import { CheckCircle2, Languages, AlarmClock } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useI18n } from "@/context/I18nContext";
import { useWorkers, SPECIAL_REQ_GRACE_MS } from "@/context/WorkersContext";
import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function timeLeft(ms: number, locale: "ar" | "en") {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hAbbr = locale === "ar" ? "س" : "h";
  const mAbbr = locale === "ar" ? "د" : "m";
  return `${h}${hAbbr} ${m}${mAbbr}`;
}

export default function Header() {
  const { t, toggle, locale, tr } = useI18n();
  const { specialRequests, workers, selectedBranchId } = useWorkers();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const now = Date.now();

  const applicantsNeedingData = useMemo(() => {
    return specialRequests
      .filter((r) => {
        if (r.type !== "worker") return false;
        const worker = r.workerId ? workers[r.workerId] : undefined;
        const b = worker?.branchId || r.branchId || null;
        return selectedBranchId ? b === selectedBranchId : true;
      })
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
  }, [specialRequests, workers, selectedBranchId, now]);

  return (
    <>
      <header className="border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-40">
        <div className="container mx-auto flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <div className="text-base font-bold">{t("brand_title")}</div>
              <div className="text-xs text-muted-foreground">{t("brand_sub")}</div>
            </div>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <button
              onClick={() => setNotificationsOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-orange-500 text-xs font-bold">
                {applicantsNeedingData.length}
              </span>
              {tr("الإشعارات", "Notifications")}
            </button>
            <NavLink
              to="/workers"
              className={({ isActive }) =>
                `${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`
              }
            >
              {t("nav_workers")}
            </NavLink>
            <button
              onClick={toggle}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
            >
              <Languages className="h-4 w-4" /> {locale === "ar" ? "EN" : "AR"}
            </button>
          </nav>
        </div>
      </header>

      {/* Notifications Modal */}
      <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {tr("متقدمات يجب إدخال بياناتهن", "Applicants needing data entry")}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {applicantsNeedingData.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {tr("لا توجد إشعارات", "No notifications")}
              </div>
            ) : (
              <div className="space-y-3">
                {applicantsNeedingData.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-amber-300 bg-amber-50 p-4"
                  >
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex-1">
                        <div className="font-semibold text-sm mb-2">
                          {item.name}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span>
                            {tr("المبلغ:", "Amount:")} ₱{item.amount}
                          </span>
                          <span>•</span>
                          <span>
                            {tr("منذ", "Since")} {new Date(item.createdAt).toLocaleString(
                              locale === "ar" ? "ar-EG" : "en-US"
                            )}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ${
                          item.left <= 0
                            ? "bg-red-600 text-white"
                            : "bg-amber-200 text-amber-900"
                        }`}
                      >
                        {item.left <= 0
                          ? tr("محظورة", "Locked")
                          : `${tr("��تبقّي", "Remaining")} ${timeLeft(
                              item.left,
                              locale
                            )}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
