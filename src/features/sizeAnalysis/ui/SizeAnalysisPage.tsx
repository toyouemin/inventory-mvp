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
  rowIncludedInFinalAggregation,
  rowIncludedInDuplicateAggregation,
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
import {
  countUiOutsideAllowedSizesAssistEligibleRows,
  displayParseConfidenceUi,
  isMaleOutOfRange90Row,
  outsideAllowedSizesDisplayTail,
  shouldPrioritizeSizeCheckUiDisplay,
  uiRowOutsideAllowedSizesForAssistFilter,
} from "@/features/sizeAnalysis/uiOutsideAllowedSizes";
import { downloadSizeAnalysisResultXlsx } from "@/features/sizeAnalysis/exportSizeAnalysisXlsx";
import {
  excelColumnLetterFromOneBased,
  findDuplicateColumnIndices,
  maxColumnCountInPreview,
  mergeAutoFieldMap,
  suggestFieldIndicesFromHeaderRow,
} from "@/features/sizeAnalysis/fieldMappingUi";

type Mapping = {
  structureType: "single_row_person" | "repeated_slots" | "size_matrix" | "multi_item_personal_order" | "unknown";
  headerRowIndex: number;
  fields: Record<string, number | undefined>;
  productColumns?: number[];
  slotGroups?: Array<Record<string, number | undefined>>;
};

function hasField(mapping: Mapping, key: string): boolean {
  return mapping.fields[key] !== undefined;
}

function hasUnknownRequiredFields(mapping: Mapping): boolean {
  const hasName = hasField(mapping, "name");
  const hasSize = hasField(mapping, "size") || hasField(mapping, "size2");
  if (!hasName) return false;
  return hasSize || hasField(mapping, "item");
}

function isMappingReadyForRun(mapping: Mapping | null): boolean {
  if (!mapping) return false;
  if (mapping.structureType === "unknown") {
    return hasUnknownRequiredFields(mapping);
  }
  if (mapping.structureType === "multi_item_personal_order") {
    const hasName = hasField(mapping, "name");
    const productColumns = Array.isArray(mapping.productColumns) ? mapping.productColumns : [];
    return hasName && productColumns.length > 0;
  }
  const hasName = hasField(mapping, "name");
  const hasClub = hasField(mapping, "club");
  if (!hasName || !hasClub) return false;
  if (mapping.structureType === "single_row_person") {
    return hasField(mapping, "size");
  }
  if (mapping.structureType === "repeated_slots") {
    const groups = mapping.slotGroups ?? [];
    return groups.some((g) => g.club !== undefined && g.name !== undefined && g.size !== undefined);
  }
  if (mapping.structureType === "size_matrix") {
    return hasClub;
  }
  return false;
}

/** 화면 표시 전용(내부 API/DB 값은 영문 유지) */
const STRUCTURE_TYPE_LABEL: Record<Mapping["structureType"], string> = {
  single_row_person: "사람별 1행",
  repeated_slots: "반복 슬롯형",
  size_matrix: "사이즈표형",
  multi_item_personal_order: "다품목 개인주문형",
  unknown: "직접 매핑",
};

const FIELD_ROLE_LABEL: Record<string, string> = {
  club: "클럽",
  name: "이름",
  gender: "성별",
  size: "사이즈",
  size2: "사이즈2",
  qty: "수량",
  item: "주문내용",
  note: "비고",
  productColumns: "상품 컬럼",
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

function isNameMissingRow(r: any): boolean {
  return String(r?.memberNameRaw ?? r?.memberName ?? "").trim() === "";
}

function displaySizeWithWarning(r: any): string {
  const base = String(r?.standardizedSize ?? r?.sizeRaw ?? "").trim();
  if (!base) return "";
  return isMaleOutOfRange90Row(r) ? `${base}(확인)` : base;
}

function displayReasonForNormalizedRow(r: any): string {
  const warningReason = isMaleOutOfRange90Row(r) ? "남성 기준 외 사이즈" : "";
  let core: string;
  if (isNameMissingRow(r)) {
    const hasSize = String(r?.standardizedSize ?? r?.sizeRaw ?? "").trim() !== "";
    const baseReason = hasSize ? "이름 없음" : "이름 없음 / 사이즈 없음";
    core = warningReason ? `${baseReason} / ${warningReason}` : baseReason;
  } else {
    const baseReason = labelSizeAnalysisReasonForRow(r);
    core = warningReason ? (baseReason ? `${baseReason} / ${warningReason}` : warningReason) : baseReason;
  }
  const outsideTail = outsideAllowedSizesDisplayTail(r);
  return outsideTail ? (core ? `${core} · ${outsideTail}` : outsideTail) : core;
}

/** 정규화 행 테이블 상태 열(UI만): 범위 밖이면 '사이즈 확인' 우선 */
function labelNormalizedRowParseStatusUi(r: any): string {
  if (shouldPrioritizeSizeCheckUiDisplay(r)) return "사이즈 확인";
  return labelSizeAnalysisParseStatusForRow(r);
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
  /** 확인 전용: 집계·API와 무관, 전체 보기 목록 필터만 */
  const [outsideSizesAssistActive, setOutsideSizesAssistActive] = useState(false);
  const [loading, setLoading] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [mappingSaved, setMappingSaved] = useState(false);
  const [autoMappingNeedsReview, setAutoMappingNeedsReview] = useState(false);
  const [detailViewMode, setDetailViewMode] = useState<"all" | "club" | "duplicates" | "clubMembers">("all");
  const autoDetectedKeyRef = useRef<string>("");

  const structureTypeForDup: StructureType | undefined =
    mapping?.structureType ??
    (allRows[0]?.metaJson?.structureType as StructureType | undefined);
  const duplicateAnalysis = useMemo(
    () => analyzeDuplicateRows(allRows, structureTypeForDup),
    [allRows, structureTypeForDup]
  );

  const outsideAssistEligibleCount = useMemo(
    () => countUiOutsideAllowedSizesAssistEligibleRows(allRows),
    [allRows]
  );

  const allViewDisplayRows = useMemo(() => {
    if (!outsideSizesAssistActive) return rows;
    return rows.filter((r) => uiRowOutsideAllowedSizesForAssistFilter(r));
  }, [rows, outsideSizesAssistActive]);

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
        const displaySummary = computeClubDisplaySummaryStats(allRows, club.club, structureTypeForDup);
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
    setAutoMappingNeedsReview(false);
    setLoading("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/size-analysis/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "업로드 실패");
      setJobId(json.jobId);
      setOutsideSizesAssistActive(false);
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
    setAutoMappingNeedsReview(false);
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
      const nextMapping = { ...base, fields: mergeAutoFieldMap(base.fields ?? {}, auto) };
      setMapping(nextMapping);
      if (isMappingReadyForRun(nextMapping)) {
        const saveRes = await fetch("/api/size-analysis/save-mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, sheetName: selectedSheet, mapping: nextMapping }),
        });
        const saveJson = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveJson.error ?? "매핑 저장 실패");
        setMappingSaved(true);
        setAutoMappingNeedsReview(false);
      } else {
        setMappingSaved(false);
        setAutoMappingNeedsReview(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "구조 분석 실패");
      setAutoMappingNeedsReview(true);
    } finally {
      setLoading("");
    }
  }

  async function saveMappingAction() {
    if (!jobId || !selectedSheet || !mapping) return;
    if (!isMappingReadyForRun(mapping)) {
      setMappingSaved(false);
      setError("필수 매핑을 완료해주세요");
      return;
    }
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
      setAutoMappingNeedsReview(false);
    } catch (e) {
      setMappingSaved(false);
      setError(e instanceof Error ? e.message : "매핑 저장 실패");
    } finally {
      setLoading("");
    }
  }

  async function runAction() {
    if (!jobId) return;
    if (!mappingSaved) {
      setError("필수 매핑을 완료해주세요");
      return;
    }
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
    setOutsideSizesAssistActive(false);
    setStatusFilter(next);
    if (jobId) await refreshResult(jobId, next);
  }

  /** 범위외 필터와 상태 버튼은 동시 활성(primary)처럼 보이지 않게 상호 배타적 */
  async function handleOutsideAssistChange(next: boolean) {
    if (!next) {
      setOutsideSizesAssistActive(false);
      return;
    }
    setOutsideSizesAssistActive(true);
    if (jobId && statusFilter !== "all") {
      setStatusFilter("all");
      await refreshResult(jobId, "all");
    }
  }

  async function toggleIncludeNameMissingRow(row: any, include: boolean) {
    if (!jobId || !row?.id) return;
    const res = await fetch(`/api/size-analysis/${jobId}/correct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rowId: row.id,
        includeNameMissingQty: include,
        parseReason: include ? "이름 없음 수량 포함(사용자 확인)" : "이름 없음",
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "이름 없음 포함 처리 실패");
    await refreshResult(jobId, statusFilter);
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
                showRemapGuide={autoMappingNeedsReview}
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
                : "필수 매핑을 완료해주세요"
            }
          >
            {loading === "run" ? "분석 실행 중..." : allSetupStepsComplete ? "분석실행(클릭)" : "분석실행"}
          </button>
          {!allSetupStepsComplete ? (
            <p className="size-analysis-muted size-analysis-run-card__note" role="note">
              필수 매핑을 완료해주세요
            </p>
          ) : null}
        </section>

        <div className="size-analysis-grid-item size-analysis-grid-item--summary">
          <AnalysisSummaryCards
            summary={summary}
            duplicateAnalysis={duplicateAnalysis}
            allRows={allRows}
            statusFilter={statusFilter}
            outsideSizesAssistActive={outsideSizesAssistActive}
            outsideAssistEligibleCount={outsideAssistEligibleCount}
            structureType={structureTypeForDup}
          />
        </div>

        <div className="size-analysis-grid-item size-analysis-grid-item--filter">
          <AnalysisStatusFilter
            value={statusFilter}
            onChange={onStatusChange}
            outsideSizesAssistActive={outsideSizesAssistActive}
            onOutsideSizesAssistChange={(next) => void handleOutsideAssistChange(next)}
            outsideAssistEligibleCount={outsideAssistEligibleCount}
            needsReviewCount={Number(summary?.needs_review ?? 0)}
          />
        </div>

        <section className="size-analysis-card size-analysis-xlsx-export">
          <h3>엑셀 내보내기</h3>
          <p className="size-analysis-muted size-analysis-xlsx-export__hint">
            전체목록·클럽별집계·중복자·검토필요 저장 (다품목 개인주문형은 상품별 시트 추가)
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={allRows.length === 0}
            onClick={() =>
              downloadSizeAnalysisResultXlsx(allRows, duplicateAnalysis, { structureType: structureTypeForDup })
            }
          >
            분석자료 엑셀 다운로드 (.xlsx)
          </button>
        </section>

        <div className="size-analysis-result-region">
          <DetailViewSwitch mode={detailViewMode} onChange={setDetailViewMode} structureType={structureTypeForDup} />
          {detailViewMode === "all" ? (
            <>
              <AnalysisRowsTable
                rows={allViewDisplayRows}
                duplicateRowIds={duplicateAnalysis.duplicateRowIds}
                onToggleIncludeNameMissingRow={toggleIncludeNameMissingRow}
                showItemColumn={structureTypeForDup === "multi_item_personal_order"}
              />
              <ClubSizeSummaryTable duplicateRowIds={duplicateAnalysis.duplicateRowIds} normRows={allRows} />
              {structureTypeForDup === "multi_item_personal_order" ? (
                <ProductSizeSummaryTable duplicateRowIds={duplicateAnalysis.duplicateRowIds} normRows={allRows} />
              ) : null}
            </>
          ) : detailViewMode === "club" ? (
            <ClubGroupedView
              key={clubViewDataKey}
              dupByClub={duplicateAnalysis.dupByClub}
              duplicateRowIds={duplicateAnalysis.duplicateRowIds}
              normRows={allRows}
              structureType={structureTypeForDup}
              rows={clubGroupedRows}
            />
          ) : detailViewMode === "duplicates" ? (
            <DuplicateMembersView allRows={allRows} duplicateRowIds={duplicateAnalysis.duplicateRowIds} />
          ) : (
            <ClubMembersView
              allRows={allRows}
              duplicateRowIds={duplicateAnalysis.duplicateRowIds}
              structureType={structureTypeForDup}
            />
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
      <p className="size-analysis-muted size-analysis-upload-card__hint">실제 티셔츠 신청 클럽명으로 수정 후 업로드</p>
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

const UNKNOWN_REQUIRED_BASE = ["name"] as const;

export function FieldMappingEditor({
  mapping,
  onChange,
  onSave,
  loading,
  saved,
  showRemapGuide,
  previewRows,
  disabled = false,
}: {
  mapping: Mapping | null;
  onChange: (mapping: Mapping) => void;
  onSave: () => void;
  loading: boolean;
  saved: boolean;
  showRemapGuide?: boolean;
  previewRows?: string[][];
  disabled?: boolean;
}) {
  const [autoFillMessage, setAutoFillMessage] = useState<string>("");
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
  /** 한 그리드에 8칸 — PC 4열이면 (클럽·이름·성별·사이즈) / (사이즈2·수량·주문내용·비고) */
  const FIELD_ROLES_MAP = ["club", "name", "gender", "size", "size2", "qty", "item", "note"] as const;
  const hasPreview = maxCols > 0;
  const previewLen = previewRows?.length ?? 0;
  const headerOutOfPreview = m.headerRowIndex >= previewLen;
  const hasSizeColumn = m.fields.size !== undefined || m.fields.size2 !== undefined;
  const isMultiItem = m.structureType === "multi_item_personal_order";
  const selectedProductColumns = useMemo(
    () =>
      Array.from(new Set((m.productColumns ?? []).filter((x): x is number => Number.isInteger(x) && x >= 0))).sort(
        (a, b) => a - b
      ),
    [m.productColumns]
  );
  const coreFieldSet = useMemo(
    () =>
      new Set<number>(
        [m.fields.club, m.fields.name, m.fields.gender, m.fields.note]
          .filter((x): x is number => typeof x === "number" && x >= 0)
      ),
    [m.fields.club, m.fields.name, m.fields.gender, m.fields.note]
  );
  const unknownRequired = [
    ...UNKNOWN_REQUIRED_BASE,
    ...(hasSizeColumn ? [] : (["item"] as const)),
  ];
  const requiredUnknownSet = new Set<string>(unknownRequired);

  function columnLabelForIndex(zeroIdx: number): string {
    const h = String(headerCells[zeroIdx] ?? "").trim() || "제목 없음";
    const u = zeroIdx + 1;
    const L = excelColumnLetterFromOneBased(u);
    return `${h} (${L}열 = ${u})`;
  }

  function toggleProductColumn(zeroIdx: number) {
    const current = new Set(selectedProductColumns);
    if (current.has(zeroIdx)) current.delete(zeroIdx);
    else current.add(zeroIdx);
    const next = Array.from(current).sort((a, b) => a - b);
    onChange({ ...m, productColumns: next });
  }

  function productChipLabel(zeroIdx: number): string {
    const header = String(headerCells[zeroIdx] ?? "").trim() || "제목 없음";
    const col = excelColumnLetterFromOneBased(zeroIdx + 1);
    return `${header} · ${col}열`;
  }

  function applyHeaderAuto() {
    const next = mergeAutoFieldMap(m.fields, suggestFieldIndicesFromHeaderRow(headerCells));
    let addedCount = 0;
    const keys = new Set<string>([...Object.keys(m.fields ?? {}), ...Object.keys(next ?? {})]);
    keys.forEach((k) => {
      const before = m.fields?.[k];
      const after = next?.[k];
      if (before === undefined && after !== undefined) addedCount += 1;
    });
    setAutoFillMessage(
      addedCount > 0 ? `자동 매핑 적용됨 (${addedCount}개)` : "추가로 매핑된 항목 없음"
    );
    onChange({ ...m, fields: next });
  }

  const unknownUnmapped = unknownRequired.filter((k) => m.fields[k] === undefined);
  const unknownNeedsFix = m.structureType === "unknown" && unknownUnmapped.length > 0;
  const multiItemNeedsFix = isMultiItem && (m.fields.name === undefined || selectedProductColumns.length === 0);
  const formOff = disabled || loading;

  type MappedFieldRole = (typeof FIELD_ROLES_MAP)[number];
  function renderMappedFieldRow(role: MappedFieldRole): ReactNode {
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
  }

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
            <option value="multi_item_personal_order">{STRUCTURE_TYPE_LABEL.multi_item_personal_order}</option>
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
          {autoFillMessage ? (
            <span className="size-analysis-map-autofill-feedback size-analysis-muted" role="status">
              {autoFillMessage}
            </span>
          ) : null}
        </div>
      ) : null}
      {unknownNeedsFix ? (
        <p className="size-analysis-field-warning" role="alert">
          <strong>직접 매핑</strong>에서는 <strong>이름</strong>을 지정해 주세요.
          {!hasSizeColumn ? " 주문내용은 사이즈 열이 없을 때만 필요합니다." : ""} · 미지정:{" "}
          {unknownUnmapped.map((k) => FIELD_ROLE_LABEL[k] ?? k).join(", ")}
        </p>
      ) : null}
      {multiItemNeedsFix ? (
        <p className="size-analysis-field-warning" role="alert">
          <strong>다품목 개인주문형</strong>에서는 <strong>이름</strong>과 <strong>상품 컬럼 1개 이상</strong>을 지정해 주세요.
        </p>
      ) : null}
      {isMultiItem && hasPreview ? (
        <div className="size-analysis-field-row size-analysis-field-row--role-item size-analysis-product-cols-card">
          <span className="size-analysis-field-row__label">
            상품 컬럼(복수 선택)
            <span className="size-analysis-product-cols-note">공용 사이즈는 상품 헤더에 (공용) 표시</span>
          </span>
          <div className="size-analysis-product-cols-grid" role="group" aria-label="상품 컬럼 복수 선택">
            {Array.from({ length: maxCols }, (_, i) => {
              const checked = selectedProductColumns.includes(i);
              const disabledByCore = coreFieldSet.has(i);
              return (
                <button
                  key={`prod-col-${i}`}
                  type="button"
                  className={[
                    "size-analysis-product-chip",
                    checked && "size-analysis-product-chip--selected",
                    disabledByCore && "size-analysis-product-chip--disabled",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={checked}
                  title={productChipLabel(i)}
                    disabled={formOff || disabledByCore}
                  onClick={() => toggleProductColumn(i)}
                >
                  <span className="size-analysis-product-chip__text">{productChipLabel(i)}</span>
                  {checked ? <span className="size-analysis-product-chip__check">✓</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {duplicateCols.length > 0 ? (
        <p className="size-analysis-field-warning" role="alert">
          같은 열이 여러 필드에 지정됨(검토): 열 {duplicateCols.map((c) => c + 1).join(", ")}
        </p>
      ) : null}
      <div className="size-analysis-map-fields">
        {FIELD_ROLES_MAP.map((role) => renderMappedFieldRow(role))}
      </div>
      {hasPreview ? (
        showRemapGuide ? (
          <p className="size-analysis-muted size-analysis-map-hint-2">
            자동 매핑에서 누락된 항목만 다시 매핑한 뒤 <strong>매핑 완료</strong>를 눌러주세요.
          </p>
        ) : (
          <p className="size-analysis-muted size-analysis-map-hint-2">열 순서만 선택해 맞추면 됩니다.</p>
        )
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
          {loading ? "저장중..." : saved ? "매핑 완료됨" : "매핑 시작"}
        </button>
      </div>
    </div>
  );
}

export function DetailViewSwitch({
  mode,
  onChange,
  structureType,
}: {
  mode: "all" | "club" | "duplicates" | "clubMembers";
  onChange: (mode: "all" | "club" | "duplicates" | "clubMembers") => void;
  structureType?: StructureType;
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
          {structureType === "multi_item_personal_order" ? "상품별 집계" : "클럽별 보기"}
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
          {structureType === "multi_item_personal_order" ? "주문 명단" : "클럽별 명단"}
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
        중복(클럽·이름·사이즈) 그룹만 표시하며, 수량 0/빈 값은 숨김
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

export function ClubMembersView({
  allRows,
  duplicateRowIds,
  structureType,
}: {
  allRows: any[];
  duplicateRowIds: Set<string>;
  structureType?: StructureType;
}) {
  const isMultiItem = structureType === "multi_item_personal_order";
  type MemberAggRow = {
    name: string;
    item: string;
    gender: string;
    size: string;
    qty: number;
    hasDup: boolean;
    hasSizeCheck: boolean;
  };
  const [includeDuplicates, setIncludeDuplicates] = useState(true);
  const [expandedClubs, setExpandedClubs] = useState<Set<string>>(new Set());

  const sections = useMemo(() => {
    const byClub = new Map<string, Map<string, MemberAggRow>>();
    for (let i = 0; i < allRows.length; i += 1) {
      const r = allRows[i]!;
      const isDup = duplicateRowIds.has(stableRowKeyForDup(r, i));
      const st = String(r?.parseStatus ?? "").trim();
      const excludeReason = String(r?.excludeReason ?? "").trim();
      const isDuplicateExcludedRow =
        (Boolean(r?.excluded) || st === "excluded") &&
        (excludeReason.startsWith("duplicate_") || excludeReason === "duplicate_person_group");
      const includeByFinal =
        !Boolean(r?.excluded) &&
        (st === "auto_confirmed" || st === "corrected" || st === "unresolved");
      const includeByDupToggle = includeDuplicates && (isDup || isDuplicateExcludedRow);
      if (!includeByFinal && !includeByDupToggle) continue;
      const club = normClubFromNormRow(r);
      const name = String(r?.memberNameRaw ?? r?.memberName ?? "").trim() || "(이름 없음)";
      const item = isMultiItem ? String(r?.itemRaw ?? "").trim() || "미지정 상품" : "";
      const parsed = isMultiItem ? productAggGenderAndSizeFromRow(r) : matrixAggGenderAndSizeFromRow(r);
      const gender = String(parsed.gender ?? "").trim() || "미분류";
      const size = String(parsed.size ?? "").trim() || "미분류";
      const qty = rowQtyParsed(r);
      const key = isMultiItem ? `${name}\0${item}\0${gender}\0${size}` : `${name}\0${gender}\0${size}`;
      if (!byClub.has(club)) byClub.set(club, new Map());
      const rowMap = byClub.get(club)!;
      const cur = rowMap.get(key) ?? { name, item, gender, size, qty: 0, hasDup: false, hasSizeCheck: false };
      cur.qty += qty;
      if (isDup) cur.hasDup = true;
      if (shouldPrioritizeSizeCheckUiDisplay(r)) cur.hasSizeCheck = true;
      rowMap.set(key, cur);
    }

    const dupByClub = new Map<string, { persons: number; sheets: number }>();
    for (let i = 0; i < allRows.length; i += 1) {
      const r = allRows[i]!;
      if (!duplicateRowIds.has(stableRowKeyForDup(r, i))) continue;
      const club = normClubFromNormRow(r);
      const d = dupByClub.get(club) ?? { persons: 0, sheets: 0 };
      d.persons += 1;
      d.sheets += rowQtyParsed(r);
      dupByClub.set(club, d);
    }

    return Array.from(byClub.entries())
    .map(([club, rowMap]) => ({
      club,
      totalQty: Array.from(rowMap.values()).reduce((sum, row) => sum + row.qty, 0),
      displaySummary: computeClubDisplaySummaryStats(
        allRows,
        club,
        allRows[0]?.metaJson?.structureType as StructureType | undefined
      ),
      dupSummary: dupByClub.get(club) ?? { persons: 0, sheets: 0 },
      rows: Array.from(rowMap.values()).sort(
        (a, b) =>
          a.name.localeCompare(b.name, "ko") ||
          a.item.localeCompare(b.item, "ko") ||
          compareGenderForClubSize(a.gender, b.gender) ||
          compareSizeLabel(a.size, b.size)
      ),
    }))
    .filter((sec) => sec.rows.length > 0)
    .sort((a, b) => a.club.localeCompare(b.club, "ko"));
  }, [allRows, duplicateRowIds, includeDuplicates, isMultiItem]);

  function toggleClub(club: string) {
    setExpandedClubs((prev) => {
      const next = new Set(prev);
      if (next.has(club)) next.delete(club);
      else next.add(club);
      return next;
    });
  }

  if (sections.length === 0) {
    return (
      <section className="size-analysis-card">
        <h3>{isMultiItem ? "주문 명단" : "클럽별 명단"}</h3>
        <p className="size-analysis-muted">표시할 명단이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="size-analysis-card size-analysis-club-members-section">
      <h3>{isMultiItem ? "주문 명단" : "클럽별 명단"}</h3>
      <p className="size-analysis-muted size-analysis-club-members-desc">
        {isMultiItem
          ? "클럽별로 같은 이름·상품명·성별·사이즈 수량을 합산해 표시합니다."
          : "클럽별로 같은 이름·성별·사이즈 수량을 합산해 표시합니다."}
      </p>
      <label className="size-analysis-muted size-analysis-include-toggle">
        <input
          type="checkbox"
          checked={includeDuplicates}
          onChange={(e) => setIncludeDuplicates(e.target.checked)}
        />
        중복자 포함
      </label>

      <div className="size-analysis-dup-only-list--mobile">
        {sections.map((sec) => (
          <article key={sec.club} className="size-analysis-club-group-card">
            <button
              type="button"
              className="size-analysis-club-group-head"
              onClick={() => toggleClub(sec.club)}
              aria-expanded={expandedClubs.has(sec.club)}
              aria-label={`${sec.club} 명단 ${expandedClubs.has(sec.club) ? "접기" : "펼치기"}`}
            >
              <span className="size-analysis-club-group-head__name">
                <span className="size-analysis-club-group-head__clubtitle">{sec.club}</span>
                <span className="size-analysis-club-group-head__summary size-analysis-muted">
                  총 인원 {sec.displaySummary.totalPersons}명 / 사이즈 수량 {sec.displaySummary.sizedQtySum}개 / 미입력{" "}
                  {sec.displaySummary.missingSizePersons}명
                  {sec.dupSummary.persons > 0 ? ` / 중복 ${sec.dupSummary.persons}명·${sec.dupSummary.sheets}개` : ""}
                </span>
              </span>
              <span className="size-analysis-club-group-head__right">
                <span className="size-analysis-club-group-chevron" aria-hidden>
                  <svg
                    className={
                      expandedClubs.has(sec.club)
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
            {expandedClubs.has(sec.club) ? (
              <div
                className={[
                  "size-analysis-dup-pc-table-scroll",
                  isMultiItem && "size-analysis-order-list-scroll",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <table
                  className={[
                    "size-analysis-dup-pc-table",
                    isMultiItem && "size-analysis-order-list-table",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {!isMultiItem ? (
                    <colgroup>
                      <col className="size-analysis-club-members-col-name" />
                      <col className="size-analysis-club-members-col-gender" />
                      <col className="size-analysis-club-members-col-size" />
                      <col className="size-analysis-club-members-col-qty" />
                    </colgroup>
                  ) : null}
                  <thead>
                    <tr>
                      <th scope="col">이름</th>
                      {isMultiItem ? <th scope="col">상품명</th> : null}
                      <th scope="col">성별</th>
                      <th scope="col">사이즈</th>
                      <th scope="col">수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((row) => (
                      <tr
                        key={`${sec.club}\0${row.name}\0${row.item}\0${row.gender}\0${row.size}`}
                        className={[
                          row.hasDup ? "size-analysis-club-members-row--dup" : "",
                          row.hasSizeCheck ? "size-analysis-club-members-row--size-check" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td>
                          {row.name}{" "}
                          {row.hasDup ? <span className="size-analysis-dup-line-tag--dup">중복</span> : null}
                          {row.hasSizeCheck ? (
                            <span className="size-analysis-dup-line-tag--size-check">사이즈 확인</span>
                          ) : null}
                        </td>
                        {isMultiItem ? (
                          <td>
                            <span className="size-analysis-order-item-text" title={row.item}>
                              {row.item}
                            </span>
                          </td>
                        ) : null}
                        <td>{row.gender}</td>
                        <td>{row.size}</td>
                        <td>{row.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <div className="size-analysis-dup-pc-wrap" aria-label="클럽별 명단 표(PC)">
        {sections.map((sec) => (
          <div key={`${sec.club}-pc`} className="size-analysis-dup-pc-club">
            <h4 className="size-analysis-dup-pc-club__title">{sec.club} ({sec.totalQty}개)</h4>
            <div
              className={[
                "size-analysis-dup-pc-table-scroll",
                isMultiItem && "size-analysis-order-list-scroll",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <table
                className={[
                  "size-analysis-dup-pc-table",
                  isMultiItem && "size-analysis-order-list-table",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <thead>
                  <tr>
                    <th scope="col">이름</th>
                    {isMultiItem ? <th scope="col">상품명</th> : null}
                    <th scope="col">성별</th>
                    <th scope="col">사이즈</th>
                    <th scope="col">수량</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((row) => (
                    <tr
                      key={`${sec.club}\0${row.name}\0${row.item}\0${row.gender}\0${row.size}`}
                      className={[
                        row.hasDup ? "size-analysis-club-members-row--dup" : "",
                        row.hasSizeCheck ? "size-analysis-club-members-row--size-check" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <td>
                        {row.name}{" "}
                        {row.hasDup ? <span className="size-analysis-dup-line-tag--dup">중복</span> : null}
                        {row.hasSizeCheck ? (
                          <span className="size-analysis-dup-line-tag--size-check">사이즈 확인</span>
                        ) : null}
                      </td>
                      {isMultiItem ? (
                        <td>
                          <span className="size-analysis-order-item-text" title={row.item}>
                            {row.item}
                          </span>
                        </td>
                      ) : null}
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
  structureType,
}: {
  dupByClub?: Map<string, { persons: number; sheets: number }>;
  duplicateRowIds: Set<string>;
  normRows: any[];
  structureType?: StructureType;
  rows: Array<{
    club: string;
    totalQty: number;
    displaySummary: ClubDisplaySummaryStats;
    rows: Array<{ gender: string; size: string; qty: number; hasReview: boolean; hasUnresolved: boolean }>;
  }>;
}) {
  const isMultiItem = structureType === "multi_item_personal_order";
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
      { modeKey: "total" as const, label: "전체 합계", flat: buildAggRowsTotal(normRows, duplicateRowIds) },
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
          let hasSizeCheck = false;
          for (const clubName of rows.map((x) => x.club)) {
            const meta = statusByCell.get(`${clubName}\0${gk}\0${sz}`);
            if (!meta) continue;
            hasReview = hasReview || meta.hasReview;
            hasUnres = hasUnres || meta.hasUnres;
            hasCorrected = hasCorrected || meta.hasCorrected;
            hasSizeCheck = hasSizeCheck || meta.hasSizeCheck;
            if (hasReview && hasUnres && hasCorrected && hasSizeCheck) break;
          }
          return { hasReview, hasUnres, hasCorrected, hasSizeCheck };
        },
      };
    });
  }, [normRows, duplicateRowIds, rows]);

  /** 모바일 아코디언: 엑셀 클럽별집계와 동일 총/제외/중복 3블록(집계 함수 재사용) */
  const mobileClubTripleMatrices = useMemo(() => {
    const statusByCell = buildCellStatusMap(normRows);
    const flatTotal = buildAggRowsTotal(normRows, duplicateRowIds);
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

  const mobileClubProductMatrices = useMemo(() => {
    if (!isMultiItem) return [];
    const statusByProductCell = new Map<string, ClubAggCellMeta>();
    for (const r of normRows ?? []) {
      if (r.excluded) continue;
      const club = normClubFromNormRow(r);
      const product = String(r?.itemRaw ?? "").trim();
      if (!product) continue;
      const { gender: gDisp, size: sDisp } = productAggGenderAndSizeFromRow(r);
      const gk = rowKeyGenderForAgg(gDisp);
      const size = sDisp || "미분류";
      const key = `${club}\0${product}\0${gk}\0${size}`;
      const st = String(r.parseStatus ?? "");
      const cur =
        statusByProductCell.get(key) ?? {
          hasReview: false,
          hasUnres: false,
          hasCorrected: false,
          hasSizeCheck: false,
        };
      if (st === "needs_review") cur.hasReview = true;
      if (st === "unresolved") cur.hasUnres = true;
      if (st === "corrected") cur.hasCorrected = true;
      if (shouldPrioritizeSizeCheckUiDisplay(r)) cur.hasSizeCheck = true;
      statusByProductCell.set(key, cur);
    }

    const clubNames = rows.map((r) => r.club);
    return clubNames.map((clubName) => {
      const byProduct = new Map<string, Array<{ club: string; gender: string; size: string; qty: number }>>();
      for (let i = 0; i < normRows.length; i += 1) {
        const r = normRows[i]!;
        if (normClubFromNormRow(r) !== clubName) continue;
        if (!rowIncludedInFinalAggregation(r)) continue;
        const product = String(r?.itemRaw ?? "").trim();
        if (!product) continue;
        const { gender, size } = productAggGenderAndSizeFromRow(r);
        const list = byProduct.get(product) ?? [];
        list.push({ club: clubName, gender, size, qty: rowQtyParsed(r) });
        byProduct.set(product, list);
      }
      const productOrder = new Map<string, number>();
      for (const r of normRows) {
        if (normClubFromNormRow(r) !== clubName) continue;
        const product = String(r?.itemRaw ?? "").trim();
        if (!product) continue;
        const rawIdx =
          typeof r?.metaJson?.productColumnIndex === "number"
            ? Number(r.metaJson.productColumnIndex)
            : Number(r?.sourceGroupIndex);
        if (!Number.isFinite(rawIdx)) continue;
        const prev = productOrder.get(product);
        if (prev === undefined || rawIdx < prev) {
          productOrder.set(product, rawIdx);
        }
      }

      return Array.from(byProduct.entries())
        .sort((a, b) => {
          const ai = productOrder.get(a[0]);
          const bi = productOrder.get(b[0]);
          if (ai !== undefined && bi !== undefined) return ai - bi;
          if (ai !== undefined) return -1;
          if (bi !== undefined) return 1;
          return a[0].localeCompare(b[0], "ko");
        })
        .map(([product, productRows]) => {
          const sizes = buildColumnSizesForClub(productRows);
          const rowKeys = matrixRowKeysForProductRows(productRows);
          const qtyMap = new Map<string, number>();
          for (const r of productRows) {
            const gk = rowKeyGenderForAgg(r.gender);
            const key = `${gk}\0${r.size}`;
            qtyMap.set(key, (qtyMap.get(key) ?? 0) + r.qty);
          }
          const totalQty = productRows.reduce((sum, row) => sum + row.qty, 0);
          return {
            modeKey: `product-${product}`,
            shortLabel: `${product} (${totalQty}개)`,
            headlineAriaLabel: `${clubName} · ${product}`,
            isDuplicateMatrix: false,
            sizes,
            rowKeys,
            qtyMap,
            resolveMeta: (gk: "여" | "남" | "공용", sz: string) =>
              statusByProductCell.get(`${clubName}\0${product}\0${gk}\0${sz}`) ?? EMPTY_CLUB_AGG_META,
          };
        });
    });
  }, [rows, normRows, isMultiItem]);

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
      {isMultiItem ? (
        <p className="size-analysis-muted size-analysis-club-group-hint">
          클럽을 펼치면 상품별(상의/하의/바람막이 등) 매트릭스가 세로로 모두 표시됩니다.
        </p>
      ) : null}
      {!isMultiItem ? (
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
      ) : null}
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
                    {(isMultiItem ? mobileClubProductMatrices[idx] : mobileClubTripleMatrices[idx])!.map((blk) => (
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

/** 결과 요약 다품목 카드 라벨: 상품명만 표시(예: 바람막이(공용) → 바람막이) */
function formatProductSummaryCardLabel(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return s;
  const shortened = s.replace(/\s*\(공용\)\s*$/u, "").trim();
  return shortened || s;
}

type SummaryCardVisual = "hero" | "emphasis" | "default";

export function AnalysisSummaryCards({
  summary,
  duplicateAnalysis,
  allRows,
  statusFilter,
  outsideSizesAssistActive = false,
  outsideAssistEligibleCount,
  structureType,
}: {
  summary: any;
  duplicateAnalysis: DuplicateAnalysis;
  allRows: any[];
  statusFilter: string;
  /** 전체 목록 확인용 표시 필터 활성(UI만) */
  outsideSizesAssistActive?: boolean;
  /** 전체 목록 행 중 범위외 사이즈(중복 제외 제외 행 미포함). 집계와 무관 · 표시 전용 */
  outsideAssistEligibleCount: number;
  structureType?: StructureType;
}) {
  if (!summary) return null;
  const totalQty = duplicateAnalysis.totalQty;
  const filterLabel = STATUS_FILTER_LABEL[statusFilter as (typeof STATUS_FILTER_OPTIONS)[number]] ?? statusFilter;
  const cards: Array<{ label: string; value: string | number; visual: SummaryCardVisual }> = [
    { label: "총수량", value: summary.totalRows, visual: "hero" },
    { label: "기본 수량", value: totalQty, visual: "emphasis" },
    { label: "중복 수량", value: duplicateAnalysis.duplicateQtyTotal, visual: "emphasis" },
    { label: "검토필요", value: summary.needs_review, visual: "default" },
    { label: "수정완료", value: summary.corrected, visual: "default" },
    { label: "미분류", value: summary.unresolved, visual: "default" },
    { label: "빈 수량", value: summary.excludedEmptyQtyCount ?? 0, visual: "default" },
    { label: "범위외 사이즈", value: outsideAssistEligibleCount, visual: "default" },
  ];
  if (structureType === "multi_item_personal_order") {
    const byProduct = new Map<string, number>();
    for (const r of allRows) {
      if (!rowIncludedInFinalAggregation(r)) continue;
      const product = String(r?.itemRaw ?? "").trim() || "미지정 상품";
      byProduct.set(product, (byProduct.get(product) ?? 0) + rowQtyParsed(r));
    }
    for (const [product, qty] of [...byProduct.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"))) {
      cards.push({ label: formatProductSummaryCardLabel(product), value: qty, visual: "default" });
    }
  }
  return (
    <section className="size-analysis-card">
      <h3>5) 결과 요약</h3>
      <p className="size-analysis-muted size-analysis-summary-scope-hint">
        중복 신청자는 추가 지급 대상으로 포함됩니다.
        <br />
        총 수량 = 기본 수량 + 중복 수량 기준입니다.
        <br />
        검토필요와 미분류는 확인 후 집계에 반영하세요.
        {statusFilter !== "all" || outsideSizesAssistActive ? (
          <>
            <br />
            (현재 표시 필터: {filterLabel}
            {outsideSizesAssistActive
              ? ` · 범위외 사이즈(표시 확인 · ${outsideAssistEligibleCount})`
              : ""}
            )
          </>
        ) : null}
      </p>
      <div className="size-analysis-summary-cards">
        {cards.map((c, idx) => (
          <article
            key={`${c.label}-${idx}`}
            className={[
              "size-analysis-summary-card",
              c.visual === "hero" && "size-analysis-summary-card--hero",
              c.visual === "emphasis" && "size-analysis-summary-card--emphasis",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="size-analysis-summary-card__label">{c.label}</div>
            <strong className="size-analysis-summary-card__value">{String(c.value)}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AnalysisStatusFilter({
  value,
  onChange,
  outsideSizesAssistActive,
  onOutsideSizesAssistChange,
  outsideAssistEligibleCount,
  needsReviewCount,
}: {
  value: string;
  onChange: (v: string) => void;
  outsideSizesAssistActive: boolean;
  onOutsideSizesAssistChange: (next: boolean) => void;
  outsideAssistEligibleCount: number;
  /** 요약 기준 검토필요 건수 — 0 초과일 때만 버튼에 (n) 표시 */
  needsReviewCount: number;
}) {
  return (
    <section className="size-analysis-card">
      <h3>6) 상태 필터</h3>
      <div className="size-analysis-filter-row size-analysis-filter-row--status-radio" role="group" aria-label="상태·범위외 표시 필터">
        {STATUS_FILTER_OPTIONS.map((opt, idx) => {
          const active = opt === value && !outsideSizesAssistActive;
          const labelBase = STATUS_FILTER_LABEL[opt];
          const label =
            opt === "needs_review" && needsReviewCount > 0
              ? `${labelBase} (${needsReviewCount})`
              : labelBase;
          return (
            <button
              key={opt}
              className={`btn ${active ? "btn-primary" : "btn-secondary"} ${idx === 0 ? "size-analysis-filter-btn--all" : ""}`}
              onClick={() => void onChange(opt)}
              type="button"
              aria-pressed={active}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          className={`btn ${outsideSizesAssistActive ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={outsideSizesAssistActive}
          onClick={() => onOutsideSizesAssistChange(!outsideSizesAssistActive)}
        >
          범위외 사이즈 ({outsideAssistEligibleCount})
        </button>
      </div>
    </section>
  );
}

function normalizedRowLine1(r: any): string {
  const club = String(r.clubNameRaw ?? "").trim();
  const name = String(r.memberNameRaw ?? "").trim();
  const gender = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
  const size = displaySizeWithWarning(r);
  const item = String(r.itemRaw ?? "").trim();
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
  if (item) parts.push(item);
  if (qtyStr) parts.push(qtyStr);
  return parts.join(" · ");
}

/** 모바일 요약: 검토/미분류/수정완료는 뱃지로, 본문에는 원본행·신뢰도만(중복 강조 방지) */
function normalizedRowLine2Parts(r: any): {
  subline: string;
  pill: "needs_review" | "unresolved" | "corrected" | "size_check" | null;
} {
  const src =
    r.sourceRowIndex != null && r.sourceRowIndex !== "" ? `원본행 ${r.sourceRowIndex}` : "";
  const conf = `신뢰도 ${displayParseConfidenceUi(r).toFixed(2)}`;
  const st = String(r.parseStatus ?? "");
  if (st === "excluded" || r.excluded) {
    const rsn = displayReasonForNormalizedRow(r);
    return {
      subline: [src, rsn, conf].filter((x) => x && x.length > 0).join(" · "),
      pill: null,
    };
  }
  if (shouldPrioritizeSizeCheckUiDisplay(r)) {
    const rsn = displayReasonForNormalizedRow(r);
    return {
      subline: [src, rsn, conf].filter((x) => x && x.length > 0).join(" · "),
      pill: "size_check",
    };
  }
  if (st === "needs_review" || st === "unresolved" || st === "corrected") {
    const rsn = displayReasonForNormalizedRow(r);
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

function normCompactClassForRow(r: any): string {
  if (shouldPrioritizeSizeCheckUiDisplay(r)) return "size-analysis-norm-compact size-analysis-norm-compact--size-check";
  return normCompactClass(r.parseStatus);
}

export function AnalysisRowsTable({
  rows,
  duplicateRowIds,
  onToggleIncludeNameMissingRow,
  showItemColumn = false,
}: {
  rows: any[];
  duplicateRowIds: Set<string>;
  onToggleIncludeNameMissingRow?: (row: any, include: boolean) => Promise<void>;
  showItemColumn?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="size-analysis-card size-analysis-norm-section">
      <div className="size-analysis-collapsible-head">
        <h3>7) 정규화 행</h3>
        <button
          type="button"
          className="btn btn-secondary size-analysis-collapsible-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="size-analysis-normalized-rows-panel"
        >
          {expanded ? "접기" : "펼치기"}
        </button>
      </div>
      <div
        id="size-analysis-normalized-rows-panel"
        className={["size-analysis-collapsible-body", !expanded && "size-analysis-collapsible-body--collapsed"]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="size-analysis-norm-compact-list size-analysis-norm-compact-list--mobile" aria-label="정규화 행(요약)">
        {rows.map((r, i) => {
          const { subline, pill } = normalizedRowLine2Parts(r);
          const isDup = duplicateRowIds.has(stableRowKeyForDup(r, i));
          return (
            <article key={stableRowKeyForDup(r, i)} className={normCompactClassForRow(r)}>
              <p className="size-analysis-norm-compact__line1">
                <span className="size-analysis-norm-compact__line1-text">{normalizedRowLine1(r)}</span>
                {isDup ? <span className="size-analysis-dup-badge">중복</span> : null}
              </p>
              <div className="size-analysis-norm-compact__row2">
                <p className="size-analysis-norm-compact__line2">{subline}</p>
                {isNameMissingRow(r) && (r.parseStatus === "needs_review" || r.parseStatus === "corrected") ? (
                  <label className="size-analysis-muted" style={{ marginLeft: 8 }}>
                    <input
                      type="checkbox"
                      checked={String(r.parseStatus ?? "") === "corrected"}
                      onChange={(e) => void onToggleIncludeNameMissingRow?.(r, e.target.checked)}
                    />{" "}
                    수량 포함
                  </label>
                ) : null}
                {pill === "needs_review" ? (
                  <span className="size-analysis-mini-pill size-analysis-mini-pill--review">검토필요</span>
                ) : pill === "unresolved" ? (
                  <span className="size-analysis-mini-pill size-analysis-mini-pill--unresolved">미분류</span>
                ) : pill === "corrected" ? (
                  <span className="size-analysis-mini-pill size-analysis-mini-pill--corrected">수정완료</span>
                ) : pill === "size_check" ? (
                  <span className="size-analysis-mini-pill size-analysis-mini-pill--size-check">사이즈 확인</span>
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
              {showItemColumn ? <th>상품명</th> : null}
              <th>사이즈</th>
              <th>수량</th>
              <th>상태</th>
              <th>사유</th>
              <th className="size-analysis-include-col">수량 포함</th>
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
                  {showItemColumn ? <td data-label="상품명">{r.itemRaw ?? ""}</td> : null}
                  <td data-label="사이즈">{displaySizeWithWarning(r)}</td>
                  <td data-label="수량">{r.qtyParsed ?? r.qtyRaw ?? ""}</td>
                  <td data-label="상태">{labelNormalizedRowParseStatusUi(r)}</td>
                  <td data-label="사유">{displayReasonForNormalizedRow(r)}</td>
                  <td data-label="수량 포함" className="size-analysis-include-col">
                    {isNameMissingRow(r) && (r.parseStatus === "needs_review" || r.parseStatus === "corrected") ? (
                      <label className="size-analysis-include-toggle">
                        <input
                          type="checkbox"
                          checked={String(r.parseStatus ?? "") === "corrected"}
                          onChange={(e) => void onToggleIncludeNameMissingRow?.(r, e.target.checked)}
                        />{" "}
                        수량 포함
                      </label>
                    ) : (
                      ""
                    )}
                  </td>
                  <td data-label="신뢰도">{displayParseConfidenceUi(r).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
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

type CellMeta = {
  hasReview: boolean;
  hasUnres: boolean;
  hasCorrected: boolean;
  hasSizeCheck: boolean;
};
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
    const cur =
      map.get(key) ?? { hasReview: false, hasUnres: false, hasCorrected: false, hasSizeCheck: false };
    if (st === "needs_review") cur.hasReview = true;
    if (st === "unresolved") cur.hasUnres = true;
    if (st === "corrected") cur.hasCorrected = true;
    if (shouldPrioritizeSizeCheckUiDisplay(r)) cur.hasSizeCheck = true;
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

function normalizeUnisexSizeLabel(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "미분류";
  const mw = t.match(/^[MW]\s*(\d{2,3})$/i);
  if (mw?.[1]) return mw[1];
  const num = t.match(/(?:^|[^0-9])(80|85|90|95|100|105|110|115|120)(?![0-9])/);
  if (num?.[1]) return num[1];
  return "미분류";
}

function productAggGenderAndSizeFromRow(r: any): { gender: string; size: string } {
  const productName = String(r?.itemRaw ?? "").trim();
  if (/공용/i.test(productName)) {
    const size = normalizeUnisexSizeLabel(String(r?.standardizedSize ?? r?.sizeRaw ?? ""));
    return { gender: "공용", size };
  }
  return matrixAggGenderAndSizeFromRow(r);
}

function matrixRowKeysForProductRows(rows: Array<{ gender: string }>): Array<"여" | "남" | "공용"> {
  if (rows.length > 0 && rows.every((r) => rowKeyGenderForAgg(r.gender) === "공용")) {
    return ["공용"];
  }
  return matrixGenderRowKeys(rows);
}

type ClubAggCellMeta = {
  hasReview: boolean;
  hasUnres: boolean;
  hasCorrected: boolean;
  hasSizeCheck: boolean;
};

const EMPTY_CLUB_AGG_META: ClubAggCellMeta = {
  hasReview: false,
  hasUnres: false,
  hasCorrected: false,
  hasSizeCheck: false,
};

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
              {sizes.map((sz) => {
                const colHasSizeCheck = rowKeys.some((rk) => resolveMeta(rk, sz).hasSizeCheck);
                return (
                  <th
                    key={sz}
                    scope="col"
                    className={colHasSizeCheck ? "size-analysis-club-agg-mtx-col--size-check" : undefined}
                  >
                    {sz}
                  </th>
                );
              })}
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
                    if (meta.hasSizeCheck) stBits.push("사이즈 확인");
                    if (meta.hasReview) stBits.push("검토필요");
                    if (meta.hasUnres) stBits.push("미분류");
                    if (meta.hasCorrected) stBits.push("수정완료");
                  } else if (meta.hasSizeCheck) {
                    stBits.push("사이즈 확인");
                  }
                  const stLabel = stBits.length ? stBits.join(", ") : undefined;
                  let stateClass = "";
                  if (isDuplicateMatrix && q > 0) {
                    stateClass = "size-analysis-club-agg-mtx-cell--duplicate";
                    if (meta.hasSizeCheck) stateClass += " size-analysis-club-agg-mtx-cell--size-check-hint";
                  } else if (!isDuplicateMatrix) {
                    if (meta.hasSizeCheck) stateClass = "size-analysis-club-agg-mtx-cell--size-check";
                    else if (meta.hasReview) stateClass = "size-analysis-club-agg-mtx-cell--review";
                    else if (meta.hasUnres) stateClass = "size-analysis-club-agg-mtx-cell--unres";
                    else if (meta.hasCorrected) stateClass = "size-analysis-club-agg-mtx-cell--corrected";
                  }
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
    if (aggMode === "total") return buildAggRowsTotal(normRows, duplicateRowIds);
    if (aggMode === "duplicate") return buildAggRowsDuplicate(normRows, duplicateRowIds);
    return buildAggRowsDedupedFirst(normRows, duplicateRowIds);
  }, [normRows, aggMode, duplicateRowIds]);

  const baseClubs = useMemo(
    () =>
      Array.from(
        new Set(
          (normRows ?? [])
            .map((r) => normClubFromNormRow(r))
            .filter((club) => String(club ?? "").trim().length > 0)
        )
      ).sort((a, b) => a.localeCompare(b, "ko")),
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
        className="size-analysis-agg-mode-tabs size-analysis-agg-mode-tabs--triple"
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
            isDuplicateMatrix={aggMode === "duplicate"}
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

export function ProductSizeSummaryTable({
  normRows,
  duplicateRowIds,
}: {
  normRows: any[];
  duplicateRowIds: Set<string>;
}) {
  const [aggMode, setAggMode] = useState<ClubSizeAggMode>("total");

  const products = useMemo(
    () =>
      Array.from(
        new Set(
          (normRows ?? [])
            .map((r) => String(r?.itemRaw ?? "").trim())
            .filter((x) => x.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b, "ko")),
    [normRows]
  );
  const [activeProduct, setActiveProduct] = useState<string>("");

  useEffect(() => {
    if (products.length === 0) {
      setActiveProduct("");
      return;
    }
    if (!activeProduct || !products.includes(activeProduct)) {
      setActiveProduct(products[0]!);
    }
  }, [products, activeProduct]);

  const statusByCell = useMemo(() => {
    const map = new Map<string, ClubAggCellMeta>();
    for (const r of normRows ?? []) {
      if (r.excluded) continue;
      const product = String(r?.itemRaw ?? "").trim();
      if (!product) continue;
      const { gender: gDisp, size: sDisp } = productAggGenderAndSizeFromRow(r);
      const gk = rowKeyGenderForAgg(gDisp);
      const size = sDisp || "미분류";
      const key = `${product}\0${gk}\0${size}`;
      const st = String(r.parseStatus ?? "");
      const cur =
        map.get(key) ?? { hasReview: false, hasUnres: false, hasCorrected: false, hasSizeCheck: false };
      if (st === "needs_review") cur.hasReview = true;
      if (st === "unresolved") cur.hasUnres = true;
      if (st === "corrected") cur.hasCorrected = true;
      if (shouldPrioritizeSizeCheckUiDisplay(r)) cur.hasSizeCheck = true;
      map.set(key, cur);
    }
    return map;
  }, [normRows]);

  const blocks = useMemo(() => {
    return products.map((product) => {
      const flatRows: Array<{ club: string; gender: string; size: string; qty: number }> = [];
      for (let i = 0; i < normRows.length; i += 1) {
        const r = normRows[i]!;
        const item = String(r?.itemRaw ?? "").trim();
        if (item !== product) continue;
        const key = stableRowKeyForDup(r, i);
        const isDup = duplicateRowIds.has(key);
        if (aggMode === "duplicate") {
          if (!isDup) continue;
        } else if (aggMode === "deduped") {
          if (isDup) continue;
        }
        if (aggMode === "total" || aggMode === "deduped") {
          if (!rowIncludedInFinalAggregation(r)) continue;
        } else {
          if (!rowIncludedInDuplicateAggregation(r)) continue;
        }
        const { gender, size } = productAggGenderAndSizeFromRow(r);
        flatRows.push({ club: normClubFromNormRow(r), gender, size, qty: rowQtyParsed(r) });
      }

      const totalQty = flatRows.reduce((s, r) => s + r.qty, 0);
      const sizes = buildColumnSizesForClub(flatRows);
      const rowKeys = matrixRowKeysForProductRows(flatRows);
      const qtyMap = new Map<string, number>();
      for (const r of flatRows) {
        const gk = rowKeyGenderForAgg(r.gender);
        const k = `${gk}\0${r.size}`;
        qtyMap.set(k, (qtyMap.get(k) ?? 0) + r.qty);
      }
      return { product, totalQty, sizes, rowKeys, qtyMap };
    });
  }, [normRows, products, aggMode, duplicateRowIds]);

  if (products.length === 0) return null;
  const active = blocks.find((b) => b.product === activeProduct) ?? blocks[0]!;

  return (
    <section className="size-analysis-card size-analysis-club-size-card size-analysis-club-agg-section">
      <h3>9) 상품별 집계</h3>
      <div
        className="size-analysis-agg-mode-tabs size-analysis-agg-mode-tabs--triple"
        role="tablist"
        aria-label="상품별 집계 기준"
      >
        {(["total", "deduped", "duplicate"] as const).map((m) => (
          <button
            key={`prod-mode-${m}`}
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
      <div className="size-analysis-agg-mode-tabs size-analysis-agg-mode-tabs--double" role="tablist" aria-label="상품 선택">
        {products.map((product) => (
          <button
            key={`prod-tab-${product}`}
            type="button"
            role="tab"
            aria-selected={activeProduct === product}
            className={`size-analysis-agg-mode-tab${activeProduct === product ? " size-analysis-agg-mode-tab--active" : ""}`}
            onClick={() => setActiveProduct(product)}
          >
            {product}
          </button>
        ))}
      </div>
      <p className="size-analysis-muted size-analysis-club-size-hint size-analysis-club-agg-hint">
        선택한 상품의 성별/사이즈별 수량 매트릭스입니다. (총/중복 제외/중복)
      </p>
      <div className="size-analysis-summary-cards">
        {blocks.map((b) => (
          <article key={`prod-card-${b.product}`} className="size-analysis-summary-card">
            <div className="size-analysis-summary-card__label">{b.product}</div>
            <strong className="size-analysis-summary-card__value">{b.totalQty}</strong>
          </article>
        ))}
      </div>
      <div className="size-analysis-club-agg-mtx-host" aria-label="집계(상품별 매트릭스)">
        <ClubAggMatrixTableDesktop
          headline={`${active.product} · ${CLUB_AGG_MODE_LABEL[aggMode]} ${active.totalQty}개`}
          isDuplicateMatrix={aggMode === "duplicate"}
          sizes={active.sizes}
          rowKeys={active.rowKeys}
          qtyMap={active.qtyMap}
          resolveMeta={(gk, sz) => statusByCell.get(`${active.product}\0${gk}\0${sz}`) ?? EMPTY_CLUB_AGG_META}
        />
      </div>
    </section>
  );
}

