/**
 * 반바지 `3부-여`+숫자 size 번들 정규화 → buildOqmCategoryProfile → buildOqmQuickRequestLines
 * 세 단계 size 키(예: 3부-85) 일치 검증.
 * 사용: npx tsx scripts/verify-bundae-oqm-pipeline.mts
 */
import type { Product, ProductVariant } from "../src/app/products/types";
import { normalizeVariantToStockLines } from "../src/features/orderQuantityMatch/normalizeInventory";
import { buildOqmCategoryProfile, buildOqmQuickRequestLines } from "../src/features/orderQuantityMatch/oqmPipelineModel";

const product: Product = {
  id: "p-bundae-oqm-verify",
  sku: "BUNDAE-OQM-VERIFY",
  name: "검증용 반바지",
  category: "반바지",
};

const variant: ProductVariant = {
  id: "v1",
  productId: product.id,
  sku: product.sku,
  color: "3부-여",
  gender: "",
  size: "85",
  stock: 3,
};

const stockLines = normalizeVariantToStockLines(product, variant);
const line0 = stockLines[0]!;
const dims = line0.dimensions;
console.log("1) normalizeVariantToStockLines[0].dimensions", {
  category: dims.category,
  gender: dims.gender,
  size: dims.size,
});

const categoryProfile = buildOqmCategoryProfile("반바지", stockLines, {});
console.log("2) buildOqmCategoryProfile", {
  hasGenderSplitData: categoryProfile.hasGenderSplitData,
  hasUnisexData: categoryProfile.hasUnisexData,
  femaleSizes: categoryProfile.femaleSizes,
  maleSizes: categoryProfile.maleSizes,
});

const requestLines = buildOqmQuickRequestLines({
  createRow: (r) => ({ rowId: "row-verify", ...r }),
  quickCategory: "반바지",
  quickCategoryKind: "apparel",
  apparelSizeType: "genderSplit",
  categoryProfile,
  activeApparelSizes: [],
  apparelGarmentType: "bottom",
  apparelQtyByKey: { "여|3부-85": "2" },
  trainingSetQtyByKey: {},
  generalEntries: [],
});
console.log("3) buildOqmQuickRequestLines[0] (RequestLineInput)", {
  gender: requestLines[0]?.gender,
  size: requestLines[0]?.size,
  quantity: requestLines[0]?.quantity,
});

if (dims.gender !== "여") throw new Error(`[1] expected gender "여", got ${JSON.stringify(dims.gender)}`);
if (dims.size !== "3부-85") throw new Error(`[1] expected size "3부-85", got ${JSON.stringify(dims.size)}`);
if (!categoryProfile.hasGenderSplitData) throw new Error("[2] expected hasGenderSplitData true");
if (!categoryProfile.femaleSizes.includes("3부-85")) {
  throw new Error(`[2] expected femaleSizes to include "3부-85", got ${JSON.stringify(categoryProfile.femaleSizes)}`);
}
if (requestLines[0]?.gender !== "여" || requestLines[0]?.size !== "3부-85" || requestLines[0]?.quantity !== 2) {
  throw new Error(`[3] unexpected request line: ${JSON.stringify(requestLines[0])}`);
}

console.log("OK: 재고 정규화 → 입력판 프로필 → 주문 row size 키가 3부-85로 일치합니다.");
