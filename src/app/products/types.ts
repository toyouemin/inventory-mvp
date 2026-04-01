export type Product = {
  id: string;
  sku: string;
  category?: string | null;
  nameSpec: string;
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

export type ProductVariant = {
  id: string;
  productId: string;
  size: string;
  stock: number;
  memo?: string | null;
  memo2?: string | null;
  createdAt?: string | null;
};

/** List row: one per (product, size) for table view */
export type ProductRow = Product & { variantId: string; size: string; variantStock: number };