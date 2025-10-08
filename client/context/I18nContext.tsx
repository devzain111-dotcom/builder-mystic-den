import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Locale = "ar" | "en";

type Dict = Record<string, { ar: string; en: string }>; // can be extended later

const dict: Dict = {
  brand_title: { ar: "تحقق السكن", en: "Residence Verify" },
  brand_sub: {
    ar: "نظام تحقق حضور المقيمين",
    en: "Residents Attendance Verification",
  },
  nav_workers: { ar: "المتقدمات", en: "Applicants" },
};

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggle: () => void;
  t: (key: keyof typeof dict) => string;
  tr: (ar: string, en: string) => string;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(
    () => (localStorage.getItem("locale") as Locale) || "ar",
  );

  useEffect(() => {
    localStorage.setItem("locale", locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const value = useMemo<I18nState>(
    () => ({
      locale,
      setLocale,
      toggle: () => setLocale((p) => (p === "ar" ? "en" : "ar")),
      t: (key) => dict[key]?.[locale] ?? key,
      tr: (ar, en) => (locale === "ar" ? ar : en),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
