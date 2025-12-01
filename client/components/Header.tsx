import { CheckCircle2, Languages, RefreshCw } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useI18n } from "@/context/I18nContext";
import { usePageRefresh } from "@/context/PageRefreshContext";
import { toast } from "sonner";

export default function Header() {
  const { t, toggle, locale } = useI18n();
  const { refreshPage, isRefreshing } = usePageRefresh();

  const handleRefresh = async () => {
    try {
      await refreshPage();
      toast.success(
        locale === "ar"
          ? "تم تحديث البيانات بنجاح"
          : "Data refreshed successfully",
      );
    } catch (err) {
      console.error("Refresh failed:", err);
      toast.error(
        locale === "ar"
          ? "فشل تحديث البيانات"
          : "Failed to refresh data",
      );
    }
  };

  return (
    <header className="border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-40">
      <div className="container mx-auto flex h-16 md:h-20 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CheckCircle2 className="h-5 w-5 md:h-6 md:w-6" />
          </span>
          <div className="leading-tight">
            <div className="text-base md:text-lg font-bold">
              {t("brand_title")}
            </div>
            <div className="text-xs md:text-sm text-muted-foreground">
              {t("brand_sub")}
            </div>
          </div>
        </Link>
        <nav className="flex items-center gap-3 md:gap-4 text-sm">
          <NavLink
            to="/workers"
            className={({ isActive }) =>
              `${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"} text-sm md:text-base`
            }
          >
            {t("nav_workers")}
          </NavLink>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 md:gap-2 rounded-md border px-2.5 md:px-3 py-2 md:py-2.5 text-xs md:text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={locale === "ar" ? "تحديث البيانات" : "Refresh data"}
          >
            <RefreshCw
              className={`h-4 w-4 md:h-5 md:w-5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">
              {locale === "ar" ? "تحديث" : "Refresh"}
            </span>
          </button>

          <button
            onClick={toggle}
            className="inline-flex items-center gap-2 rounded-md border px-3 md:px-4 py-2 md:py-2.5 text-xs md:text-sm hover:bg-accent"
          >
            <Languages className="h-4 w-4 md:h-5 md:w-5" />{" "}
            {locale === "ar" ? "EN" : "AR"}
          </button>
        </nav>
      </div>
    </header>
  );
}
