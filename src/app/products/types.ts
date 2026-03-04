export type Product = {
  id: string;
  sku: string;
  category?: string | null;
  nameSpec: string;
  imageUrl?: string | null;
  memo?: string | null;
  stock?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;  
  wholesalePrice?: number | null; // 출고가
  msrpPrice?: number | null; // 소비자가
  salePrice?: number | null; // 실판매가
};

// 이제 단일재고 방식이라 Location/Balance는 일단 제거
export type LocationItem = never;