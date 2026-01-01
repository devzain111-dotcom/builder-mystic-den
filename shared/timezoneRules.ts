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
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dateFormatter.formatToParts(referenceDate);
    const year = Number(parts.find((p) => p.type === "year")?.value || "0");
    const month = Number(parts.find((p) => p.type === "month")?.value || "1");
    const day = Number(parts.find((p) => p.type === "day")?.value || "1");

    const offsetMinutes = getTimezoneOffsetMinutes(referenceDate, timezone);
    const offsetMs = offsetMinutes * 60 * 1000;

    const startUtc =
      Date.UTC(year, Math.max(0, month - 1), day, 0, 0, 0, 0) - offsetMs;
    const endUtc =
      Date.UTC(year, Math.max(0, month - 1), day, 23, 59, 59, 999) - offsetMs;

    return { start: new Date(startUtc), end: new Date(endUtc) };
  } catch {
    const fallbackStart = new Date(referenceDate);
    fallbackStart.setUTCHours(0, 0, 0, 0);
    const fallbackEnd = new Date(referenceDate);
    fallbackEnd.setUTCHours(23, 59, 59, 999);
    return { start: fallbackStart, end: fallbackEnd };
  }
}

function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  try {
    const offsetFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    });
    const tzNamePart = offsetFormatter
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName");
    if (tzNamePart) {
      const match = tzNamePart.value.match(/GMT([+-])(\d{2})(?::?(\d{2}))?/);
      if (match) {
        const sign = match[1] === "-" ? -1 : 1;
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3] ?? "0", 10);
        return sign * (hours * 60 + minutes);
      }
    }
  } catch {
    /* no-op */
  }
  return 0;
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
