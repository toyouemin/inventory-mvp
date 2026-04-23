import { normalizeCategoryLabel } from "./categoryNormalize";
import { normalizeSkuForMatch } from "./skuNormalize";

/**
 * 상품 CSV: 컬럼값만 사용(상품명·성별·사이즈 추론 없음). color는 trim만 하고 파싱·정규화하지 않음(라벨 전용).
 * 헤더: SKU,카테고리,상품명,이미지url,color,gender,size,stock,wholesalePrice,msrpPrice,salePrice,extraPrice,memo,memo2
 *
 * --- 재고가 0으로만 저장되는 흔한 원인 (color/gender 공백 행) ---
 * 1) 데이터 행의 셀 개수가 헤더(14칸)와 다르면, color·gender를 비울 때 콤마를 덜 넣은 경우
 *    값들이 한 칸씩 당겨져 size·stock 인덱스가 어긋납니다. (stock 칸이 빈 문자열 → parse → 0)
 * 2) 본 파서는 헤더 이름으로 인덱스를 고정하므로 "빈 칸이 사라져 인덱스가 밀린다"는 현상은
 *    실제로는 **파싱 결과 cells[] 길이가 14가 아닐 때** 발생합니다.
 * 3) 엑셀 등에서 **끝쪽 빈 컬럼만** 잘려 나온 경우는 아래에서 뒤를 ""로 패딩해 완화합니다.
 *    가운데 빈 color/gender는 반드시 `,,` 또는 탭 구분에서 빈 칸을 맞춰야 합니다.
 * 4) **TSV(탭 구분)** 지원: 구분자는 **헤더 줄**에서 `\t` → `,` → `;` 순으로 시도해 14개 컬럼·헤더명이 일치하면 채택.
 *    (데이터 행에 쉼표가 많아도 탭 헤더면 탭으로 파싱)
 *
 * 디버그: .env.local 에 `DEBUG_CSV_SKU=T21AC01NP` (normalizeSkuForMatch 기준으로 비교)
 *        또는 `DEBUG_CSV_PRODUCT_PIPELINE=1` 이면 칸 수 불일치 행마다 원본 라인·cells 요약 로그.
 */

const REQUIRED_HEADERS = [
  "SKU",
  "카테고리",
  "상품명",
  "이미지url",
  "color",
  "gender",
  "size",
  "stock",
  "wholesalePrice",
  "msrpPrice",
  "salePrice",
  "extraPrice",
  "memo",
  "memo2",
] as const;

export type ParsedCsvRow = {
  sku: string;
  category: string;
  name: string;
  imageUrl: string;
  color: string;
  gender: string;
  size: string;
  stock: number;
  wholesale: number;
  msrp: number;
  sale: number;
  extra: number;
  memo: string | null;
  memo2: string | null;
  dataRowIndex: number;
};

type ColMap = Record<(typeof REQUIRED_HEADERS)[number], number>;

const EXPECTED_COL_COUNT = REQUIRED_HEADERS.length;

function envFlag(name: string) {
  return String(process.env[name] ?? "").trim() === "1";
}

function debugSkuMatches(sku: string) {
  const want = String(process.env.DEBUG_CSV_SKU ?? "").trim();
  return want.length > 0 && normalizeSkuForMatch(sku) === normalizeSkuForMatch(want);
}

function logPipelineMismatch(
  kind: string,
  ctx: {
    fileLine1: number;
    rawLine: string;
    cellCount: number;
    cells: string[];
    col?: ColMap;
  }
) {
  const { fileLine1, rawLine, cellCount, cells, col } = ctx;
  const base = {
    kind,
    fileLine1,
    cellCount,
    expected: EXPECTED_COL_COUNT,
    rawLinePreview: rawLine.length > 500 ? `${rawLine.slice(0, 500)}…` : rawLine,
    cells,
  };
  if (col) {
    console.warn("[csvProductPipeline]", JSON.stringify({ ...base, colIndices: { size: col.size, stock: col.stock }, sizeRaw: cells[col.size], stockRaw: cells[col.stock] }));
  } else {
    console.warn("[csvProductPipeline]", JSON.stringify(base));
  }
}

function logDebugSkuRow(
  fileLine1: number,
  rawLine: string,
  cells: string[],
  col: ColMap,
  phase: "after-normalize"
) {
  console.info(
    "[csvProductPipeline][DEBUG_CSV_SKU]",
    JSON.stringify({
      phase,
      fileLine1,
      cellCount: cells.length,
      rawLine: rawLine.length > 800 ? `${rawLine.slice(0, 800)}…` : rawLine,
      cells,
      colIndices: {
        color: col.color,
        gender: col.gender,
        size: col.size,
        stock: col.stock,
      },
      colorRaw: cells[col.color],
      genderRaw: cells[col.gender],
      sizeRaw: cells[col.size],
      stockRaw: cells[col.stock],
    })
  );
}

/** 셀 수를 헤더와 맞춤: 부족하면 뒤에 "" 패딩, 초과면 잘라냄(경고). */
function normalizeCellCount(
  cells: string[],
  fileLine1: number,
  rawLine: string,
  col: ColMap
): string[] {
  const n = cells.length;
  if (n === EXPECTED_COL_COUNT) return cells;

  if (n < EXPECTED_COL_COUNT) {
    if (envFlag("DEBUG_CSV_PRODUCT_PIPELINE")) {
      logPipelineMismatch("cells_short_will_pad_trailing", { fileLine1, rawLine, cellCount: n, cells, col });
    }
    const out = cells.slice();
    while (out.length < EXPECTED_COL_COUNT) out.push("");
    return out;
  }

  console.warn(
    `[csvProductPipeline] ${fileLine1}행: 컬럼 ${n}개(필요 ${EXPECTED_COL_COUNT}). 앞 ${EXPECTED_COL_COUNT}칸만 사용합니다(값에 콤마·탭·따옴표 확인).`
  );
  if (envFlag("DEBUG_CSV_PRODUCT_PIPELINE")) {
    logPipelineMismatch("cells_long_will_truncate", { fileLine1, rawLine, cellCount: n, cells, col });
  }
  return cells.slice(0, EXPECTED_COL_COUNT);
}

function detectDelimiter(line: string) {
  const comma = (line.match(/,/g) ?? []).length;
  const tab = (line.match(/\t/g) ?? []).length;
  const semi = (line.match(/;/g) ?? []).length;
  if (tab >= comma && tab >= semi) return "\t";
  if (semi >= comma && semi >= tab) return ";";
  return ",";
}

/** 셀 앞뒤 공백 제거 + UTF-8 BOM(U+FEFF) 등 제거(특히 첫 컬럼 SKU) */
function stripCellValue(s: string): string {
  return String(s ?? "")
    .replace(/^\uFEFF+/, "")
    .replace(/\uFEFF/g, "")
    .trim();
}

/**
 * 헤더 줄로 구분자 확정. 데이터 행에 쉼표가 많아도(숫자 포맷 등) TSV를 올바르게 쓰려면 탭 우선.
 */
function inferDelimiterFromHeaderLine(line: string): string {
  for (const delimiter of ["\t", ",", ";"] as const) {
    const cells = parseCsvLine(line, delimiter);
    if (cells.length !== EXPECTED_COL_COUNT) continue;
    let ok = true;
    for (let i = 0; i < EXPECTED_COL_COUNT; i++) {
      if (cells[i] !== REQUIRED_HEADERS[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return delimiter;
  }
  return detectDelimiter(line);
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  const pushCell = () => {
    result.push(stripCellValue(current));
    current = "";
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === delimiter && !inQuotes) {
      pushCell();
      continue;
    }
    current += c;
  }
  pushCell();
  return result;
}

function parseNumberCell(v: string | undefined, fallback = 0): number {
  const s = String(v ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .replace(/,/g, "")
    .trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * 헤더가 템플릿과 다르면 한글 안내(누락·추가·이름 불일치만). 일치하면 null.
 */
function describeHeaderValidationError(cells: string[]): string | null {
  const nReq = REQUIRED_HEADERS.length;
  const nGot = cells.length;

  const missingTrailing: string[] =
    nGot < nReq ? REQUIRED_HEADERS.slice(nGot).map((h) => String(h)) : [];

  const extraHeaders: string[] = [];
  if (nGot > nReq) {
    for (let i = nReq; i < nGot; i++) {
      const h = cells[i] ?? "";
      extraHeaders.push(h.trim() === "" ? `(빈 헤더, ${i + 1}번째)` : h);
    }
  }

  const wrongPosition: { pos: number; expected: string; got: string }[] = [];
  const overlap = Math.min(nGot, nReq);
  for (let i = 0; i < overlap; i++) {
    const expected = REQUIRED_HEADERS[i];
    const got = cells[i] ?? "";
    if (got !== expected) {
      wrongPosition.push({
        pos: i + 1,
        expected,
        got: got.trim() === "" ? "(비어 있음)" : got,
      });
    }
  }

  if (missingTrailing.length === 0 && extraHeaders.length === 0 && wrongPosition.length === 0) {
    return null;
  }

  const lines: string[] = [];
  if (nGot !== nReq) {
    lines.push(`필수 컬럼은 ${nReq}개인데 현재 ${nGot}개입니다.`);
  }
  if (missingTrailing.length > 0) {
    lines.push(`누락된 필수 컬럼: ${missingTrailing.join(", ")}`);
  }
  if (extraHeaders.length > 0) {
    lines.push(`추가된 불필요 컬럼: ${extraHeaders.join(", ")}`);
  }
  if (wrongPosition.length > 0) {
    lines.push(
      "헤더 이름이 템플릿과 다른 칸:",
      ...wrongPosition.map((w) => `- ${w.pos}번째: "${w.expected}" 이어야 하는데 "${w.got}" 입니다`)
    );
  }

  return `CSV 오류: 헤더가 템플릿과 다릅니다.\n${lines.join("\n")}`;
}

function assertHeaders(rawHeaders: string[]): ColMap {
  const cells = rawHeaders.map((h) => stripCellValue(h));
  const headerError = describeHeaderValidationError(cells);
  if (headerError) throw new Error(headerError);

  const map = {} as ColMap;
  for (let i = 0; i < REQUIRED_HEADERS.length; i++) {
    map[REQUIRED_HEADERS[i]] = i;
  }
  return map;
}

export function runProductCsvPipeline(text: string): { rows: ParsedCsvRow[]; skippedRows: number[] } {
  const rawLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLineIndex = rawLines.findIndex((l) => (l ?? "").trim().length > 0);
  if (headerLineIndex < 0) throw new Error("CSV 오류: 헤더 라인이 없습니다.");

  const headerLineRaw = rawLines[headerLineIndex] ?? "";
  const delimiter = inferDelimiterFromHeaderLine(headerLineRaw);
  const headerCells = parseCsvLine(headerLineRaw, delimiter);
  const col = assertHeaders(headerCells);

  const rows: ParsedCsvRow[] = [];
  const skippedRows: number[] = [];
  let dataRowIndex = 0;

  for (let i = headerLineIndex + 1; i < rawLines.length; i++) {
    if (!rawLines[i] || rawLines[i].trim() === "") continue;
    const rawLine = rawLines[i];
    const fileLine1 = i + 1;
    const parsed = parseCsvLine(rawLine, delimiter);
    const cells = normalizeCellCount(parsed, fileLine1, rawLine, col);

    const sku = normalizeSkuForMatch(cells[col.SKU] ?? "");
    if (!sku) {
      skippedRows.push(i + 1);
      continue;
    }

    const name = (cells[col.상품명] ?? "").trim();
    if (!name) {
      skippedRows.push(i + 1);
      continue;
    }

    dataRowIndex += 1;

    if (debugSkuMatches(sku)) {
      logDebugSkuRow(fileLine1, rawLine, cells, col, "after-normalize");
    }

    const category = normalizeCategoryLabel(cells[col.카테고리] ?? "");
    const imageUrl = (cells[col.이미지url] ?? "").trim();
    const color = (cells[col.color] ?? "").trim();
    const gender = (cells[col.gender] ?? "").trim();
    const size = (cells[col.size] ?? "").trim();
    const stockRaw = cells[col.stock];
    const stock = parseNumberCell(stockRaw, 0);
    const wholesale = parseNumberCell(cells[col.wholesalePrice], 0);
    const msrp = parseNumberCell(cells[col.msrpPrice], 0);
    const sale = parseNumberCell(cells[col.salePrice], 0);
    const extra = parseNumberCell(cells[col.extraPrice], 0);
    const memoRaw = (cells[col.memo] ?? "").trim();
    const memo2Raw = (cells[col.memo2] ?? "").trim();

    rows.push({
      sku,
      category,
      name,
      imageUrl,
      color,
      gender,
      size,
      stock,
      wholesale,
      msrp,
      sale,
      extra,
      memo: memoRaw ? memoRaw : null,
      memo2: memo2Raw ? memo2Raw : null,
      dataRowIndex,
    });
  }

  if (rows.length === 0) throw new Error("CSV 오류: 유효한 데이터 행이 없습니다. (SKU·상품명 필수)");

  return { rows, skippedRows };
}
