import { CheckCircle2, Languages } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useI18n } from "@/context/I18nContext";

export default function Header() {
  const { t, toggle, locale } = useI18n();
  return (
    <header className="border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-40">
      <div className="container mx-auto flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <div className="text-base font-bold">{t("brand_title")}</div>
            <div className="text-xs text-muted-foreground">
              {t("brand_sub")}
            </div>
          </div>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
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
  );
}
