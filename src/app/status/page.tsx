import { supabaseServer } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const { data, error } = await supabaseServer
    .from("products")
    .select("id, sku, name_spec, stock, wholesale_price, msrp_price, sale_price")
    .order("sku", { ascending: true });

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>재고 현황</h1>
        <p style={{ color: "crimson" }}>Supabase error: {error.message}</p>
      </div>
    );
  }

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    sku: r.sku,
    name: r.name_spec ?? r.sku,
    stock: r.stock ?? 0,

    wholesalePrice: r.wholesale_price ?? null, // 출고가
    msrpPrice: r.msrp_price ?? null, // 소비자가
    salePrice: r.sale_price ?? null, // 실판매가
  }));

  const totalSkus = rows.length;
  const totalQty = rows.reduce((sum, r) => sum + (Number(r.stock) || 0), 0);
  const zeroStock = rows.filter((r) => (Number(r.stock) || 0) === 0).length;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>재고 현황</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="품목 수" value={`${totalSkus.toLocaleString()}개`} />
        <Stat label="총 재고" value={`${totalQty.toLocaleString()}개`} />
        <Stat label="재고 0" value={`${zeroStock.toLocaleString()}개`} />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>SKU</th>
              <th style={th}>품명</th>
              <th style={th}>재고</th>
              <th style={th}>출고가</th>
              <th style={th}>소비자가</th>
              <th style={th}>실판매가</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td style={td} colSpan={6}>
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.sku}</td>
                  <td style={td}>{r.name}</td>
                  <td style={td}>
                    <strong>{Number(r.stock).toLocaleString()}</strong>
                  </td>
                  <td style={td}>
                    {r.wholesalePrice != null ? `${Number(r.wholesalePrice).toLocaleString()}원` : "-"}
                  </td>
                  <td style={td}>
                    {r.msrpPrice != null ? `${Number(r.msrpPrice).toLocaleString()}원` : "-"}
                  </td>
                  <td style={td}>
                    {r.salePrice != null ? `${Number(r.salePrice).toLocaleString()}원` : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        padding: "10px 12px",
        minWidth: 160,
      }}
    >
      <div style={{ color: "#666", fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  padding: "10px 8px",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: "10px 8px",
  verticalAlign: "top",
};