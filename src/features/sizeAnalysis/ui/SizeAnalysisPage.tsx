"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { buildColumnSizesForClub } from "@/features/sizeAnalysis/clubAggMatrixColumns";
import type { StructureType } from "@/features/sizeAnalysis/types";
import {
  analyzeDuplicateRows,
  buildAggRowsDedupedFirst,
  buildAggRowsDuplicate,
  buildAggRowsTotal,
  CLUB_AGG_MODE_LABEL,
  compareRowsBySourceThenIndex,
  computeClubDisplaySummaryStats,
  matrixGenderRowKeys,
  matrixAggGenderAndSizeFromRow,
  normClubFromNormRow,
  rowKeyGenderForAgg,
  stableRowKeyForDup,
  unionClubsOrdered,
  type ClubDisplaySummaryStats,
  type ClubSizeAggMode,
  type DuplicateAnalysis,
} from "@/features/sizeAnalysis/clubSizeAggModes";
import {
  labelSizeAnalysisParseStatusForRow,
  labelSizeAnalysisReasonForRow,
} from "@/features/sizeAnalysis/excludeReasonLabels";
import { downloadSizeAnalysisResultXlsx } from "@/features/sizeAnalysis/exportSizeAnalysisXlsx";
import {
  excelColumnLetterFromOneBased,
  findDuplicateColumnIndices,
  maxColumnCountInPreview,
  mergeAutoFieldMap,
  suggestFieldIndicesFromHeaderRow,
} from "@/features/sizeAnalysis/fieldMappingUi";

type Mapping = {
  structureType: "single_row_person" | "repeated_slots" | "size_matrix" | "unknown";
  headerRowIndex: number;
  fields: Record<string, number | undefined>;
  slotGroups?: Array<Record<string, number | undefined>>;
};

/** 화면 표시 전용(내부 API/DB 값은 영문 유지) */
const STRUCTURE_TYPE_LABEL: Record<Mapping["structureType"], string> = {
  single_row_person: "사람별 1행",
  repeated_slots: "반복 슬롯형",
  size_matrix: "사이즈표형",
  unknown: "직접 매핑",
};

const FIELD_ROLE_LABEL: Record<string, string> = {
  club: "클럽",
  name: "이름",
  gender: "성별",
  size: "사이즈",
  qty: "수량",
  item: "주문내용",
  note: "비고",
};

const STATUS_FILTER_OPTIONS = ["all", "auto_confirmed", "needs_review", "unresolved", "corrected", "excluded"] as const;

const STATUS_FILTER_LABEL: Record<(typeof STATUS_FILTER_OPTIONS)[number], string> = {
  all: "전체",
  auto_confirmed: "자동확정",
  needs_review: "검토필요",
  unresolved: "미분류",
  corrected: "수정완료",
  /** API 값은 `excluded` — 테이블은 중복자만 표시 */
  excluded: "제외(중복)",
};

const PARSE_STATUS_LABEL: Record<string, string> = {
  auto_confirmed: "자동확정",
  needs_review: "검토필요",
  unresolved: "미분류",
  corrected: "수정완료",
  excluded: "제외(중복)",
};

function labelParseStatus(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  return PARSE_STATUS_LABEL[v] ?? v;
}


function labelStructureType(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  return STRUCTURE_TYPE_LABEL[v as Mapping["structureType"]] ?? v;
}

function StepCheckIcon() {
  return (
    <svg className="size-analysis-wizard-step__check" width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8.5L6.5 12L13 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SizeAnalysisWizardStep({
  no,
  title,
  complete,
  active,
  locked,
  className,
  children,
}: {
  no: 1 | 2 | 3 | 4;
  title: string;
  complete: boolean;
  active: boolean;
  /** 이전 단계가 끝나지 않아 아직 진행할 수 없음 */
  locked?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={[
        "size-analysis-card",
        "size-analysis-wizard-step",
        complete && "size-analysis-wizard-step--complete",
        active && "size-analysis-wizard-step--active",
        locked && "size-analysis-wizard-step--locked",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="size-analysis-wizard-step__head">
        <div
          className="size-analysis-wizard-step__index"
          aria-hidden
          data-complete={complete ? "1" : undefined}
        >
          {complete ? <StepCheckIcon /> : <span className="size-analysis-wizard-step__num">{no}</span>}
        </div>
        <h3 className="size-analysis-wizard-step__title">{title}</h3>
      </div>
      <div className="size-analysis-wizard-step__body">{children}</div>
    </section>
  );
}

function logExcludedRows(rows: any[], statusFilter: string): void {
  const excludedRows = rows.filter(
    (r) => Boolean(r?.excluded) || String(r?.parseStatus ?? "").trim() === "excluded"
  );
  if (excludedRows.length === 0) return;

  const rowsForConsole = excludedRows.map((r) => ({
    sourceRowIndex: r?.sourceRowIndex ?? "",
    sourceGroupIndex: r?.sourceGroupIndex ?? "",
    parseStatus: r?.parseStatus ?? "",
    excluded: Boolean(r?.excluded),
    club: String(r?.clubNameRaw ?? r?.clubNameNormalized ?? "").trim(),
    name: String(r?.memberNameRaw ?? "").trim(),
    gender: String(r?.genderRaw ?? r?.genderNormalized ?? "").trim(),
    size: String(r?.sizeRaw ?? r?.standardizedSize ?? "").trim(),
    qty: r?.qtyRaw ?? r?.qtyParsed ?? "",
    excludedReason: labelSizeAnalysisReasonForRow(r) || "—",
  }));

  // 제외 조건 점검을 위한 디버깅 출력
  console.groupCollapsed(
    `[size-analysis] excluded rows (${excludedRows.length}) · filter=${statusFilter}`
  );
  console.table(rowsForConsole);
  console.groupEnd();
}

function rowQtyParsed(r: any): number {
  const q = r.qtyParsed;
  return Number.isFinite(Number(q)) ? Number(q) : 0;
}

function isRowExcludedByEmptyQuantity(r: any): boolean {
  const parseReason = String(r?.parseReason ?? "").trim();
  if (parseReason.includes("0/빈 수량 제외")) return true;
  const qtyRaw = r?.qtyRaw;
  const qtyParsed = r?.qtyParsed;
  const rawText = String(qtyRaw ?? "").trim();
  const parsedNum = Number(qtyParsed);
  if (rawText === "" || rawText === "0") return true;
  if (Number.isFinite(parsedNum) && parsedNum <= 0) return true;
  return false;
}

export function SizeAnalysisPage() {
  const [jobId, setJobId] = useState<string>("");
  const [sheets, setSheets] = useState<Array<{ name: string; rowCount: number }>>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [detectResult, setDetectResult] = useState<any>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [allRows, setAllRows] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [mappingSaved, setMappingSaved] = useState(false);
  const [detailViewMode, setDetailViewMode] = useState<"all" | "club" | "duplicates" | "clubMembers">("all");
  const autoDetectedKeyRef = useRef<string>("");

  const structureTypeForDup: StructureType | undefined =
    mapping?.structureType ??
    (allRows[0]?.metaJson?.structureType as StructureType | undefined);
  const duplicateAnalysis = useMemo(
    () => analyzeDuplicateRows(allRows, structureTypeForDup),
    [allRows, structureTypeForDup]
  );

  const clubGroupedRows = useMemo(() => {
    const byClub = new Map<string, { club: string; totalQty: number; rows: Array<{ gender: string; size: string; qty: number; hasReview: boolean; hasUnresolved: boolean }> }>();
    const detailMap = new Map<string, { club: string; gender: string; size: string; qty: number; hasReview: boolean; hasUnresolved: boolean }>();

    for (const r of allRows) {
      const club = normClubFromNormRow(r);
      const { gender, size } = matrixAggGenderAndSizeFromRow(r);
      const qtyRaw = r.qtyParsed ?? r.qtyRaw ?? 0;
      const qty = Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 0;
      const parseStatus = String(r.parseStatus ?? "");

      const clubEntry = byClub.get(club) ?? { club, totalQty: 0, rows: [] };
      clubEntry.totalQty += qty;
      byClub.set(club, clubEntry);

      const key = `${club}\0${gender}\0${size}`;
      const cur =
        detailMap.get(key) ??
        { club, gender, size, qty: 0, hasReview: false, hasUnresolved: false };
      cur.qty += qty;
      if (parseStatus === "needs_review") cur.hasReview = true;
      if (parseStatus === "unresolved") cur.hasUnresolved = true;
      detailMap.set(key, cur);
    }

    for (const d of detailMap.values()) {
      const clubEntry = byClub.get(d.club);
      if (!clubEntry) continue;
      clubEntry.rows.push(d);
    }

    return Array.from(byClub.values())
      .map((club) => {
        const displaySummary = computeClubDisplaySummaryStats(allRows, club.club);
        return {
          ...club,
          displaySummary,
          rows: club.rows.sort(
            (a, b) => compareGenderForClubSize(a.gender, b.gender) || compareSizeLabel(a.size, b.size)
          ),
        };
      })
      .sort((a, b) => a.club.localeCompare(b.club, "ko"));
  }, [allRows]);

  const clubViewDataKey = useMemo(
    () =>
      clubGroupedRows
        .map(
          (c) =>
            `${c.club}:${c.totalQty}:${c.rows.length}:${c.displaySummary.totalPersons}:${c.displaySummary.sizedQtySum}:${c.displaySummary.missingSizePersons}`
        )
        .join("|"),
    [clubGroupedRows]
  );

  async function uploadFile(file: File) {
    setError("");
    setMappingSaved(false);
    setLoading("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/size-analysis/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "업로드 실패");
      setJobId(json.jobId);
      setSheets(json.sheets ?? []);
      const first = json.sheets?.[0]?.name ?? "";
      setSelectedSheet(first);
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setLoading("");
    }
  }

  async function detectStructureAction() {
    if (!jobId || !selectedSheet) return;
    setLoading("detect");
    setError("");
    setMappingSaved(false);
    try {
      const res = await fetch("/api/size-analysis/detect-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, sheetName: selectedSheet }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "구조 분석 실패");
      setDetectResult(json);
      const base = json.mapping as Mapping;
      const headerRow: string[] | undefined = json.previewRows?.[base.headerRowIndex];
      const auto = suggestFieldIndicesFromHeaderRow(headerRow);
      setMapping({ ...base, fields: mergeAutoFieldMap(base.fields ?? {}, auto) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "구조 분석 실패");
    } finally {
      setLoading("");
    }
  }

  async function saveMappingAction() {
    if (!jobId || !selectedSheet || !mapping) return;
    setLoading("mapping");
    setError("");
    try {
      const res = await fetch("/api/size-analysis/save-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, sheetName: selectedSheet, mapping }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "매핑 저장 실패");
      setMappingSaved(true);
    } catch (e) {
      setMappingSaved(false);
      setError(e instanceof Error ? e.message : "매핑 저장 실패");
    } finally {
      setLoading("");
    }
  }

  async function runAction() {
    if (!jobId) return;
    setLoading("run");
    setError("");
    try {
      const runRes = await fetch("/api/size-analysis/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const runJson = await runRes.json();
      if (!runRes.ok) throw new Error(runJson.error ?? "실행 실패");
      await refreshResult(jobId, statusFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실행 실패");
    } finally {
      setLoading("");
    }
  }

  async function refreshResult(id: string, status: string) {
    const summaryRes = await fetch(`/api/size-analysis/${id}/summary`, { cache: "no-store" });
    const summaryJson = await summaryRes.json();
    if (!summaryRes.ok) throw new Error(summaryJson.error ?? "요약 조회 실패");
    setSummary(summaryJson);

    const allRowsRes = await fetch(`/api/size-analysis/${id}/rows`, { cache: "no-store" });
    const allRowsJson = await allRowsRes.json();
    if (!allRowsRes.ok) throw new Error(allRowsJson.error ?? "전체 행 조회 실패");
    const nextAllRows = allRowsJson.rows ?? [];
    setAllRows(nextAllRows);

    const rowsUrl =
      status === "all"
        ? `/api/size-analysis/${id}/rows?excludeExcluded=1`
        : status === "excluded"
          ? `/api/size-analysis/${id}/rows?status=excluded&excludedScope=duplicates`
          : `/api/size-analysis/${id}/rows?status=${encodeURIComponent(status)}`;
    const rowsRes = await fetch(rowsUrl, { cache: "no-store" });
    const rowsJson = await rowsRes.json();
    if (!rowsRes.ok) throw new Error(rowsJson.error ?? "행 조회 실패");
    const nextRows = rowsJson.rows ?? [];
    logExcludedRows(nextRows, status);
    setRows(nextRows);
  }

  async function onStatusChange(next: string) {
    setStatusFilter(next);
    if (jobId) await refreshResult(jobId, next);
  }

  useEffect(() => {
    if (!jobId || !selectedSheet) return;
    const key = `${jobId}\0${selectedSheet}`;
    if (autoDetectedKeyRef.current === key) return;
    if (loading === "detect") return;
    autoDetectedKeyRef.current = key;
    void detectStructureAction();
  }, [jobId, selectedSheet]);

  const step1Complete = Boolean(jobId);
  const step2Complete = Boolean(selectedSheet);
  const step3Complete = Boolean(detectResult);
  const step4Complete = mappingSaved;
  const canUseSheet = step1Complete;
  const canUseStructure = step1Complete && step2Complete;
  const canUseMapping = step1Complete && step2Complete && step3Complete && Boolean(mapping);
  const activeStepIndex =
    !step1Complete ? 0
    : !step2Complete ? 1
    : !step3Complete ? 2
    : !step4Complete ? 3
    : -1;
  const allSetupStepsComplete = step1Complete && step2Complete && step3Complete && step4Complete;

  return (
    <main className="size-analysis-page">
      <div className="size-analysis-page__title-row">
        <h2>사이즈 분석</h2>
        <span className="size-analysis-muted size-analysis-page__title-tag">각 클럽별 사이즈 분류 및 분석 추출기</span>
      </div>

      <div className="size-analysis-pc-grid">
        <div className="size-analysis-wizard" aria-label="사이즈 분석 단계">
          <SizeAnalysisWizardStep
            no={1}
            title="업로드"
            complete={step1Complete}
            active={activeStepIndex === 0}
            className="size-analysis-card--upload"
          >
            <SizeAnalysisUploadCard onUpload={uploadFile} loading={loading === "upload"} />
          </SizeAnalysisWizardStep>

          <SizeAnalysisWizardStep
            no={2}
            title="시트 선택"
            complete={step2Complete}
            active={activeStepIndex === 1}
            locked={!step1Complete}
            className="size-analysis-card--sheet-select"
          >
            <WorkbookSheetSelector
              sheets={sheets}
              selectedSheet={selectedSheet}
              onSelect={setSelectedSheet}
              disabled={!canUseSheet}
            />
          </SizeAnalysisWizardStep>

          <SizeAnalysisWizardStep
            no={3}
            title="구조 분석"
            complete={step3Complete}
            active={activeStepIndex === 2}
            locked={!step1Complete || !step2Complete}
            className="size-analysis-card--detect"
          >
            <StructureDetectionPanel
              detectResult={detectResult}
              loading={loading === "detect"}
              onDetect={detectStructureAction}
              disabled={!canUseStructure}
            />
          </SizeAnalysisWizardStep>

          <SizeAnalysisWizardStep
            no={4}
            title="필드 매핑"
            complete={step4Complete}
            active={activeStepIndex === 3}
            locked={!step1Complete || !step2Complete || !step3Complete}
            className="size-analysis-field-mapping"
          >
            {canUseMapping && mapping ? (
              <FieldMappingEditor
                mapping={mapping}
                onChange={(next) => {
                  setMapping(next);
                  setMappingSaved(false);
                }}
                onSave={saveMappingAction}
                loading={loading === "mapping"}
                saved={mappingSaved}
                previewRows={detectResult?.previewRows as string[][] | undefined}
              />
            ) : (
              <p className="size-analysis-muted size-analysis-wizard-step__placeholder" role="status">
                이전 단계(시트 선택·구조 분석)를 완료한 뒤 열·매핑을 지정할 수 있습니다.
              </p>
            )}
          </SizeAnalysisWizardStep>
        </div>

        <section
          className={[
            "size-analysis-card",
            "size-analysis-run-card",
            allSetupStepsComplete && "size-analysis-run-card--ready",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <button
            className="btn btn-primary"
            type="button"
            onClick={runAction}
            disabled={!allSetupStepsComplete || loading !== ""}
            title={
              allSetupStepsComplete
                ? undefined
                : "업로드·시트·구조 분석·매핑확정을 모두 완료한 뒤 실행할 수 있습니다."
            }
          >
            {loading === "run" ? "분석 실행 중..." : "분석 실행"}
          </button>
        </section>

        <div className="size-analysis-grid-item size-analysis-grid-item--summary">
          <AnalysisSummaryCards
            summary={summary}
            duplicateAnalysis={duplicateAnalysis}
            allRows={allRows}
            statusFilter={statusFilter}
          />
        </div>

        <div className="size-analysis-grid-item size-analysis-grid-item--filter">
          <AnalysisStatusFilter value={statusFilter} onChange={onStatusChange} />
        </div>

        <section className="size-analysis-card size-analysis-xlsx-export">
          <h3>엑셀 내보내기</h3>
          <p className="size-analysis-muted size-analysis-xlsx-export__hint">
            전체 목록과 단일 중복 집계를 기준으로, 시트(전체목록·클럽별집계·중복자·검토필요) 4개를 저장합니다.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={allRows.length === 0}
            onClick={() => downloadSizeAnalysisResultXlsx(allRows, duplicateAnalysis)}
          >
            엑셀 다운로드 (.xlsx)
          </button>
        </section>

        <div className="size-analysis-result-region">
          <DetailViewSwitch mode={detailViewMode} onChange={setDetailViewMode} />
          {detailViewMode === "all" ? (
            <>
              <AnalysisRowsTable rows={rows} duplicateRowIds={duplicateAnalysis.duplicateRowIds} />
              <ClubSizeSummaryTable duplicateRowIds={duplicateAnalysis.duplicateRowIds} normRows={allRows} />
            </>
          ) : detailViewMode === "club" ? (
            <ClubGroupedView
              key={clubViewDataKey}
              dupByClub={duplicateAnalysis.dupByClub}
              duplicateRowIds={duplicateAnalysis.duplicateRowIds}
              normRows={allRows}
              rows={clubGroupedRows}
            />
          ) : detailViewMode === "duplicates" ? (
            <DuplicateMembersView allRows={allRows} duplicateRowIds={duplicateAnalysis.duplicateRowIds} />
          ) : (
            <ClubMembersView allRows={allRows} />
          )}
        </div>
      </div>

      {error ? <p className="size-analysis-error">{error}</p> : null}
    </main>
  );
}

export function SizeAnalysisUploadCard({ onUpload, loading: isUploading }: { onUpload: (file: File) => void; loading: boolean }) {
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  return (
    <div className="size-analysis-upload-card__inner">
      <p className="size-analysis-muted size-analysis-upload-card__hint">클럽별 이름은 통일 후 업로드</p>
      <label className="size-analysis-upload-card__file-label" aria-busy={isUploading}>
        <input
          type="file"
          className="size-analysis-upload-card__file-input"
          accept=".xlsx,.csv"
          disabled={isUploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setSelectedFileName(file.name);
              onUpload(file);
            }
          }}
        />
        <span className="size-analysis-upload-card__file-text" aria-live="polite">
          {isUploading ? "업로드 중..." : selectedFileName ?? "파일을 선택"}
        </span>
      </label>
    </div>
  );
}

export function WorkbookSheetSelector({
  sheets,
  selectedSheet,
  onSelect,
  disabled,
}: {
  sheets: Array<{ name: string; rowCount: number }>;
  selectedSheet: string;
  onSelect: (name: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="size-analysis-sheet-select"
      value={selectedSheet}
      onChange={(e) => onSelect(e.target.value)}
      disabled={disabled}
      aria-disabled={disabled ? true : undefined}
    >
      <option value="">시트 선택</option>
      {sheets.map((s) => (
        <option key={s.name} value={s.name}>
          {s.name} ({s.rowCount}행)
        </option>
      ))}
    </select>
  );
}

export function StructureDetectionPanel({
  detectResult,
  loading,
  onDetect,
  disabled,
}: {
  detectResult: any;
  loading: boolean;
  onDetect: () => void;
  disabled?: boolean;
}) {
  const off = Boolean(disabled) || loading;
  return (
    <div className="size-analysis-detect-panel">
      <button className="btn btn-secondary" type="button" onClick={onDetect} disabled={off}>
        {loading ? "분석 중..." : "구조 다시 분석"}
      </button>
      {detectResult ? (
        <div className="size-analysis-detect-outcome" role="region" aria-label="구조 분석 추천 결과">
          <p className="size-analysis-detect-outcome__line">
            추천 헤더 행(1번째=첫 행): <strong>{Number(detectResult.headerRowIndex) + 1}</strong>번째
          </p>
          <p className="size-analysis-detect-outcome__line">추천 구조 유형: {labelStructureType(detectResult.structureType)}</p>
        </div>
      ) : null}
    </div>
  );
}

const UNKNOWN_REQUIRED_BASE = ["name", "club"] as const;

export function FieldMappingEditor({
  mapping,
  onChange,
  onSave,
  loading,
  saved,
  previewRows,
  disabled = false,
}: {
  mapping: Mapping | null;
  onChange: (mapping: Mapping) => void;
  onSave: () => void;
  loading: boolean;
  saved: boolean;
  previewRows?: string[][];
  disabled?: boolean;
}) {
  const maxCols = useMemo(
    () => (previewRows?.length ? maxColumnCountInPreview(previewRows, mapping?.headerRowIndex ?? 0) : 0),
    [previewRows, mapping?.headerRowIndex]
  );
  const headerCells = useMemo(
    () => (previewRows?.[mapping?.headerRowIndex ?? 0] as string[] | undefined) ?? [],
    [previewRows, mapping?.headerRowIndex]
  );
  const duplicateCols = useMemo(
    () => (mapping ? findDuplicateColumnIndices(mapping.fields ?? {}) : []),
    [mapping]
  );
  if (!mapping) return null;
  const m = mapping;
  const roles = ["club", "name", "gender", "size", "qty", "item", "note"] as const;
  const hasPreview = maxCols > 0;
  const previewLen = previewRows?.length ?? 0;
  const headerOutOfPreview = m.headerRowIndex >= previewLen;
  const hasSizeQtyColumns = m.fields.size !== undefined && m.fields.qty !== undefined;
  const unknownRequired = [
    ...UNKNOWN_REQUIRED_BASE,
    ...(hasSizeQtyColumns ? [] : (["item"] as const)),
  ];
  const requiredUnknownSet = new Set<string>(unknownRequired);

  function columnLabelForIndex(zeroIdx: number): string {
    const h = String(headerCells[zeroIdx] ?? "").trim() || "제목 없음";
    const u = zeroIdx + 1;
    const L = excelColumnLetterFromOneBased(u);
    return `${h} (${L}열 = ${u})`;
  }

  function applyHeaderAuto() {
    const next = mergeAutoFieldMap(m.fields, suggestFieldIndicesFromHeaderRow(headerCells));
    onChange({ ...m, fields: next });
  }

  const unknownUnmapped = unknownRequired.filter((k) => m.fields[k] === undefined);
  const unknownNeedsFix = m.structureType === "unknown" && unknownUnmapped.length > 0;
  const formOff = disabled || loading;

  return (
    <div className="size-analysis-field-mapping-inner">
      <p className="size-analysis-map-hint size-analysis-muted">
        열 번호는 <strong>1</strong>부터입니다 (A열=1, B열=2, C열=3). · 헤더 행을 맞춘 뒤 열을 선택하세요.
      </p>
      <div className="size-analysis-grid size-analysis-grid--map-tools">
        <label>
          구조 유형
          <select
            className="size-analysis-field-select"
            value={m.structureType}
            disabled={formOff}
            onChange={(e) => onChange({ ...m, structureType: e.target.value as Mapping["structureType"] })}
          >
            <option value="single_row_person">{STRUCTURE_TYPE_LABEL.single_row_person}</option>
            <option value="repeated_slots">{STRUCTURE_TYPE_LABEL.repeated_slots}</option>
            <option value="size_matrix">{STRUCTURE_TYPE_LABEL.size_matrix}</option>
            <option value="unknown">{STRUCTURE_TYPE_LABEL.unknown}</option>
          </select>
        </label>
        <label>
          헤더 행 (1=첫 행)
          <input
            type="number"
            className="size-analysis-field-input"
            min={1}
            max={49_999}
            value={m.headerRowIndex + 1}
            disabled={formOff}
            onChange={(e) => {
              const n = Math.max(1, parseInt(e.target.value, 10) || 1);
              onChange({ ...m, headerRowIndex: n - 1 });
            }}
          />
        </label>
      </div>
      {headerOutOfPreview && previewLen > 0 ? (
        <p className="size-analysis-field-note size-analysis-muted" role="note">
          헤더 행이 미리보기({previewLen}행) 밖이면, 열 제목은 비어 보일 수 있으나 1=첫 열 매핑은 그대로 적용됩니다.
        </p>
      ) : null}
      {hasPreview ? (
        <div className="size-analysis-map-row">
          <button
            type="button"
            className="btn btn-secondary size-analysis-btn-auto"
            onClick={applyHeaderAuto}
            disabled={formOff}
          >
            헤더 이름으로 자동 채우기
          </button>
        </div>
      ) : null}
      {unknownNeedsFix ? (
        <p className="size-analysis-field-warning" role="alert">
          <strong>직접 매핑</strong>에서는 <strong>이름·클럽</strong>을 지정해 주세요.
          {!hasSizeQtyColumns ? " 주문내용은 사이즈/수량 열이 없을 때만 필요합니다." : ""} · 미지정:{" "}
          {unknownUnmapped.map((k) => FIELD_ROLE_LABEL[k] ?? k).join(", ")}
        </p>
      ) : null}
      {duplicateCols.length > 0 ? (
        <p className="size-analysis-field-warning" role="alert">
          같은 열이 여러 필드에 지정됨(검토): 열 {duplicateCols.map((c) => c + 1).join(", ")}
        </p>
      ) : null}
      <div className="size-analysis-map-fields">
        {roles.map((role) => {
          const idx0 = m.fields[role];
          const dup = idx0 !== undefined && duplicateCols.includes(idx0);
          const reqUnknown = m.structureType === "unknown" && requiredUnknownSet.has(role) && idx0 === undefined;
          const unmapped = idx0 === undefined;
          return (
            <div
              key={role}
              className={[
                "size-analysis-field-row",
                `size-analysis-field-row--role-${role}`,
                unmapped && "size-analysis-field-row--unmapped",
                reqUnknown && "size-analysis-field-row--required",
                dup && "size-analysis-field-row--dup",
                idx0 !== undefined && "size-analysis-field-row--filled",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="size-analysis-field-row__label">{FIELD_ROLE_LABEL[role] ?? role}</span>
              {hasPreview ? (
                <select
                  className={["size-analysis-field-select", idx0 !== undefined && "size-analysis-field-select--has-value"]
                    .filter(Boolean)
                    .join(" ")}
                  value={idx0 === undefined ? "" : String(idx0)}
                  disabled={formOff}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange({
                      ...m,
                      fields: { ...m.fields, [role]: v === "" ? undefined : parseInt(v, 10) },
                    });
                  }}
                >
                  <option value="">— 열 선택 —</option>
                  {Array.from({ length: maxCols }, (_, i) => (
                    <option key={i} value={i}>
                      {columnLabelForIndex(i)}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="size-analysis-fallback-cols">
                  <input
                    type="number"
                    className="size-analysis-field-input"
                    min={1}
                    placeholder="열 번호 (1=첫 열)"
                    value={idx0 === undefined ? "" : idx0 + 1}
                    disabled={formOff}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onChange({
                        ...m,
                        fields: {
                          ...m.fields,
                          [role]: raw === "" ? undefined : Math.max(0, (parseInt(raw, 10) || 1) - 1),
                        },
                      });
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {hasPreview ? (
        <p className="size-analysis-muted size-analysis-map-hint-2">열 순서만 선택해 맞추면 됩니다.</p>
      ) : (
        <p className="size-analysis-muted size-analysis-map-hint-2">구조 분석을 완료한 뒤 열을 선택하세요.</p>
      )}
      <div className="size-analysis-map-actions">
        <button
          className={`btn ${saved ? "size-analysis-map-save-btn--done" : "btn-secondary"}`}
          onClick={onSave}
          disabled={formOff || saved}
          type="button"
        >
          {loading ? "저장중..." : saved ? "매핑 완료" : "매핑확정"}
        </button>
      </div>
    </div>
  );
}

export function DetailViewSwitch({
  mode,
  onChange,
}: {
  mode: "all" | "club" | "duplicates" | "clubMembers";
  onChange: (mode: "all" | "club" | "duplicates" | "clubMembers") => void;
}) {
  return (
    <section className="size-analysis-card size-analysis-view-switch-card">
      <h3 className="size-analysis-view-switch__heading">보기 전환</h3>
      <div className="size-analysis-view-switch size-analysis-view-switch--segmented" role="group" aria-label="결과 보기 전환">
        <button
          type="button"
          className={`btn ${mode === "all" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => onChange("all")}
        >
          전체 보기
        </button>
        <button
          type="button"
          className={`btn ${mode === "club" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => onChange("club")}
        >
          클럽별 보기
        </button>
        <button
          type="button"
          className={`btn ${mode === "duplicates" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => onChange("duplicates")}
        >
          중복자 보기
        </button>
        <button
          type="button"
          className={`btn ${mode === "clubMembers" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => onChange("clubMembers")}
        >
          클럽별 명단
        </button>
      </div>
    </section>
  );
}

function lineGenderSizeQtyRow(r: any, lineIdx: number): string {
  const g = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
  const size = String(r.standardizedSize ?? r.sizeRaw ?? "미분류").trim() || "미분류";
  const qty = rowQtyParsed(r);
  const gPart = g === "공용" ? `공용 ${size}` : g ? `${g} ${size}` : size;
  const hasSrc = r.sourceRowIndex != null && String(r.sourceRowIndex).trim() !== "";
  const rowN = hasSrc ? String(r.sourceRowIndex).trim() : String(lineIdx + 1);
  return `${gPart} · ${qty}개 · 행 ${rowN}`;
}

/** 상태 필터와 무관하게 전체 norm(allRows) + duplicateRowIds(analyzeDuplicateRows, 구조 타입 반영) 기준. */
export function DuplicateMembersView({
  allRows,
  duplicateRowIds,
}: {
  allRows: any[];
  duplicateRowIds: Set<string>;
}) {
  type DupKeyGroup = {
    club: string;
    name: string;
    size: string;
    list: { r: any; i: number }[];
  };
  const clubMap = new Map<string, Map<string, DupKeyGroup>>();
  for (let i = 0; i < allRows.length; i += 1) {
    const r = allRows[i]!;
    if (isRowExcludedByEmptyQuantity(r)) continue;
    const name = String(r.memberNameRaw ?? r.memberName ?? "").trim();
    if (!name) continue;
    const club = normClubFromNormRow(r);
    const size = String(r.standardizedSize ?? r.sizeRaw ?? "미분류").trim() || "미분류";
    const key = `${club}\0${name}\0${size}`;
    if (!clubMap.has(club)) clubMap.set(club, new Map());
    const keyMap = clubMap.get(club)!;
    const cur = keyMap.get(key) ?? { club, name, size, list: [] };
    cur.list.push({ r, i });
    keyMap.set(key, cur);
  }

  const sections: { club: string; groups: DupKeyGroup[] }[] = [];
  for (const club of Array.from(clubMap.keys()).sort((a, b) => a.localeCompare(b, "ko"))) {
    const keyMap = clubMap.get(club)!;
    const groups: DupKeyGroup[] = [];
    for (const group of keyMap.values()) {
      const list = group.list;
      if (!list.some(({ r, i }) => duplicateRowIds.has(stableRowKeyForDup(r, i)))) continue;
      const listSorted = [...list].sort(compareRowsBySourceThenIndex);
      groups.push({ ...group, list: listSorted });
    }
    groups.sort((a, b) => a.name.localeCompare(b.name, "ko") || compareSizeLabel(a.size, b.size));
    if (groups.length) sections.push({ club, groups });
  }

  if (sections.length === 0) {
    return (
      <section className="size-analysis-card size-analysis-dup-only-section">
        <h3>중복자 보기</h3>
        <p className="size-analysis-muted">중복자가 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="size-analysis-card size-analysis-dup-only-section">
      <h3>중복자 보기</h3>
      <p className="size-analysis-muted size-analysis-dup-only-hint">
        duplicateRowIds 기준으로, 중복 키(클럽·이름·사이즈) 그룹만 표시합니다. 0/빈 수량 제외 행은 상세 목록에서 숨깁니다.
      </p>
      <div className="size-analysis-dup-only-list--mobile">
        {sections.map((sec) => (
          <div key={sec.club} className="size-analysis-dup-club">
            <h4 className="size-analysis-dup-club__title">{sec.club}</h4>
            {sec.groups.map((g) => {
              const total = g.list.reduce((s, { r }) => s + rowQtyParsed(r), 0);
              const dupQty = g.list
                .filter(({ r, i }) => duplicateRowIds.has(stableRowKeyForDup(r, i)))
                .reduce((s, { r }) => s + rowQtyParsed(r), 0);
              return (
                <div key={`${sec.club}\0${g.name}\0${g.size}`} className="size-analysis-dup-person">
                  <p className="size-analysis-dup-person__name">
                    {g.name} · {g.size} · 전체 {total}개 (중복분 {dupQty}개)
                  </p>
                  <ul className="size-analysis-dup-person__lines">
                    {g.list.map(({ r, i }, j) => {
                      const isDup = duplicateRowIds.has(stableRowKeyForDup(r, i));
                      return (
                      <li key={stableRowKeyForDup(r, i)}>
                        –{" "}
                        <span className={isDup ? "size-analysis-dup-line-tag--dup" : "size-analysis-dup-line-tag--ok"}>
                          {isDup ? "중복" : "정상"}
                        </span>{" "}
                        {lineGenderSizeQtyRow(r, j)}
                      </li>
                    );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="size-analysis-dup-pc-wrap" aria-label="중복자 표(PC)">
        {sections.map((sec) => (
          <div key={sec.club} className="size-analysis-dup-pc-club">
            <h4 className="size-analysis-dup-pc-club__title">{sec.club}</h4>
            <div className="size-analysis-dup-pc-table-scroll">
              <table className="size-analysis-dup-pc-table">
                <thead>
                  <tr>
                    <th scope="col">클럽</th>
                    <th scope="col">이름</th>
                    <th scope="col">구분</th>
                    <th scope="col">원본행</th>
                    <th scope="col">성별</th>
                    <th scope="col">사이즈</th>
                    <th scope="col">수량</th>
                  </tr>
                </thead>
                {sec.groups.map((g) => (
                  <tbody key={`${sec.club}\0${g.name}\0${g.size}`} className="size-analysis-dup-pc-tbody-group">
                    {g.list.map(({ r, i }, j) => {
                      const src =
                        r.sourceRowIndex != null && String(r.sourceRowIndex).trim() !== ""
                          ? String(r.sourceRowIndex).trim()
                          : "";
                      const gender = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
                      const size =
                        String(r.standardizedSize ?? r.sizeRaw ?? "미분류").trim() || "미분류";
                      const qtyN = rowQtyParsed(r);
                      const qtyCell = qtyN > 0 ? String(qtyN) : "";
                      const role = duplicateRowIds.has(stableRowKeyForDup(r, i)) ? "중복" : "정상";
                      return (
                        <tr key={stableRowKeyForDup(r, i)}>
                          <td>{sec.club}</td>
                          <td>{j === 0 ? g.name : ""}</td>
                          <td>{role}</td>
                          <td>{src}</td>
                          <td>{gender}</td>
                          <td>{size}</td>
                          <td>{qtyCell}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ClubMembersView({ allRows }: { allRows: any[] }) {
  type MemberAggRow = { name: string; gender: string; size: string; qty: number };
  const byClub = new Map<string, Map<string, MemberAggRow>>();
  for (const r of allRows) {
    const st = String(r?.parseStatus ?? "").trim();
    if (Boolean(r?.excluded) || st === "excluded") continue;
    const club = normClubFromNormRow(r);
    const name = String(r?.memberNameRaw ?? r?.memberName ?? "").trim() || "(이름 없음)";
    const gender = String(r?.genderNormalized ?? r?.genderRaw ?? "").trim() || "미분류";
    const size = String(r?.standardizedSize ?? r?.sizeRaw ?? "").trim() || "미분류";
    const qty = rowQtyParsed(r);
    const key = `${name}\0${gender}\0${size}`;
    if (!byClub.has(club)) byClub.set(club, new Map());
    const rowMap = byClub.get(club)!;
    const cur = rowMap.get(key) ?? { name, gender, size, qty: 0 };
    cur.qty += qty;
    rowMap.set(key, cur);
  }

  const sections = Array.from(byClub.entries())
    .map(([club, rowMap]) => ({
      club,
      rows: Array.from(rowMap.values()).sort(
        (a, b) =>
          a.name.localeCompare(b.name, "ko") ||
          compareGenderForClubSize(a.gender, b.gender) ||
          compareSizeLabel(a.size, b.size)
      ),
    }))
    .filter((sec) => sec.rows.length > 0)
    .sort((a, b) => a.club.localeCompare(b.club, "ko"));

  if (sections.length === 0) {
    return (
      <section className="size-analysis-card">
        <h3>클럽별 명단</h3>
        <p className="size-analysis-muted">표시할 명단이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="size-analysis-card size-analysis-club-members-section">
      <h3>클럽별 명단</h3>
      <p className="size-analysis-muted">
        allRows 기준으로 제외 행은 숨기고, 같은 클럽·이름·성별·사이즈는 수량을 합산해 표시합니다.
      </p>

      <div className="size-analysis-dup-only-list--mobile">
        {sections.map((sec) => (
          <article key={sec.club} className="size-analysis-dup-club">
            <h4 className="size-analysis-dup-club__title">{sec.club}</h4>
            <ul className="size-analysis-dup-person__lines">
              {sec.rows.map((row) => (
                <li key={`${sec.club}\0${row.name}\0${row.gender}\0${row.size}`}>
                  - {row.name} · {row.gender} {row.size} · {row.qty}개
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="size-analysis-dup-pc-wrap" aria-label="클럽별 명단 표(PC)">
        {sections.map((sec) => (
          <div key={`${sec.club}-pc`} className="size-analysis-dup-pc-club">
            <h4 className="size-analysis-dup-pc-club__title">{sec.club}</h4>
            <div className="size-analysis-dup-pc-table-scroll">
              <table className="size-analysis-dup-pc-table">
                <thead>
                  <tr>
                    <th scope="col">클럽</th>
                    <th scope="col">이름</th>
                    <th scope="col">성별</th>
                    <th scope="col">사이즈</th>
                    <th scope="col">수량</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((row, idx) => (
                    <tr key={`${sec.club}\0${row.name}\0${row.gender}\0${row.size}`}>
                      <td>{idx === 0 ? sec.club : ""}</td>
                      <td>{row.name}</td>
                      <td>{row.gender}</td>
                      <td>{row.size}</td>
                      <td>{row.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function defaultExpandedClubSet(items: Array<{ club: string }>) {
  const s = new Set<string>();
  for (let i = 0; i < Math.min(2, items.length); i += 1) s.add(items[i]!.club);
  return s;
}

export function ClubGroupedView({
  rows,
  dupByClub,
  normRows,
  duplicateRowIds,
}: {
  dupByClub?: Map<string, { persons: number; sheets: number }>;
  duplicateRowIds: Set<string>;
  normRows: any[];
  rows: Array<{
    club: string;
    totalQty: number;
    displaySummary: ClubDisplaySummaryStats;
    rows: Array<{ gender: string; size: string; qty: number; hasReview: boolean; hasUnresolved: boolean }>;
  }>;
}) {
  const [expanded, setExpanded] = useState(() => defaultExpandedClubSet(rows));
  const [overallExpanded, setOverallExpanded] = useState(true);

  const overallTripleMatrices = useMemo(() => {
    const statusByCell = buildCellStatusMap(normRows);
    const needsReviewQty = (normRows ?? []).reduce((sum, r) => {
      const st = String(r?.parseStatus ?? "").trim();
      if (st !== "needs_review") return sum;
      return sum + rowQtyParsed(r);
    }, 0);
    const modeDefs = [
      { modeKey: "total" as const, label: "전체 합계", flat: buildAggRowsTotal(normRows) },
      { modeKey: "deduped" as const, label: "전체 일반 수량", flat: buildAggRowsDedupedFirst(normRows, duplicateRowIds) },
      { modeKey: "duplicate" as const, label: "전체 중복수량", flat: buildAggRowsDuplicate(normRows, duplicateRowIds) },
    ];
    return modeDefs.map((m) => {
      const totalQty = m.flat.reduce((s, r) => s + r.qty, 0);
      const sizes = buildColumnSizesForClub(m.flat);
      const rowKeys = matrixGenderRowKeys(m.flat);
      const qtyMap = new Map<string, number>();
      for (const r of m.flat) {
        const gk = rowKeyGenderForAgg(r.gender);
        const k = `${gk}\0${r.size}`;
        qtyMap.set(k, (qtyMap.get(k) ?? 0) + r.qty);
      }
      const baseHeadline = `${m.label} (${totalQty}개)`;
      const headline =
        m.modeKey === "total"
          ? `${baseHeadline} · 검토필요(${needsReviewQty}개 포함)`
          : baseHeadline;
      return {
        modeKey: m.modeKey,
        headline,
        headlineAriaLabel: headline,
        isDuplicateMatrix: m.modeKey === "duplicate",
        sizes,
        rowKeys,
        qtyMap,
        resolveMeta: (gk: "여" | "남" | "공용", sz: string) => {
          let hasReview = false;
          let hasUnres = false;
          let hasCorrected = false;
          for (const clubName of rows.map((x) => x.club)) {
            const meta = statusByCell.get(`${clubName}\0${gk}\0${sz}`);
            if (!meta) continue;
            hasReview = hasReview || meta.hasReview;
            hasUnres = hasUnres || meta.hasUnres;
            hasCorrected = hasCorrected || meta.hasCorrected;
            if (hasReview && hasUnres && hasCorrected) break;
          }
          return { hasReview, hasUnres, hasCorrected };
        },
      };
    });
  }, [normRows, duplicateRowIds, rows]);

  /** 모바일 아코디언: 엑셀 클럽별집계와 동일 총/제외/중복 3블록(집계 함수 재사용) */
  const mobileClubTripleMatrices = useMemo(() => {
    const statusByCell = buildCellStatusMap(normRows);
    const flatTotal = buildAggRowsTotal(normRows);
    const flatDeduped = buildAggRowsDedupedFirst(normRows, duplicateRowIds);
    const flatDup = buildAggRowsDuplicate(normRows, duplicateRowIds);

    const pickClub = (clubName: string, flat: typeof flatTotal) => flat.filter((r) => r.club === clubName);

    const modeDefs = [
      { modeKey: "total" as const, shortLabel: "총", ariaLabel: CLUB_AGG_MODE_LABEL.total, flat: flatTotal },
      { modeKey: "deduped" as const, shortLabel: "일반 수량", ariaLabel: CLUB_AGG_MODE_LABEL.deduped, flat: flatDeduped },
      { modeKey: "duplicate" as const, shortLabel: "중복", ariaLabel: CLUB_AGG_MODE_LABEL.duplicate, flat: flatDup },
    ];

    return rows.map((c) => {
      const name = c.club;
      return modeDefs.map((m) => {
        const clubRows = pickClub(name, m.flat);
        const sizes = buildColumnSizesForClub(clubRows);
        const rowKeys = matrixGenderRowKeys(clubRows);
        const qtyMap = new Map<string, number>();
        for (const r of clubRows) {
          const gk = rowKeyGenderForAgg(r.gender);
          const k = `${gk}\0${r.size}`;
          qtyMap.set(k, (qtyMap.get(k) ?? 0) + r.qty);
        }
        const totalQty = clubRows.reduce((sum, row) => sum + row.qty, 0);
        return {
          modeKey: m.modeKey,
          shortLabel: `${m.shortLabel}(${totalQty}개)`,
          headlineAriaLabel: `${name} · ${m.ariaLabel}`,
          isDuplicateMatrix: m.modeKey === "duplicate",
          sizes,
          rowKeys,
          qtyMap,
          resolveMeta: (gk: "여" | "남" | "공용", sz: string) =>
            statusByCell.get(`${name}\0${gk}\0${sz}`) ?? EMPTY_CLUB_AGG_META,
        };
      });
    });
  }, [rows, normRows, duplicateRowIds]);

  if (rows.length === 0) return null;

  function toggleClub(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <section className="size-analysis-card size-analysis-club-group-view">
      <h3>클럽별 보기</h3>
      <p className="size-analysis-muted size-analysis-club-group-hint">
        클럽·성별·사이즈별 수량을 8) 집계와 같은 매트릭스로 확인할 수 있습니다.
      </p>
      <div className="size-analysis-club-group-list">
        <article className="size-analysis-club-group-card">
          <button
            type="button"
            className="size-analysis-club-group-head"
            onClick={() => setOverallExpanded((v) => !v)}
            aria-expanded={overallExpanded}
            aria-controls="size-analysis-club-overall-panel"
            aria-label={`전체 상세 ${overallExpanded ? "접기" : "펼치기"}`}
          >
            <span className="size-analysis-club-group-head__name">
              <span className="size-analysis-club-group-head__clubtitle">전체</span>
            </span>
            <span className="size-analysis-club-group-head__right">
              <span className="size-analysis-club-group-chevron" aria-hidden>
                <svg
                  className={
                    overallExpanded
                      ? "size-analysis-club-group-chevron__svg is-open"
                      : "size-analysis-club-group-chevron__svg"
                  }
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </span>
          </button>
          <div
            id="size-analysis-club-overall-panel"
            className={[
              "size-analysis-club-group-rows",
              !overallExpanded ? "size-analysis-club-group-rows--collapsed-mobile" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="size-analysis-club-group-mtx-wrap size-analysis-club-group-mobile-agg-stack">
              {overallTripleMatrices.map((blk) => (
                <ClubAggMatrixTableDesktop
                  key={`overall-${blk.modeKey}`}
                  headline={blk.headline}
                  headlineAriaLabel={blk.headlineAriaLabel}
                  isDuplicateMatrix={blk.isDuplicateMatrix}
                  sizes={blk.sizes}
                  rowKeys={blk.rowKeys}
                  qtyMap={blk.qtyMap}
                  resolveMeta={blk.resolveMeta}
                />
              ))}
            </div>
          </div>
        </article>
      </div>
      <div className="size-analysis-club-group-accordion--mobile">
        <div className="size-analysis-club-group-list">
          {rows.map((club, idx) => {
            const isOpen = expanded.has(club.club);
            const panelId = `size-analysis-club-panel-${idx}`;
            const dup = dupByClub?.get(club.club);
            const dupPart =
              dup && dup.persons > 0 ? ` · 중복 ${dup.persons}명/${dup.sheets}개` : "";
            const headSummary = (
              <span className="size-analysis-club-group-head__name">
                <span className="size-analysis-club-group-head__clubtitle">{club.club}</span>
                <span className="size-analysis-club-group-head__summary size-analysis-muted">
                  총 인원 {club.displaySummary.totalPersons}명 / 사이즈 수량 {club.displaySummary.sizedQtySum}개 / 미입력{" "}
                  {club.displaySummary.missingSizePersons}명{dupPart}
                </span>
              </span>
            );
            return (
              <article key={`${idx}-${club.club}`} className="size-analysis-club-group-card">
                <button
                  type="button"
                  className="size-analysis-club-group-head"
                  onClick={() => toggleClub(club.club)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  aria-label={`${club.club} 상세 ${isOpen ? "접기" : "펼치기"}`}
                >
                  {headSummary}
                  <span className="size-analysis-club-group-head__right">
                    <span className="size-analysis-club-group-chevron" aria-hidden>
                      <svg
                        className={
                          isOpen ? "size-analysis-club-group-chevron__svg is-open" : "size-analysis-club-group-chevron__svg"
                        }
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </span>
                </button>
                <div
                  id={panelId}
                  className={[
                    "size-analysis-club-group-rows",
                    !isOpen ? "size-analysis-club-group-rows--collapsed-mobile" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="size-analysis-club-group-mtx-wrap size-analysis-club-group-mobile-agg-stack">
                    {mobileClubTripleMatrices[idx]!.map((blk) => (
                      <ClubAggMatrixTableDesktop
                        key={blk.modeKey}
                        headline={blk.shortLabel}
                        headlineAriaLabel={blk.headlineAriaLabel}
                        shortHeadline
                        isDuplicateMatrix={blk.isDuplicateMatrix}
                        sizes={blk.sizes}
                        rowKeys={blk.rowKeys}
                        qtyMap={blk.qtyMap}
                        resolveMeta={blk.resolveMeta}
                      />
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function AnalysisSummaryCards({
  summary,
  duplicateAnalysis,
  allRows,
  statusFilter,
}: {
  summary: any;
  duplicateAnalysis: DuplicateAnalysis;
  allRows: any[];
  statusFilter: string;
}) {
  if (!summary) return null;
  const totalQty = (allRows ?? []).reduce((s, r) => s + rowQtyParsed(r), 0);
  const finalQty = totalQty - duplicateAnalysis.duplicateQtyTotal;
  const filterLabel = STATUS_FILTER_LABEL[statusFilter as (typeof STATUS_FILTER_OPTIONS)[number]] ?? statusFilter;
  const cards: Array<[string, string | number]> = [
    ["총 정규화 행 수", summary.totalRows],
    ["자동확정", summary.auto_confirmed],
    ["검토필요", summary.needs_review],
    ["미분류", summary.unresolved],
    ["수정완료", summary.corrected],
    ["제외(중복자)", summary.excludedDuplicateCount ?? 0],
    ["빈 수량 제외", summary.excludedEmptyQtyCount ?? 0],
    ["원본 총수량", totalQty],
    ["중복 제외 수량", finalQty],
    ["중복 주문(건)", duplicateAnalysis.duplicatePersonCount],
    ["중복 수량", duplicateAnalysis.duplicateQtyTotal],
  ];
  return (
    <section className="size-analysis-card">
      <h3>5) 결과 요약</h3>
      <p className="size-analysis-muted size-analysis-summary-scope-hint">
        윗줄은 파싱 상태별·제외(중복/빈 셀) 건수입니다. 6) «제외(중복)» 필터는 중복자만 표시하며(빈 수량 셀은 집계 숫자로만), 아래 수량은 norm 전체·중복 집계 기준(중복 제외 수량 = 원본 − 중복)입니다. 전체 보기 테이블에만 필터가 적용됩니다
        {filterLabel !== "all" ? ` (현재 필터: ${filterLabel})` : ""}.
      </p>
      <div className="size-analysis-summary-cards">
        {cards.map(([label, value]) => (
          <article key={label} className="size-analysis-summary-card">
            <div className="size-analysis-summary-card__label">{label}</div>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AnalysisStatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <section className="size-analysis-card">
      <h3>6) 상태 필터</h3>
      <div className="size-analysis-filter-row">
        {STATUS_FILTER_OPTIONS.map((opt, idx) => (
          <button
            key={opt}
            className={`btn ${value === opt ? "btn-primary" : "btn-secondary"} ${idx === 0 ? "size-analysis-filter-btn--all" : ""}`}
            onClick={() => void onChange(opt)}
            type="button"
          >
            {STATUS_FILTER_LABEL[opt]}
          </button>
        ))}
      </div>
    </section>
  );
}

function normalizedRowLine1(r: any): string {
  const club = String(r.clubNameRaw ?? "").trim();
  const name = String(r.memberNameRaw ?? "").trim();
  const gender = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
  const size = String(r.standardizedSize ?? r.sizeRaw ?? "").trim();
  const q = r.qtyParsed ?? r.qtyRaw;
  let qtyStr = "";
  if (q !== "" && q != null) {
    const n = Number(q);
    qtyStr = Number.isFinite(n) ? `${n}개` : String(q).trim();
  }
  const parts: string[] = [];
  if (club) parts.push(club);
  if (name) parts.push(name);
  if (gender && size) {
    parts.push(`${gender} ${size}`);
  } else if (size) {
    parts.push(size);
  } else if (gender) {
    parts.push(gender);
  }
  if (qtyStr) parts.push(qtyStr);
  return parts.join(" · ");
}

/** 모바일 요약: 검토/미분류/수정완료는 뱃지로, 본문에는 원본행·신뢰도만(중복 강조 방지) */
function normalizedRowLine2Parts(r: any): {
  subline: string;
  pill: "needs_review" | "unresolved" | "corrected" | null;
} {
  const src =
    r.sourceRowIndex != null && r.sourceRowIndex !== "" ? `원본행 ${r.sourceRowIndex}` : "";
  const conf = `신뢰도 ${Number(r.parseConfidence ?? 0).toFixed(2)}`;
  const st = String(r.parseStatus ?? "");
  if (st === "excluded" || r.excluded) {
    const rsn = labelSizeAnalysisReasonForRow(r);
    return {
      subline: [src, rsn, conf].filter((x) => x && x.length > 0).join(" · "),
      pill: null,
    };
  }
  if (st === "needs_review" || st === "unresolved" || st === "corrected") {
    const rsn = labelSizeAnalysisReasonForRow(r);
    return {
      subline: [src, rsn, conf].filter((x) => x && x.length > 0).join(" · "),
      pill: st as "needs_review" | "unresolved" | "corrected",
    };
  }
  const statusLabel = labelSizeAnalysisParseStatusForRow(r);
  return {
    subline: [src, statusLabel, conf].filter((x) => x && x.length > 0).join(" · "),
    pill: null,
  };
}

function normCompactClass(st: string | undefined) {
  if (st === "needs_review") return "size-analysis-norm-compact size-analysis-norm-compact--review";
  if (st === "unresolved") return "size-analysis-norm-compact size-analysis-norm-compact--unresolved";
  if (st === "corrected") return "size-analysis-norm-compact size-analysis-norm-compact--corrected";
  return "size-analysis-norm-compact";
}

export function AnalysisRowsTable({ rows, duplicateRowIds }: { rows: any[]; duplicateRowIds: Set<string> }) {
  return (
    <section className="size-analysis-card size-analysis-norm-section">
      <h3>7) 정규화 행</h3>
      <div className="size-analysis-norm-compact-list size-analysis-norm-compact-list--mobile" aria-label="정규화 행(요약)">
        {rows.map((r, i) => {
          const { subline, pill } = normalizedRowLine2Parts(r);
          const isDup = duplicateRowIds.has(stableRowKeyForDup(r, i));
          return (
            <article key={stableRowKeyForDup(r, i)} className={normCompactClass(r.parseStatus)}>
              <p className="size-analysis-norm-compact__line1">
                <span className="size-analysis-norm-compact__line1-text">{normalizedRowLine1(r)}</span>
                {isDup ? <span className="size-analysis-dup-badge">중복</span> : null}
              </p>
              <div className="size-analysis-norm-compact__row2">
                <p className="size-analysis-norm-compact__line2">{subline}</p>
                {pill === "needs_review" ? (
                  <span className="size-analysis-mini-pill size-analysis-mini-pill--review">검토필요</span>
                ) : pill === "unresolved" ? (
                  <span className="size-analysis-mini-pill size-analysis-mini-pill--unresolved">미분류</span>
                ) : pill === "corrected" ? (
                  <span className="size-analysis-mini-pill size-analysis-mini-pill--corrected">수정완료</span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      <div className="size-analysis-table-wrap size-analysis-norm-table-wrap--desktop">
        <table className="size-analysis-table size-analysis-table--normalized">
          <thead>
            <tr>
              <th>원본행</th>
              <th>클럽</th>
              <th>이름</th>
              <th>성별</th>
              <th>사이즈</th>
              <th>수량</th>
              <th>상태</th>
              <th>사유</th>
              <th>신뢰도</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isDup = duplicateRowIds.has(stableRowKeyForDup(r, i));
              return (
                <tr key={stableRowKeyForDup(r, i)}>
                  <td data-label="원본행">{r.sourceRowIndex}</td>
                  <td data-label="클럽">{r.clubNameRaw ?? ""}</td>
                  <td data-label="이름">
                    <span className="size-analysis-table-name-cell">
                      {r.memberNameRaw ?? ""}
                      {isDup ? <span className="size-analysis-dup-badge">중복</span> : null}
                    </span>
                  </td>
                  <td data-label="성별">{r.genderNormalized ?? r.genderRaw ?? ""}</td>
                  <td data-label="사이즈">{r.standardizedSize ?? r.sizeRaw ?? ""}</td>
                  <td data-label="수량">{r.qtyParsed ?? r.qtyRaw ?? ""}</td>
                  <td data-label="상태">{labelSizeAnalysisParseStatusForRow(r)}</td>
                  <td data-label="사유">{labelSizeAnalysisReasonForRow(r)}</td>
                  <td data-label="신뢰도">{Number(r.parseConfidence ?? 0).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function compareGenderForClubSize(a: string, b: string): number {
  const order = (g: string) => {
    const t = String(g ?? "").trim();
    if (t === "남") return 0;
    if (t === "여") return 1;
    if (t === "공용" || t === "") return 2;
    return 3;
  };
  return order(a) - order(b) || String(a ?? "").localeCompare(String(b ?? ""), "ko");
}

function compareSizeLabel(a: string, b: string): number {
  const aa = String(a ?? "").trim();
  const bb = String(b ?? "").trim();
  const an = /^\d+$/.test(aa) ? Number(aa) : Number.NaN;
  const bn = /^\d+$/.test(bb) ? Number(bb) : Number.NaN;
  const aIsNum = Number.isFinite(an);
  const bIsNum = Number.isFinite(bn);
  if (aIsNum && bIsNum) return an - bn;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return aa.localeCompare(bb, "ko");
}

type CellMeta = { hasReview: boolean; hasUnres: boolean; hasCorrected: boolean };
function buildCellStatusMap(normRows: any[]): Map<string, CellMeta> {
  const map = new Map<string, CellMeta>();
  for (const r of normRows) {
    if (r.excluded) continue;
    const club = normClubFromNormRow(r);
    const { gender: gDisp, size: sDisp } = matrixAggGenderAndSizeFromRow(r);
    const gk = rowKeyGenderForAgg(gDisp);
    const size = sDisp || "미분류";
    const key = `${club}\0${gk}\0${size}`;
    const st = String(r.parseStatus ?? "");
    const cur = map.get(key) ?? { hasReview: false, hasUnres: false, hasCorrected: false };
    if (st === "needs_review") cur.hasReview = true;
    if (st === "unresolved") cur.hasUnres = true;
    if (st === "corrected") cur.hasCorrected = true;
    map.set(key, cur);
  }
  return map;
}

function groupClubAggRows(rows: Array<{ club: string; gender: string; size: string; qty: number }>) {
  const by = new Map<string, typeof rows>();
  for (const r of rows) {
    const c = r.club;
    if (!by.has(c)) by.set(c, []);
    by.get(c)!.push(r);
  }
  return by;
}

type ClubAggCellMeta = { hasReview: boolean; hasUnres: boolean; hasCorrected: boolean };

const EMPTY_CLUB_AGG_META: ClubAggCellMeta = { hasReview: false, hasUnres: false, hasCorrected: false };

/** 클럽/성별/사이즈 집계 매트릭스 표 — 8) 집계·클럽별 보기(모바일·PC 공통) */
function ClubAggMatrixTableDesktop({
  headline,
  headlineAriaLabel,
  shortHeadline,
  isDuplicateMatrix,
  sizes,
  rowKeys,
  qtyMap,
  resolveMeta,
}: {
  headline: string;
  /** 짧은 제목(총/제외/중복)일 때 접근성용 전체 설명 */
  headlineAriaLabel?: string;
  /** 클럽별 보기 모바일 3블록용 — 제목 한 줄만 강조 */
  shortHeadline?: boolean;
  /** 클럽별 보기(중복 블록): 셀 배경색을 중복 전용 색상으로 통일 */
  isDuplicateMatrix?: boolean;
  sizes: string[];
  rowKeys: Array<"여" | "남" | "공용">;
  qtyMap: Map<string, number>;
  resolveMeta: (gk: "여" | "남" | "공용", sz: string) => ClubAggCellMeta;
}) {
  return (
    <div
      className={[
        "size-analysis-club-agg-mtx-block",
        shortHeadline ? "size-analysis-club-agg-mtx-block--short-headline" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p
        className="size-analysis-club-agg-mtx-clubline"
        {...(headlineAriaLabel ? { "aria-label": headlineAriaLabel } : {})}
      >
        {headline}
      </p>
      <div className="size-analysis-club-agg-mtx-scroll">
        <table className="size-analysis-club-agg-mtx">
          <thead>
            <tr>
              <th className="size-analysis-club-agg-mtx-corner" scope="col" aria-label="성별·사이즈">
                {"\u200b"}
              </th>
              {sizes.map((sz) => (
                <th key={sz} scope="col">
                  {sz}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowKeys.map((gk) => (
              <tr key={gk}>
                <th className="size-analysis-club-agg-mtx-gh" scope="row">
                  {gk}
                </th>
                {sizes.map((sz) => {
                  const q = qtyMap.get(`${gk}\0${sz}`) ?? 0;
                  const meta = resolveMeta(gk, sz);
                  const stBits: string[] = [];
                  if (!isDuplicateMatrix) {
                    if (meta.hasReview) stBits.push("검토필요");
                    if (meta.hasUnres) stBits.push("미분류");
                    if (meta.hasCorrected) stBits.push("수정완료");
                  }
                  const stLabel = stBits.length ? stBits.join(", ") : undefined;
                  let stateClass = "";
                  if (isDuplicateMatrix && q > 0) {
                    stateClass = "size-analysis-club-agg-mtx-cell--duplicate";
                  } else if (meta.hasReview) stateClass = "size-analysis-club-agg-mtx-cell--review";
                  else if (meta.hasUnres) stateClass = "size-analysis-club-agg-mtx-cell--unres";
                  else if (meta.hasCorrected) stateClass = "size-analysis-club-agg-mtx-cell--corrected";
                  const show = q > 0 ? String(q) : "";
                  return (
                    <td
                      key={`${gk}-${sz}`}
                      className={stateClass}
                      title={stLabel}
                      aria-label={
                        stLabel ? `${gk}·${sz} ${show || "0"} (${stLabel})` : show ? `${gk}·${sz} ${show}` : undefined
                      }
                    >
                      {show}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ClubSizeSummaryTable({
  normRows,
  duplicateRowIds,
}: {
  /** 필터·제외가 반영된 정규화 행(셀 상태·집계 입력) */
  normRows: any[];
  duplicateRowIds: Set<string>;
}) {
  const [aggMode, setAggMode] = useState<ClubSizeAggMode>("total");

  const aggFlat = useMemo(() => {
    if (aggMode === "total") return buildAggRowsTotal(normRows);
    if (aggMode === "duplicate") return buildAggRowsDuplicate(normRows, duplicateRowIds);
    return buildAggRowsDedupedFirst(normRows, duplicateRowIds);
  }, [normRows, aggMode, duplicateRowIds]);

  const baseClubs = useMemo(
    () => unionClubsOrdered([buildAggRowsTotal(normRows)]),
    [normRows]
  );

  const statusByCell = useMemo(() => buildCellStatusMap(normRows ?? []), [normRows]);

  const matrixBlocks = useMemo(() => {
    if (baseClubs.length === 0) return [];
    const by = groupClubAggRows(aggFlat);
    return baseClubs.map((club) => {
      const clubRows = by.get(club) ?? [];
      const totalQty = clubRows.reduce((s, r) => s + r.qty, 0);
      const sizes = buildColumnSizesForClub(clubRows);
      const rowKeys = matrixGenderRowKeys(clubRows);
      const qtyMap = new Map<string, number>();
      for (const r of clubRows) {
        const gk = rowKeyGenderForAgg(r.gender);
        const k = `${gk}\0${r.size}`;
        qtyMap.set(k, (qtyMap.get(k) ?? 0) + r.qty);
      }
      const modeLabel = CLUB_AGG_MODE_LABEL[aggMode];
      const headline = `${club} · ${modeLabel} ${totalQty}개`;
      return { club, clubRows, totalQty, sizes, rowKeys, qtyMap, headline };
    });
  }, [aggFlat, aggMode, baseClubs]);

  if (baseClubs.length === 0) return null;

  return (
    <section className="size-analysis-card size-analysis-club-size-card size-analysis-club-agg-section">
      <h3>8) 클럽/성별/사이즈 집계</h3>
      <div
        className="size-analysis-agg-mode-tabs"
        role="tablist"
        aria-label="집계 기준"
      >
        {(["total", "deduped", "duplicate"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={aggMode === m}
            className={`size-analysis-agg-mode-tab${aggMode === m ? " size-analysis-agg-mode-tab--active" : ""}`}
            onClick={() => setAggMode(m)}
          >
            {CLUB_AGG_MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="size-analysis-muted size-analysis-club-size-hint size-analysis-club-agg-hint">
        탭에 따라 동일한 클럽·성별·사이즈 매트릭스로 수량을 확인합니다. (총=전체, 중복=duplicateRowIds, 중복 제외=총-중복)
      </p>
      <div className="size-analysis-club-agg-mtx-host" aria-label="집계(클럽별 매트릭스)">
        {matrixBlocks.map((b) => (
          <ClubAggMatrixTableDesktop
            key={b.club}
            headline={b.headline}
            sizes={b.sizes}
            rowKeys={b.rowKeys}
            qtyMap={b.qtyMap}
            resolveMeta={(gk, sz) => statusByCell.get(`${b.club}\0${gk}\0${sz}`) ?? EMPTY_CLUB_AGG_META}
          />
        ))}
      </div>
    </section>
  );
}

