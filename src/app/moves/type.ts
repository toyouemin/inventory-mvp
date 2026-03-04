export type MoveRow = {
    id: string;           // uuid
    productId: string;    // uuid
    type: string;         // "adjust" | "in" | "out" 등
    qty: number;
    note?: string | null;
    createdAt?: string | null;
  
    // join으로 같이 가져올 표시용
    sku?: string | null;
    nameSpec?: string | null;
  };