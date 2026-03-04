import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const balances = await prisma.stockBalance.findMany({
    include: {
      product: { select: { sku: true } },
      location: { select: { code: true } },
    },
    orderBy: [{ productId: "asc" }, { locationId: "asc" }],
  });

  const header = "sku,locationCode,qty";
  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const rows = balances.map((b) =>
    [b.product.sku, b.location.code, b.qty].map(escape).join(",")
  );

  const csv = "\uFEFF" + header + "\n" + rows.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stock.csv"',
    },
  });
}
