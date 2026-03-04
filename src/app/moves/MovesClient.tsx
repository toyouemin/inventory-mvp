"use client";

import { useMemo, useState } from "react";
import type { MoveRow } from "./types";

export function MovesClient({ moves }: { moves: MoveRow[] }) {
  const [visibleCount, setVisibleCount] = useState(10);

  const visibleMoves = useMemo(() => moves.slice(0, visibleCount), [moves, visibleCount]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>재고 변동</h1>

      <p style={{ color: "#666", marginBottom: 12 }}>
        {Math.min(visibleCount, moves.length)}개 표시 (최대 {Math.min(100, moves.length)}개)
      </p>

      <div style={{ overflowX: "auto" }}>
        <table className="table moves-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8 }}>SKU</th>
              <th style={{ textAlign: "left", padding: 8 }}>품명</th>
              <th style={{ textAlign: "left", padding: 8 }}>타입</th>
              <th style={{ textAlign: "right", padding: 8 }}>수량</th>
              <th style={{ textAlign: "left", padding: 8 }}>메모</th>
              <th style={{ textAlign: "left", padding: 8 }}>날짜</th>
            </tr>
          </thead>
          <tbody>
            {visibleMoves.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, color: "#666" }}>
                  기록이 없습니다.
                </td>
              </tr>
            ) : (
              visibleMoves.map((m) => (
                <tr key={m.id}>
                  <td style={{ padding: 8 }}>{m.sku ?? "-"}</td>
                  <td style={{ padding: 8 }}>{m.nameSpec ?? "-"}</td>
                  <td style={{ padding: 8 }}>{m.type}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{m.qty}</td>
                  <td style={{ padding: 8 }}>{m.note ?? "-"}</td>
                  <td style={{ padding: 8 }}>
                    {m.createdAt ? new Date(m.createdAt).toLocaleString("ko-KR") : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {moves.length > visibleCount && visibleCount < 100 && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setVisibleCount((prev) => Math.min(prev + 10, 100))}
          >
            더보기 (+10)
          </button>
        </div>
      )}
    </div>
  );
}