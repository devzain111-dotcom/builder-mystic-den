import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, locale: "ar" | "en" = "ar"): string {
  const code = "PHP";
  const loc = locale === "ar" ? "ar-EG" : "en-PH";
  try {
    return new Intl.NumberFormat(loc, {
      style: "currency",
      currency: code,
      currencyDisplay: "symbol",
      maximumFractionDigits: 0,
    }).format(Number(amount) || 0);
  } catch {
    const num = Number(amount) || 0;
    const n = num.toLocaleString(locale === "ar" ? "ar-EG" : "en-US");
    return `${n} PHP`;
  }
}
