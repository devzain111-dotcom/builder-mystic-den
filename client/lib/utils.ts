import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number,
  locale: "ar" | "en" = "ar",
): string {
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

export const DAY_MS = 24 * 60 * 60 * 1000;

export function noExpenseBaseGraceDays(): number {
  return 14;
}

function getOverrideDaysRemaining(
  w: { docs?: any },
  now: number = Date.now(),
): number | null {
  const overrideRaw = w?.docs?.no_expense_days_override;
  if (overrideRaw === undefined || overrideRaw === null) return null;
  const override = Number(overrideRaw);
  if (isNaN(override)) return null;
  const setAtRaw = w?.docs?.no_expense_days_override_set_at;
  const setAt =
    setAtRaw === undefined || setAtRaw === null ? null : Number(setAtRaw);
  if (setAt && !isNaN(setAt) && setAt > 0) {
    const elapsedMs = now - setAt;
    const elapsedDays = elapsedMs / DAY_MS;
    return override - elapsedDays;
  }
  return override;
}

export function noExpenseDeadlineTs(w: {
  arrivalDate?: number;
  plan?: string;
  docs?: any;
}): number {
  const arrival = Number(w?.arrivalDate) || Date.now();
  const base = noExpenseBaseGraceDays();
  const extra = Number(w?.docs?.no_expense_extension_days_total || 0) || 0;
  return arrival + (base + extra) * DAY_MS;
}

export function isNoExpensePolicyLocked(
  w: { arrivalDate?: number; plan?: string; docs?: any },
  now: number = Date.now(),
): boolean {
  const plan = (w?.plan ?? w?.docs?.plan) as string | undefined;
  if (plan !== "no_expense") return false;
  const hasDocs = !!(w?.docs?.or || w?.docs?.passport);
  if (hasDocs) return false;
  const overrideLeft = getOverrideDaysRemaining(w, now);
  if (overrideLeft !== null && overrideLeft > 0) return false;
  return now > noExpenseDeadlineTs(w);
}

export function noExpenseDaysLeft(
  w: { arrivalDate?: number; plan?: string; docs?: any },
  now: number = Date.now(),
): number {
  // Check if admin has set an override value
  const overrideLeft = getOverrideDaysRemaining(w, now);
  if (overrideLeft !== null) {
    return Math.max(0, Math.ceil(overrideLeft));
  }

  const leftMs = noExpenseDeadlineTs(w) - now;
  return Math.ceil(leftMs / DAY_MS);
}
