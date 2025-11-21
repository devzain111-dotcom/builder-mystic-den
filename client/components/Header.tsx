import { CheckCircle2, Languages, Bell } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useI18n } from "@/context/I18nContext";
import { useWorkers, SPECIAL_REQ_GRACE_MS } from "@/context/WorkersContext";
import { useState, useMemo } from "react";

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
        name: r.workerName || (r.workerId ? workers[r.workerId]?.name : "") || "اسم غير محدد",
        createdAt: r.createdAt,
        amount: r.amount,
        left: r.createdAt + SPECIAL_REQ_GRACE_MS - now,
      }))
      .sort((a, b) => a.left - b.left);
  }, [specialRequests, workers, selectedBranchId, now]);

  return (
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
          <div className="relative">
            <button
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-accent relative"
            >
              <Bell className="h-4 w-4" />
              {tr("الإشعارات", "Notifications")}
              {applicantsNeedingData.length > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-white text-xs font-bold">
                  {applicantsNeedingData.length}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute top-full right-0 mt-1 w-80 rounded-lg border bg-white shadow-lg z-50">
                <div className="border-b px-4 py-3">
                  <h3 className="font-semibold text-sm">
                    {tr("متقدمات يجب إدخال بياناتهن", "Applicants needing data entry")}
                    {applicantsNeedingData.length > 0 && (
                      <span className="ms-2 text-orange-500 font-bold">
                        ({applicantsNeedingData.length})
                      </span>
                    )}
                  </h3>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {applicantsNeedingData.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {tr("لا توجد إشعارات", "No notifications")}
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {applicantsNeedingData.map((item) => (
                        <li key={item.id} className="px-4 py-3 text-sm hover:bg-accent">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-medium">{item.name}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              item.left <= 0 ? "bg-red-600 text-white" : "bg-orange-200 text-orange-900"
                            }`}>
                              {item.left <= 0
                                ? tr("محظورة", "Locked")
                                : `${tr("متبقّي", "Remaining")} ${timeLeft(item.left, locale)}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{tr("المبلغ:", "Amount:")} ₱{item.amount}</span>
                            <span>•</span>
                            <span>{new Date(item.createdAt).toLocaleDateString(
                              locale === "ar" ? "ar-EG" : "en-US"
                            )}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          <NavLink to="/workers" className={({ isActive }) => `${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {t("nav_workers")}
          </NavLink>
          <button onClick={toggle} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
            <Languages className="h-4 w-4" /> {locale === "ar" ? "EN" : "AR"}
          </button>
        </nav>
      </div>
    </header>
  );
}
