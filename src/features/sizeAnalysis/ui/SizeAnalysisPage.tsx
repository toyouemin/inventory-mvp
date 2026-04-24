"use client";

import { useMemo, useState } from "react";

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
  excluded: "제외",
};

const PARSE_STATUS_LABEL: Record<string, string> = {
  auto_confirmed: "자동확정",
  needs_review: "검토필요",
  unresolved: "미분류",
  corrected: "수정완료",
  excluded: "제외",
};

function labelParseStatus(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  return PARSE_STATUS_LABEL[v] ?? v;
}

function labelStructureType(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  return STRUCTURE_TYPE_LABEL[v as Mapping["structureType"]] ?? v;
}

export function SizeAnalysisPage() {
  const [jobId, setJobId] = useState<string>("");
  const [sheets, setSheets] = useState<Array<{ name: string; rowCount: number }>>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [detectResult, setDetectResult] = useState<any>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [mappingSaved, setMappingSaved] = useState(false);
  const [detailViewMode, setDetailViewMode] = useState<"all" | "club">("all");

  const clubSizeRows = useMemo(() => {
    const detail = summary?.clubSizeStatusRows;
    if (Array.isArray(detail) && detail.length > 0) {
      return detail as Array<{ club: string; gender: string; size: string; qty: number }>;
    }
    const obj = summary?.clubSize ?? {};
    const out: Array<{ club: string; gender: string; size: string; qty: number }> = [];
    Object.entries(obj).forEach(([club, sizeMap]) => {
      Object.entries(sizeMap as Record<string, number>).forEach(([size, qty]) => out.push({ club, gender: "", size, qty }));
    });
    return out.sort((a, b) => a.club.localeCompare(b.club, "ko") || compareGenderForClubSize(a.gender, b.gender) || compareSizeLabel(a.size, b.size));
  }, [summary]);

  const clubGroupedRows = useMemo(() => {
    const byClub = new Map<string, { club: string; totalQty: number; rows: Array<{ gender: string; size: string; qty: number; hasReview: boolean; hasUnresolved: boolean }> }>();
    const detailMap = new Map<string, { club: string; gender: string; size: string; qty: number; hasReview: boolean; hasUnresolved: boolean }>();

    for (const r of rows) {
      const club = String(r.clubNameRaw ?? r.clubNameNormalized ?? "미분류").trim() || "미분류";
      const gender = String(r.genderNormalized ?? r.genderRaw ?? "").trim();
      const size = String(r.standardizedSize ?? r.sizeRaw ?? "미분류").trim() || "미분류";
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
      .map((club) => ({
        ...club,
        rows: club.rows.sort(
          (a, b) => compareGenderForClubSize(a.gender, b.gender) || compareSizeLabel(a.size, b.size)
        ),
      }))
      .sort((a, b) => a.club.localeCompare(b.club, "ko"));
  }, [rows]);

  const clubViewDataKey = useMemo(
    () => clubGroupedRows.map((c) => `${c.club}:${c.totalQty}:${c.rows.length}`).join("|"),
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

    const rowsUrl =
      status === "all"
        ? `/api/size-analysis/${id}/rows?excludeExcluded=1`
        : `/api/size-analysis/${id}/rows?status=${encodeURIComponent(status)}`;
    const rowsRes = await fetch(rowsUrl, { cache: "no-store" });
    const rowsJson = await rowsRes.json();
    if (!rowsRes.ok) throw new Error(rowsJson.error ?? "행 조회 실패");
    setRows(rowsJson.rows ?? []);
  }

  async function onStatusChange(next: string) {
    setStatusFilter(next);
    if (jobId) await refreshResult(jobId, next);
  }

  return (
    <main className="size-analysis-page">
      <h2>사이즈 분석</h2>
      <p className="size-analysis-muted">다양한 주문 파일을 사람별 주문행으로 정규화하고 사이즈 추출/표준화를 수행합니다.</p>

      <div className="size-analysis-stage-grid">
        <SizeAnalysisUploadCard onUpload={uploadFile} loading={loading === "upload"} />
        <WorkbookSheetSelector sheets={sheets} selectedSheet={selectedSheet} onSelect={setSelectedSheet} />
        <StructureDetectionPanel
          detectResult={detectResult}
          loading={loading === "detect"}
          onDetect={detectStructureAction}
        />
      </div>

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

      <section className="size-analysis-card">
        <button className="btn btn-primary" onClick={runAction} disabled={!jobId || loading !== ""}>
          {loading === "run" ? "분석 실행 중..." : "분석 실행"}
        </button>
      </section>

      <AnalysisSummaryCards summary={summary} />
      <AnalysisStatusFilter value={statusFilter} onChange={onStatusChange} />
      <div className="size-analysis-result-region">
        <DetailViewSwitch mode={detailViewMode} onChange={setDetailViewMode} />
        {detailViewMode === "all" ? (
        <>
          <AnalysisRowsTable rows={rows} />
            <ClubSizeSummaryTable normRows={rows} rows={clubSizeRows} />
        </>
        ) : (
          <ClubGroupedView key={clubViewDataKey} rows={clubGroupedRows} />
        )}
      </div>

      {error ? <p className="size-analysis-error">{error}</p> : null}
    </main>
  );
}

export function SizeAnalysisUploadCard({ onUpload, loading }: { onUpload: (file: File) => void; loading: boolean }) {
  return (
    <section className="size-analysis-card size-analysis-card--upload">
      <h3>1) 업로드</h3>
      <input
        type="file"
        accept=".xlsx,.csv"
        disabled={loading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
        }}
      />
    </section>
  );
}

export function WorkbookSheetSelector({
  sheets,
  selectedSheet,
  onSelect,
}: {
  sheets: Array<{ name: string; rowCount: number }>;
  selectedSheet: string;
  onSelect: (name: string) => void;
}) {
  return (
    <section className="size-analysis-card size-analysis-card--sheet-select">
      <h3>2) 시트 선택</h3>
      <select value={selectedSheet} onChange={(e) => onSelect(e.target.value)}>
        <option value="">시트 선택</option>
        {sheets.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name} ({s.rowCount}행)
          </option>
        ))}
      </select>
    </section>
  );
}

export function StructureDetectionPanel({
  detectResult,
  loading,
  onDetect,
}: {
  detectResult: any;
  loading: boolean;
  onDetect: () => void;
}) {
  return (
    <section className="size-analysis-card size-analysis-card--detect">
      <h3>3) 구조 분석</h3>
      <button className="btn btn-secondary" onClick={onDetect} disabled={loading}>
        {loading ? "분석 중..." : "헤더/구조 자동 추천"}
      </button>
      {detectResult ? (
        <div className="size-analysis-grid">
          <div>
            추천 헤더 행(1번째=첫 행): <strong>{Number(detectResult.headerRowIndex) + 1}</strong>번째
          </div>
          <div>추천 구조 유형: {labelStructureType(detectResult.structureType)}</div>
        </div>
      ) : null}
    </section>
  );
}

const UNKNOWN_REQUIRED = ["name", "club", "item"] as const;

export function FieldMappingEditor({
  mapping,
  onChange,
  onSave,
  loading,
  saved,
  previewRows,
}: {
  mapping: Mapping | null;
  onChange: (mapping: Mapping) => void;
  onSave: () => void;
  loading: boolean;
  saved: boolean;
  previewRows?: string[][];
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
  const requiredUnknownSet = new Set<string>(UNKNOWN_REQUIRED);

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

  const unknownUnmapped = UNKNOWN_REQUIRED.filter((k) => m.fields[k] === undefined);
  const unknownNeedsFix = m.structureType === "unknown" && unknownUnmapped.length > 0;

  return (
    <section className="size-analysis-card size-analysis-field-mapping">
      <h3>4) 필드 매핑</h3>
      <p className="size-analysis-map-hint size-analysis-muted">
        열 번호는 <strong>1</strong>부터입니다 (A열=1, B열=2, C열=3). · 헤더 행을 맞춘 뒤 열을 선택하세요.
      </p>
      <div className="size-analysis-grid size-analysis-grid--map-tools">
        <label>
          구조 유형
          <select
            className="size-analysis-field-select"
            value={m.structureType}
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
          <button type="button" className="btn btn-secondary size-analysis-btn-auto" onClick={applyHeaderAuto} disabled={loading}>
            헤더 이름으로 자동 채우기
          </button>
        </div>
      ) : null}
      {unknownNeedsFix ? (
        <p className="size-analysis-field-warning" role="alert">
          <strong>직접 매핑</strong>에서는 <strong>이름·클럽·주문내용</strong>을 모두 지정해 주세요. · 미지정:{" "}
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
        <p className="size-analysis-muted size-analysis-map-hint-2">
          먼저 &quot;3) 구조 분석&quot; 후 열을 선택하세요.
        </p>
      )}
      <div className="size-analysis-map-actions">
        <button
          className={`btn ${saved ? "size-analysis-map-save-btn--done" : "btn-secondary"}`}
          onClick={onSave}
          disabled={loading || saved}
          type="button"
        >
          {loading ? "저장중..." : saved ? "매핑 완료" : "매핑확정"}
        </button>
      </div>
    </section>
  );
}

export function DetailViewSwitch({
  mode,
  onChange,
}: {
  mode: "all" | "club";
  onChange: (mode: "all" | "club") => void;
}) {
  return (
    <section className="size-analysis-card size-analysis-view-switch-card">
      <h3 className="size-analysis-view-switch__heading">보기 전환</h3>
      <div
        className="size-analysis-view-switch size-analysis-view-switch--segmented"
        role="group"
        aria-label="결과 보기 전환"
      >
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
}: {
  rows: Array<{
    club: string;
    totalQty: number;
    rows: Array<{ gender: string; size: string; qty: number; hasReview: boolean; hasUnresolved: boolean }>;
  }>;
}) {
  const [expanded, setExpanded] = useState(() => defaultExpandedClubSet(rows));

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
      <div className="size-analysis-club-group-list">
        {rows.map((club, idx) => {
          const isOpen = expanded.has(club.club);
          const panelId = `size-analysis-club-panel-${idx}`;
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
                <span className="size-analysis-club-group-head__name">{club.club}</span>
                <span className="size-analysis-club-group-head__right">
                  <span className="size-analysis-club-group-head__total">총 {club.totalQty}개</span>
                  <span className="size-analysis-club-group-chevron" aria-hidden>
                    <svg
                      className={isOpen ? "size-analysis-club-group-chevron__svg is-open" : "size-analysis-club-group-chevron__svg"}
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
              {isOpen ? (
                <div id={panelId} className="size-analysis-club-group-rows">
                  {club.rows.map((r, ridx) => {
                    const g = String(r.gender ?? "").trim();
                    const sizePart = [g ? `${g} ${r.size}`.trim() : String(r.size), `${r.qty}개`].filter(Boolean).join(" · ");
                    return (
                    <div
                      key={`${club.club}-${r.gender}-${r.size}-${ridx}`}
                      className={[
                        "size-analysis-club-group-row",
                        r.hasReview && "size-analysis-club-size-tr--review",
                        r.hasUnresolved && "size-analysis-club-size-tr--unresolved",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <p className="size-analysis-club-line-mobile">
                        <span className="size-analysis-club-line-mobile__text">{sizePart}</span>
                        {r.hasReview ? (
                          <span className="size-analysis-mini-pill size-analysis-mini-pill--review">검토필요</span>
                        ) : r.hasUnresolved ? (
                          <span className="size-analysis-mini-pill size-analysis-mini-pill--unresolved">미분류</span>
                        ) : null}
                      </p>
                      <div className="size-analysis-club-line-desktop">
                        <span className="size-analysis-club-group-gender">{g || "—"}</span>
                        <span>{r.size}</span>
                        <span>{r.qty}개</span>
                        <span>{r.hasReview ? "(검토필요)" : r.hasUnresolved ? "(미분류)" : ""}</span>
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function AnalysisSummaryCards({ summary }: { summary: any }) {
  if (!summary) return null;
  const cards = [
    ["총 정규화 행 수", summary.totalRows],
    ["자동확정", summary.auto_confirmed],
    ["검토필요", summary.needs_review],
    ["미분류", summary.unresolved],
    ["수정완료", summary.corrected],
    ["제외", summary.excluded],
    ["원본 총수량", summary.originalTotalQty],
    ["최종 집계 수량", summary.aggregatedTotalQty],
    ["검산", summary.verificationMatched ? "일치" : "불일치"],
  ];
  return (
    <section className="size-analysis-card">
      <h3>5) 결과 요약</h3>
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
  if (st === "needs_review" || st === "unresolved" || st === "corrected") {
    return {
      subline: [src, conf].filter((x) => x && x.length > 0).join(" · "),
      pill: st as "needs_review" | "unresolved" | "corrected",
    };
  }
  const statusLabel = labelParseStatus(r.parseStatus);
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

export function AnalysisRowsTable({ rows }: { rows: any[] }) {
  return (
    <section className="size-analysis-card size-analysis-norm-section">
      <h3>7) 정규화 행</h3>
      <div className="size-analysis-norm-compact-list size-analysis-norm-compact-list--mobile" aria-label="정규화 행(요약)">
        {rows.map((r) => {
          const { subline, pill } = normalizedRowLine2Parts(r);
          return (
            <article key={r.id} className={normCompactClass(r.parseStatus)}>
              <p className="size-analysis-norm-compact__line1">{normalizedRowLine1(r)}</p>
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
              <th>신뢰도</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="원본행">{r.sourceRowIndex}</td>
                <td data-label="클럽">{r.clubNameRaw ?? ""}</td>
                <td data-label="이름">{r.memberNameRaw ?? ""}</td>
                <td data-label="성별">{r.genderNormalized ?? r.genderRaw ?? ""}</td>
                <td data-label="사이즈">{r.standardizedSize ?? r.sizeRaw ?? ""}</td>
                <td data-label="수량">{r.qtyParsed ?? r.qtyRaw ?? ""}</td>
                <td data-label="상태">{labelParseStatus(r.parseStatus)}</td>
                <td data-label="신뢰도">{Number(r.parseConfidence ?? 0).toFixed(2)}</td>
              </tr>
            ))}
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

const LETTER_SIZES_ORDER = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "FREE", "F"] as const;

/** 집계 행(요약)과 정규화 행의 클럽 키를 맞춤 */
function normClubFromNormRow(r: { clubNameNormalized?: string | null; clubNameRaw?: string | null }): string {
  return String(r.clubNameNormalized ?? r.clubNameRaw ?? "미분류").trim() || "미분류";
}

/**
 * 매트릭스 행·집계 gender 키: 여 / 남 / 공용(빈 값·기타)
 */
function rowKeyGenderForAgg(g: string | null | undefined): "여" | "남" | "공용" {
  const t = String(g ?? "").trim();
  if (t === "남") return "남";
  if (t === "여") return "여";
  return "공용";
}

function compareSizeForMatrix(a: string, b: string): number {
  const na = String(a ?? "").trim();
  const nb = String(b ?? "").trim();
  const aNum = /^\d+$/.test(na);
  const bNum = /^\d+$/.test(nb);
  if (aNum && bNum) return Number(na) - Number(nb);
  if (aNum) return -1;
  if (bNum) return 1;
  const ua = na.toUpperCase();
  const ub = nb.toUpperCase();
  const ia = (LETTER_SIZES_ORDER as readonly string[]).indexOf(ua);
  const ib = (LETTER_SIZES_ORDER as readonly string[]).indexOf(ub);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return na.localeCompare(nb, "ko");
}

type DupByClub = Map<string, { persons: number; sheets: number }>;

/** 동일 클럽에서 같은 이름이 2행 이상이면 중복. 인원 수·총 장수(해당 행 수량 합) 집계 */
function duplicateSummaryByClub(normRows: any[]): DupByClub {
  const m = new Map<string, Map<string, { lineCount: number; sheetSum: number }>>();
  for (const r of normRows) {
    if (r.excluded) continue;
    const name = String(r.memberNameRaw ?? "").trim();
    if (!name) continue;
    const club = normClubFromNormRow(r);
    if (!m.has(club)) m.set(club, new Map());
    const byName = m.get(club)!;
    if (!byName.has(name)) byName.set(name, { lineCount: 0, sheetSum: 0 });
    const o = byName.get(name)!;
    o.lineCount += 1;
    const q = r.qtyParsed;
    o.sheetSum += Number.isFinite(Number(q)) ? Number(q) : 0;
  }
  const out: DupByClub = new Map();
  for (const [club, byName] of m) {
    let persons = 0;
    let sheets = 0;
    for (const o of byName.values()) {
      if (o.lineCount > 1) {
        persons += 1;
        sheets += o.sheetSum;
      }
    }
    out.set(club, { persons, sheets });
  }
  return out;
}

type CellMeta = { hasReview: boolean; hasUnres: boolean; hasCorrected: boolean };
function buildCellStatusMap(normRows: any[]): Map<string, CellMeta> {
  const map = new Map<string, CellMeta>();
  for (const r of normRows) {
    if (r.excluded) continue;
    const club = normClubFromNormRow(r);
    const gk = rowKeyGenderForAgg(String(r.genderNormalized ?? r.genderRaw ?? ""));
    const size = String(r.standardizedSize ?? r.sizeRaw ?? "미분류").trim() || "미분류";
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

function clubAggMatrixHeadline(
  club: string,
  clubRows: Array<{ club: string; gender: string; size: string; qty: number }>,
  totalQty: number,
  dup: { persons: number; sheets: number } | undefined
): string {
  const by: Record<"여" | "남" | "공용", number> = { 여: 0, 남: 0, 공용: 0 };
  for (const r of clubRows) {
    const gk = rowKeyGenderForAgg(r.gender);
    by[gk] += r.qty;
  }
  const gParts: string[] = [];
  if (by.여 > 0) gParts.push(`여:${by.여}장`);
  if (by.남 > 0) gParts.push(`남:${by.남}장`);
  if (by.공용 > 0) gParts.push(`공용:${by.공용}장`);
  const gStr = gParts.length ? `${gParts.join(" ")} ` : "";
  const dupText = !dup || dup.persons === 0 ? "중복자 없음" : `중복 ${dup.persons}명/${dup.sheets}장`;
  return `${club} (${gStr}합계:${totalQty}장 / ${dupText})`;
}

function clubAggMobileLine(r: { club: string; gender: string; size: string; qty: number }): string {
  const club = String(r.club ?? "").trim() || "미분류";
  const g = String(r.gender ?? "").trim();
  const size = String(r.size ?? "").trim() || "미분류";
  if (g === "공용") {
    return `${club} · 공용 ${size} · ${r.qty}개`;
  }
  if (g) {
    return `${club} · ${g} ${size} · ${r.qty}개`;
  }
  return `${club} · ${size} · ${r.qty}개`;
}

const GENDER_ROW_ORDER: Array<"여" | "남" | "공용"> = ["여", "남", "공용"];

export function ClubSizeSummaryTable({
  rows,
  normRows,
}: {
  rows: Array<{ club: string; gender: string; size: string; qty: number }>;
  /** 필터·제외가 반영된 정규화 행(중복·셀 상태용) */
  normRows: any[];
}) {
  const dupByClub = useMemo(() => duplicateSummaryByClub(normRows ?? []), [normRows]);
  const statusByCell = useMemo(() => buildCellStatusMap(normRows ?? []), [normRows]);

  const matrixBlocks = useMemo(() => {
    if (rows.length === 0) return [];
    const by = groupClubAggRows(rows);
    const clubs = Array.from(by.keys()).sort((a, b) => a.localeCompare(b, "ko"));
    return clubs.map((club) => {
      const clubRows = by.get(club) ?? [];
      const totalQty = clubRows.reduce((s, r) => s + r.qty, 0);
      const sizes = Array.from(new Set(clubRows.map((r) => r.size))).sort(compareSizeForMatrix);
      const gSeen = new Set<"여" | "남" | "공용">();
      for (const r of clubRows) gSeen.add(rowKeyGenderForAgg(r.gender));
      const rowKeys = GENDER_ROW_ORDER.filter((g) => gSeen.has(g));
      const qtyMap = new Map<string, number>();
      for (const r of clubRows) {
        const gk = rowKeyGenderForAgg(r.gender);
        const k = `${gk}\0${r.size}`;
        qtyMap.set(k, (qtyMap.get(k) ?? 0) + r.qty);
      }
      return {
        club,
        clubRows,
        totalQty,
        sizes,
        rowKeys,
        qtyMap,
        headline: clubAggMatrixHeadline(club, clubRows, totalQty, dupByClub.get(club)),
      };
    });
  }, [rows, dupByClub]);

  if (rows.length === 0) return null;

  return (
    <section className="size-analysis-card size-analysis-club-size-card size-analysis-club-agg-section">
      <h3>8) 클럽/성별/사이즈 집계</h3>
      <p className="size-analysis-muted size-analysis-club-size-hint size-analysis-club-agg-hint">
        수량은 자동·검토·수정·미분류를 모두 합산하며, 클럽/성별/사이즈 기준으로 집계합니다.
      </p>
      <div className="size-analysis-club-agg-compact--mobile" aria-label="집계(요약)">
        {rows.map((r, idx) => (
          <div key={`${r.club}-${r.gender ?? ""}-${r.size}-${idx}`} className="size-analysis-club-agg-line">
            {clubAggMobileLine(r)}
          </div>
        ))}
      </div>
      <div className="size-analysis-club-agg-mtx--desktop" aria-label="집계(클럽별 매트릭스)">
        {matrixBlocks.map((b) => (
          <div key={b.club} className="size-analysis-club-agg-mtx-block">
            <p className="size-analysis-club-agg-mtx-clubline">{b.headline}</p>
            <div className="size-analysis-club-agg-mtx-scroll">
              <table className="size-analysis-club-agg-mtx">
                <thead>
                  <tr>
                    <th className="size-analysis-club-agg-mtx-corner" scope="col" aria-label="성별·사이즈">
                      {"\u200b"}
                    </th>
                    {b.sizes.map((sz) => (
                      <th key={sz} scope="col">
                        {sz}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rowKeys.map((gk) => (
                    <tr key={gk}>
                      <th className="size-analysis-club-agg-mtx-gh" scope="row">
                        {gk}
                      </th>
                      {b.sizes.map((sz) => {
                        const q = b.qtyMap.get(`${gk}\0${sz}`) ?? 0;
                        const meta = statusByCell.get(`${b.club}\0${gk}\0${sz}`) ?? {
                          hasReview: false,
                          hasUnres: false,
                          hasCorrected: false,
                        };
                        const stBits: string[] = [];
                        if (meta.hasReview) stBits.push("검토필요");
                        if (meta.hasUnres) stBits.push("미분류");
                        if (meta.hasCorrected) stBits.push("수정완료");
                        const stLabel = stBits.length ? stBits.join(", ") : undefined;
                        let stateClass = "";
                        if (meta.hasReview) stateClass = "size-analysis-club-agg-mtx-cell--review";
                        else if (meta.hasUnres) stateClass = "size-analysis-club-agg-mtx-cell--unres";
                        else if (meta.hasCorrected) stateClass = "size-analysis-club-agg-mtx-cell--corrected";
                        const cellClass = stateClass;
                        const show = q > 0 ? String(q) : "";
                        return (
                          <td
                            key={`${gk}-${sz}`}
                            className={cellClass}
                            title={stLabel}
                            aria-label={stLabel ? `${gk}·${sz} ${show || "0"} (${stLabel})` : show ? `${gk}·${sz} ${show}` : undefined}
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
        ))}
      </div>
    </section>
  );
}

