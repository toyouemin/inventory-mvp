"use client";

import { useEffect, useMemo, useState } from "react";
import { moveStock } from "./actions";
import type { BalanceItem, LocationItem, Product } from "./types";

export function MoveStockModal({
  open,
  product,
  locations,
  balances,
  onClose,
}: {
  open: boolean;
  product: Pick<Product, "id" | "nameSpec"> | null;
  locations: LocationItem[];
  balances: BalanceItem[];
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [fromLocId, setFromLocId] = useState<number>(locations[0]?.id ?? 0);
  const [toLocId, setToLocId] = useState<number>(locations[1]?.id ?? 0);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");

  const getQty = (locationId: number) =>
    balances.find((b) => b.locationId === locationId)?.qty ?? 0;

  const toOptions = useMemo(
    () => locations.filter((l) => l.id !== fromLocId),
    [locations, fromLocId]
  );

  useEffect(() => {
    if (!open) return;
    setPending(false);
    setQty("");
    setNote("");
    const from = locations[0]?.id ?? 0;
    const to = (locations.find((l) => l.id !== from)?.id ?? locations[1]?.id) ?? 0;
    setFromLocId(from);
    setToLocId(to);
  }, [open, locations]);

  useEffect(() => {
    if (!open) return;
    if (fromLocId === toLocId) {
      const other = locations.find((l) => l.id !== fromLocId);
      if (other) setToLocId(other.id);
    }
  }, [open, fromLocId, toLocId, locations]);

  async function handleMove() {
    if (!product) return;
    const q = parseInt(qty, 10);
    if (!Number.isFinite(q) || q <= 0) return;
    if (fromLocId === toLocId) return;
    if (getQty(fromLocId) < q) return;
    if (pending) return;
    setPending(true);
    try {
      await moveStock(product.id, fromLocId, toLocId, q, note || null);
      onClose();
    } finally {
      setPending(false);
    }
  }

  if (!open || !product) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>재고이동: {product.nameSpec}</h3>
        <div className="modal-form">
          <label>출발</label>
          <select
            value={fromLocId}
            onChange={(e) => setFromLocId(Number(e.target.value))}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} (현재: {getQty(l.id)})
              </option>
            ))}
          </select>
          <label>도착</label>
          <select value={toLocId} onChange={(e) => setToLocId(Number(e.target.value))}>
            {toOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <label>수량</label>
          <input
            type="number"
            min={1}
            max={getQty(fromLocId)}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="수량 입력"
          />
          <label>메모</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="(선택)"
          />
        </div>
        <div className="modal-actions">
          <button
            type="button"
            onClick={handleMove}
            disabled={
              pending ||
              !qty ||
              parseInt(qty, 10) <= 0 ||
              fromLocId === toLocId ||
              getQty(fromLocId) < parseInt(qty, 10)
            }
          >
            이동
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

