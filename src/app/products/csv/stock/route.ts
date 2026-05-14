import { formatDownloadFileNameDateYymmdd } from "@/lib/downloadFileNameDate";
import { supabaseServer } from "@/lib/supabaseClient";
import { unstable_noStore as noStore } from "next/cache";

import { loadProductStockExportBundle } from "../../xlsx/productStockExportShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(v: unknown) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  noStore();
  if (!supabaseServer) {
    return new Response("Supabase server client not ready. Check env vars.", { status: 500 });
  }
  const debugCsv = new URL(req.url).searchParams.get("debugCsv") === "1";

  const { aoa, error } = await loadProductStockExportBundle({ debugVariantRows: debugCsv });

  if (error) {
    return new Response(`Supabase error: ${error.message}`, { status: 500 });
  }

  const lines = [aoa[0].map((h) => csvEscape(h)).join(","), ...aoa.slice(1).map((row) => row.map((c) => csvEscape(c)).join(","))];
  const csv = "\uFEFF" + lines.join("\r\n");

  const yymmdd = formatDownloadFileNameDateYymmdd(new Date());
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock_${yymmdd}.csv"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
