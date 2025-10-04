function parseManualDateToTs(input: string): number | null {
  const t = normalizeDigits(input).trim();
  // Regex to strictly match dd/mm/yyyy or d/m/yy(yy)
  const m = t.match(/^(\d{1,2})\D(\d{1,2})\D(\d{2,4})$/);
  if (m) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    let y = Number(m[3]);

    // Handle 2-digit years
    if (y < 100) {
      y += 2000;
    }

    // Basic validation for month and day
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const ts = new Date(y, mo - 1, d, 12, 0, 0, 0).getTime();
      if (!isNaN(ts)) {
        return ts;
      }
    }
  }
  // Fallback for direct parsing if the above fails, though the goal is strict format
  const parsed = new Date(t);
  if (!isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0).getTime();
  }
  return null;
}
