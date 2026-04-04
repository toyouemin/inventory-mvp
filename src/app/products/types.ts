export type Product = {
  id: string;
  sku: string;
  category?: string | null;
  /** DB `name` (표시용, 자동 수정 없음) */
  name: string;
  imageUrl?: string | null;
  memo?: string | null;
  memo2?: string | null;
  stock?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  wholesalePrice?: number | null;
  msrpPrice?: number | null;
  salePrice?: number | null;
  extraPrice?: number | null;
};

/** 한 행의 실제 유니크는 DB에서 (sku, color, gender, size) */
export type ProductVariant = {
  id: string;
  productId: string;
  sku: string;
  color: string;
  gender: string;
  size: string;
  stock: number;
  wholesalePrice?: number | null;
  msrpPrice?: number | null;
  salePrice?: number | null;
  extraPrice?: number | null;
  memo?: string | null;
  memo2?: string | null;
  createdAt?: string | null;
};

/** 리스트 한 행: 상품 + 변형 */
export type ProductRow = Product & {
  variantId: string;
  color: string;
  /** gender+size 붙인 표시 문자열 */
  size: string;
  variantStock: number;
  variantWholesalePrice?: number | null;
  variantMsrpPrice?: number | null;
  variantSalePrice?: number | null;
  variantExtraPrice?: number | null;
};
