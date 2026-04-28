export type StructureType =
  | "single_row_person"
  | "repeated_slots"
  | "size_matrix"
  | "multi_item_personal_order"
  | "unknown";
export type ParseStatus = "auto_confirmed" | "needs_review" | "unresolved" | "corrected" | "excluded";

export type SheetSnapshot = {
  name: string;
  rows: string[][];
  people?: PersonRecord[];
};

export type WorkbookSnapshot = {
  sheets: SheetSnapshot[];
};

export type PersonRecord = {
  club: string;
  name: string;
  gender: string;
  size: string;
};

export type DetectStructureRequest = {
  jobId: string;
  sheetName: string;
};

export type HeaderRole = "club" | "name" | "gender" | "size" | "size2" | "qty" | "item" | "note";

export type FieldMapping = {
  structureType: StructureType;
  headerRowIndex: number;
  fields: Partial<Record<HeaderRole, number>>;
  productColumns?: number[];
  slotGroups?: Array<Partial<Record<HeaderRole, number>>>;
};

export type NormalizedRow = {
  jobId: string;
  sourceSheet: string;
  sourceRowIndex: number;
  sourceGroupIndex?: number;
  clubNameRaw?: string;
  memberNameRaw?: string;
  /** 이름(people 등 `name` 전용) — `memberNameRaw`가 비었을 때 그룹 키·표시용 fallback */
  memberName?: string;
  genderRaw?: string;
  itemRaw?: string;
  sizeRaw?: string;
  qtyRaw?: string;
  clubNameNormalized?: string;
  genderNormalized?: string;
  standardizedSize?: string;
  qtyParsed?: number;
  parseStatus: ParseStatus;
  parseConfidence: number;
  parseReason?: string;
  userCorrected: boolean;
  excluded?: boolean;
  /** Prisma/중복: duplicate_gender_filter | duplicate_first_row_kept | duplicate_same_size */
  excludeReason?: string;
  /** 예: duplicate_same_size (first_row + 동일 사이즈 조합 시) */
  excludeDetail?: string;
  metaJson?: Record<string, unknown>;
};

export type ParsePiece = {
  gender?: "남" | "여" | "공용";
  size?: string;
  qty?: number;
  confidence: number;
  reason: string;
  status: ParseStatus;
};

