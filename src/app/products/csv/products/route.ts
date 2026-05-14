import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";
import { unstable_noStore as noStore } from "next/cache";

import { loadProductStockExportBundle } from "../../xlsx/productStockExportShared";

export const dynamic = "force-dynamic";

function csvEscape(v: unknown) {
  const s = (v ?? "").toString();
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  noStore();
  const debugCsv = new URL(req.url).searchParams.get("debugCsv") === "1";

  const { aoa, error } = await loadProductStockExportBundle({ debugVariantRows: debugCsv });

  if (error) {
    return new Response(`CSV export failed: ${error.message}`, { status: 500 });
  }

  const lines = [aoa[0].map((h) => csvEscape(h)).join(","), ...aoa.slice(1).map((row) => row.map((c) => csvEscape(c)).join(","))];
  const csv = "\uFEFF" + lines.join("\r\n");

  const yymmdd = formatDownloadFileNameDateYymmdd(new Date());
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products_${yymmdd}.csv"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
