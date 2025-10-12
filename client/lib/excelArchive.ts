import * as XLSX from "xlsx";

export type ArchiveRow = {
  name: string;
  verifiedAt: number; // epoch ms
  amount: number; // PHP
  branch?: string;
};

function monthKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthSheetName(ts: number, locale: string) {
  const d = new Date(ts);
  const month = d.toLocaleString(locale === "ar" ? "ar-EG" : "en-US", {
    month: "long",
  });
  return `${month} ${d.getFullYear()}`;
}

export function exportMonthlyArchive(rows: ArchiveRow[], locale: string) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const byMonth: Record<string, ArchiveRow[]> = {};
  for (const r of rows) (byMonth[monthKey(r.verifiedAt)] ||= []).push(r);

  const wb = XLSX.utils.book_new();

  Object.keys(byMonth)
    .sort()
    .forEach((key) => {
      const list = byMonth[key]
        .slice()
        .sort((a, b) => a.verifiedAt - b.verifiedAt);
      // Group by day (YYYY-MM-DD)
      const byDay: Record<string, ArchiveRow[]> = {};
      for (const r of list) {
        const d = new Date(r.verifiedAt);
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate(),
        ).padStart(2, "0")}`;
        (byDay[ymd] ||= []).push(r);
      }
      const aoa: any[][] = [];
      Object.keys(byDay)
        .sort()
        .forEach((ymd) => {
          // Day header row (highlight)
          const [y, m, dd] = ymd.split("-").map((n) => Number(n));
          const headerDate = new Date(y, m - 1, dd);
          const dayTitle = headerDate.toLocaleDateString(
            locale === "ar" ? "ar-EG" : "en-US",
          );
          aoa.push(["", dayTitle, ""]);
          aoa.push(["Name", "time", "amount"]);
          for (const r of byDay[ymd]) {
            const t = new Date(r.verifiedAt).toLocaleTimeString(
              locale === "ar" ? "ar-EG" : "en-US",
              { hour12: false },
            );
            aoa.push([r.name || "", t, Number(r.amount) || 0]);
          }
          aoa.push(["", "", ""]);
        });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Column widths
      ws["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 12 }];
      // Number format for amount column (C)
      for (let r = 0; r < aoa.length; r++) {
        const cellRef = XLSX.utils.encode_cell({ r, c: 2 });
        const cell = ws[cellRef];
        if (cell && typeof aoa[r]?.[2] === "number")
          (cell as any).z = "[$₱-en-PH] #,##0.00";
      }
      // Try to highlight day header rows (community edition may ignore styling)
      for (let r = 0; r < aoa.length; r++) {
        if (
          typeof aoa[r]?.[1] === "string" &&
          /\d{1,2}\/.+\/.+/.test(aoa[r][1])
        ) {
          const ref = XLSX.utils.encode_cell({ r, c: 1 });
          const cell: any = ws[ref];
          if (cell) {
            cell.s = {
              fill: { fgColor: { rgb: "FFF59D" } },
              bold: true,
            } as any;
          }
        }
      }
      const anyTs = byMonth[key][0].verifiedAt;
      XLSX.utils.book_append_sheet(wb, ws, monthSheetName(anyTs, locale));
    });

  const firstTs = rows.reduce(
    (m, r) => Math.min(m, r.verifiedAt),
    rows[0].verifiedAt,
  );
  const lastTs = rows.reduce(
    (m, r) => Math.max(m, r.verifiedAt),
    rows[0].verifiedAt,
  );
  const fname = `archive-${new Date(firstTs).toISOString().slice(0, 10)}_to_${new Date(
    lastTs,
  )
    .toISOString()
    .slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fname);
}
