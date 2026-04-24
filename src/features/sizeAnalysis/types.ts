export type StructureType = "single_row_person" | "repeated_slots" | "size_matrix" | "unknown";
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

export type HeaderRole = "club" | "name" | "gender" | "size" | "qty" | "item" | "note";

export type FieldMapping = {
  structureType: StructureType;
  headerRowIndex: number;
  fields: Partial<Record<HeaderRole, number>>;
  slotGroups?: Array<Partial<Record<HeaderRole, number>>>;
};

export type NormalizedRow = {
  jobId: string;
  sourceSheet: string;
  sourceRowIndex: number;
  sourceGroupIndex?: number;
  clubNameRaw?: string;
  memberNameRaw?: string;
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

