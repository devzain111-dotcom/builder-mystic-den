export const DEFAULT_TIMEZONE = "Asia/Manila";

interface TimezoneRule {
  timezone: string;
  keywords: RegExp[];
}

const AREA_TIMEZONE_RULES: TimezoneRule[] = [
  {
    timezone: "Asia/Dubai",
    keywords: [/uae/i, /dubai/i, /abu\s?dhabi/i, /regular?_?dubai/i],
  },
  {
    timezone: "Asia/Qatar",
    keywords: [/qatar/i, /doha/i],
  },
  {
    timezone: "Asia/Riyadh",
    keywords: [/ksa/i, /saudi/i, /riyadh/i],
  },
  {
    timezone: DEFAULT_TIMEZONE,
    keywords: [/regular/i, /phil/i, /bacoor/i, /calantas/i, /paranaque/i],
  },
];

const BRANCH_TIMEZONE_RULES: TimezoneRule[] = [
  { timezone: "Asia/Dubai", keywords: [/uae/i, /dubai/i, /abu\s?dhabi/i] },
  { timezone: "Asia/Riyadh", keywords: [/ksa/i, /saudi/i, /riyadh/i] },
  { timezone: DEFAULT_TIMEZONE, keywords: [/phil/i, /manila/i, /bacoor/i] },
];

export function resolveTimezoneForArea(
  assignedArea?: string | null,
  branchName?: string | null,
  explicitTimezone?: string | null,
): string {
  if (explicitTimezone && explicitTimezone.trim().length > 0) {
    return explicitTimezone.trim();
  }

  const normalizedArea = assignedArea?.trim() ?? "";
  if (normalizedArea) {
    const areaRule = AREA_TIMEZONE_RULES.find((rule) =>
      rule.keywords.some((pattern) => pattern.test(normalizedArea)),
    );
    if (areaRule) {
      return areaRule.timezone;
    }
  }

  const normalizedBranch = branchName?.trim() ?? "";
  if (normalizedBranch) {
    const branchRule = BRANCH_TIMEZONE_RULES.find((rule) =>
      rule.keywords.some((pattern) => pattern.test(normalizedBranch)),
    );
    if (branchRule) {
      return branchRule.timezone;
    }
  }

  return DEFAULT_TIMEZONE;
}

export function getTimezoneDayRange(
  referenceDate: Date,
  timezone: string,
): { start: Date; end: Date } {
  try {
    const localizedString = referenceDate.toLocaleString("en-US", {
      timeZone: timezone,
    });
    const zonedDate = new Date(localizedString);
    const offset = zonedDate.getTime() - referenceDate.getTime();

    const startLocal = new Date(zonedDate);
    startLocal.setHours(0, 0, 0, 0);
    const endLocal = new Date(zonedDate);
    endLocal.setHours(23, 59, 59, 999);

    return {
      start: new Date(startLocal.getTime() - offset),
      end: new Date(endLocal.getTime() - offset),
    };
  } catch {
    const fallbackStart = new Date(referenceDate);
    fallbackStart.setUTCHours(0, 0, 0, 0);
    const fallbackEnd = new Date(referenceDate);
    fallbackEnd.setUTCHours(23, 59, 59, 999);
    return { start: fallbackStart, end: fallbackEnd };
  }
}

export function formatTimestampInTimezone(
  timestamp: number,
  timezone: string,
  locale: string = "en-US",
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const formatter = new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
    timeZoneName: "short",
    ...options,
  });

  return formatter.format(date);
}
