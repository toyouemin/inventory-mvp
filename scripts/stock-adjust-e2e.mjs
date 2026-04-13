/**
 * 재고 ± 디버그 플로우 E2E (Playwright)
 * 사전: `npm run dev` 후 BASE_URL(기본 http://127.0.0.1:3000)에서 /products 동작
 * 실행: node scripts/stock-adjust-e2e.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

function phaseFromLine(t) {
  const m = t.match(/\[stockAdjust\]\s+(\S+)/);
  return m ? m[1] : t.slice(0, 100);
}

function summarizeFlow(lines) {
  const order = [
    "list_row_click",
    "variant_click",
    "product_click",
    "variant_pendingDelta_after_click",
    "product_pendingDelta_after_click",
    "variant_flush_runner_start",
    "product_flush_runner_start",
    "variant_flush_batch_start",
    "product_flush_batch_start",
    "variant_adjustVariantStock_call",
    "product_adjustStock_call",
    "variant_adjustVariantStock_response",
    "product_adjustStock_response",
    "variant_apply_server_to_local",
    "product_apply_server_to_local",
    "server_props_sync_effect_run",
  ];
  const phases = lines.map(phaseFromLine);
  const picked = [];
  for (const p of phases) {
    if (order.includes(p) || p.includes("flush") || p.includes("click")) {
      picked.push(p);
    }
  }
  return picked.length ? picked.join(" → ") : phases.join(" → ");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const lines = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[stockAdjust]")) lines.push(t);
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  console.log("[e2e] goto", `${BASE}/products?debugStockAdjust=1`);
  await page.goto(`${BASE}/products?debugStockAdjust=1`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  await page.getByRole("button", { name: "PC" }).click({ timeout: 30000 });
  await page.waitForTimeout(600);

  const dataRows = page.locator("tbody tr:not(.products-table__tr-novis)");
  const n = await dataRows.count();
  if (n < 2) {
    console.error("[e2e] 스킵: 데이터 행이 2개 미만 (got", n, ") — Supabase/상품 데이터 확인");
    await browser.close();
    process.exit(2);
  }

  const plus = (i) =>
    dataRows.nth(i).locator(".stock-buttons").getByRole("button", { name: "+1", exact: true });

  function sliceSince(start) {
    return lines.slice(start);
  }

  // CASE 1: A +1 직후 B +1 (동시에 in-flight)
  let mark = lines.length;
  console.log("[e2e] CASE1: row0 +1 then row1 +1 (rapid)");
  await plus(0).click();
  await plus(1).click();
  await page.waitForTimeout(5500);
  console.log("\n======== CASE1 (A 저장 중 B 클릭 유사) ========");
  console.log(summarizeFlow(sliceSince(mark)));
  console.log("— raw (첫 25줄) —");
  sliceSince(mark)
    .slice(0, 25)
    .forEach((t) => console.log(phaseFromLine(t)));

  // CASE 2: 같은 행 연속 +1
  mark = lines.length;
  console.log("\n[e2e] CASE2: row0 +1 +1");
  await plus(0).click();
  await plus(0).click();
  await page.waitForTimeout(5500);
  console.log("\n======== CASE2 (동일 항목 연속 클릭) ========");
  console.log(summarizeFlow(sliceSince(mark)));
  console.log("— raw (첫 25줄) —");
  sliceSince(mark)
    .slice(0, 25)
    .forEach((t) => console.log(phaseFromLine(t)));

  // CASE 3: A-B-A 빠르게
  mark = lines.length;
  console.log("\n[e2e] CASE3: row0 +1, row1 +1, row0 +1");
  await plus(0).click();
  await plus(1).click();
  await plus(0).click();
  await page.waitForTimeout(6500);
  console.log("\n======== CASE3 (A·B 번갈아) ========");
  console.log(summarizeFlow(sliceSince(mark)));
  console.log("— raw (첫 35줄) —");
  sliceSince(mark)
    .slice(0, 35)
    .forEach((t) => console.log(phaseFromLine(t)));

  const anySync = sliceSince(0).some((t) => t.includes("server_props_sync_effect_run"));
  console.log("\n[e2e] 전체 세션 중 server_props_sync_effect_run 출현:", anySync);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
