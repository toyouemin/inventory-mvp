const CATEGORY_SELECT_SEARCH_MIN_PX = 96;

/** 선택 라벨 길이에 맞춰 래퍼 너비 확장(폰트 축소 없음). 행이 좁으면 검색창 최소 폭을 남기고 상한으로 맞춤. */
export function fitCategorySelectWidth(
  selectEl: HTMLSelectElement,
  displayedLabel: string,
  rowEl: HTMLElement | null
) {
  selectEl.style.fontSize = "";
  const wrap = selectEl.parentElement as HTMLElement | null;
  if (!wrap) return;

  const cs = getComputedStyle(selectEl);
  const family = cs.fontFamily || "sans-serif";
  const weight = cs.fontWeight || "600";
  const fontSizePx = parseFloat(cs.fontSize) || 13;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.font = `${weight} ${fontSizePx}px ${family}`;
  const textW = ctx.measureText(displayedLabel).width;
  const padApprox = 52;
  const desired = Math.ceil(textW + padApprox);
  const minW = 72;

  let maxW = desired;
  if (rowEl) {
    const btn = rowEl.querySelector("button");
    const btnW = btn instanceof HTMLElement ? btn.getBoundingClientRect().width : 64;
    const gapCount = Math.max(0, rowEl.children.length - 1);
    const gapPx = 8 * gapCount;
    const rowInner = rowEl.clientWidth;
    const cap = rowInner - CATEGORY_SELECT_SEARCH_MIN_PX - btnW - gapPx;
    maxW = Math.max(minW, Math.min(desired, cap));
  }

  const w = Math.max(minW, maxW);
  wrap.style.width = `${w}px`;
  wrap.style.flexShrink = "0";
  selectEl.style.width = "100%";
}
