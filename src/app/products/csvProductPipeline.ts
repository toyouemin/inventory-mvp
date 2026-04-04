/**
 * 상품 CSV: 컬럼값만 사용(상품명·색·성별·사이즈 추론 없음).
 * 헤더: SKU,카테고리,상품명,이미지url,color,gender,size,stock,wholesalePrice,msrpPrice,salePrice,extraPrice,memo,memo2
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

function detectDelimiter(line: string) {
  const comma = (line.match(/,/g) ?? []).length;
  const tab = (line.match(/\t/g) ?? []).length;
  const semi = (line.match(/;/g) ?? []).length;
  if (tab >= comma && tab >= semi) return "\t";
  if (semi >= comma && semi >= tab) return ";";
  return ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  const pushCell = () => {
    result.push(current.trim());
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

function assertHeaders(rawHeaders: string[]): ColMap {
  const cells = rawHeaders.map((h) => h.trim());
  if (cells.length !== REQUIRED_HEADERS.length) {
    throw new Error(
      `CSV 오류: 헤더는 ${REQUIRED_HEADERS.length}개 컬럼이어야 합니다.\n필요: ${REQUIRED_HEADERS.join(",")}\n현재 ${cells.length}개: ${cells.join(",")}`
    );
  }
  const map = {} as ColMap;
  for (let i = 0; i < REQUIRED_HEADERS.length; i++) {
    const expected = REQUIRED_HEADERS[i];
    const got = cells[i];
    if (got !== expected) {
      throw new Error(
        `CSV 오류: ${i + 1}번째 헤더가 "${expected}" 이어야 합니다. (현재: "${got}")\n전체 헤더: ${cells.join(",")}`
      );
    }
    map[expected] = i;
  }
  return map;
}

export function runProductCsvPipeline(text: string): { rows: ParsedCsvRow[]; skippedRows: number[] } {
  const rawLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLineIndex = rawLines.findIndex((l) => (l ?? "").trim().length > 0);
  if (headerLineIndex < 0) throw new Error("CSV 오류: 헤더 라인이 없습니다.");

  const delimiter = detectDelimiter(rawLines[headerLineIndex] ?? "");
  const headerCells = parseCsvLine(rawLines[headerLineIndex] ?? "", delimiter);
  const col = assertHeaders(headerCells);

  const rows: ParsedCsvRow[] = [];
  const skippedRows: number[] = [];
  let dataRowIndex = 0;

  for (let i = headerLineIndex + 1; i < rawLines.length; i++) {
    if (!rawLines[i] || rawLines[i].trim() === "") continue;
    const cells = parseCsvLine(rawLines[i], delimiter);

    const sku = (cells[col.SKU] ?? "").trim();
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

    const category = (cells[col.카테고리] ?? "").trim();
    const imageUrl = (cells[col.이미지url] ?? "").trim();
    const color = (cells[col.color] ?? "").trim();
    const gender = (cells[col.gender] ?? "").trim();
    const size = (cells[col.size] ?? "").trim();
    const stock = parseNumberCell(cells[col.stock], 0);
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
