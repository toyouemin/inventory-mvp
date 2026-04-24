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
      <AnalysisRowsTable rows={rows} />
      <ClubSizeSummaryTable rows={clubSizeRows} />

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
        <p className="size-analysis-muted size-analysis-map-hint-2">CSV의 열 순서를 위 드롭다운에서 선택해 맞추면 됩니다.</p>
      ) : (
        <p className="size-analysis-muted size-analysis-map-hint-2">
          먼저 &quot;3) 구조 분석&quot;을 실행해 헤더를 불러온 뒤 열을 선택하거나, 위 숫자로 1=첫 열을 입력하세요.
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

export function AnalysisRowsTable({ rows }: { rows: any[] }) {
  return (
    <section className="size-analysis-card">
      <h3>7) 정규화 행</h3>
      <div className="size-analysis-table-wrap">
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

export function ClubSizeSummaryTable({
  rows,
}: {
  rows: Array<{ club: string; gender: string; size: string; qty: number }>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="size-analysis-card size-analysis-club-size-card">
      <h3>8) 클럽/사이즈 집계</h3>
      <p className="size-analysis-muted size-analysis-club-size-hint">
        수량은 자동·검토·수정·미분류를 모두 합산하며, 클럽/성별/사이즈 기준으로 집계합니다.
      </p>
      <div className="size-analysis-table-wrap">
        <table className="size-analysis-table size-analysis-table--club-size">
          <thead>
            <tr>
              <th>클럽</th>
              <th>성별</th>
              <th>사이즈</th>
              <th>수량</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              return (
                <tr key={`${r.club}-${r.gender ?? ""}-${r.size}-${idx}`}>
                  <td data-label="클럽">{r.club}</td>
                  <td data-label="성별">{r.gender ?? ""}</td>
                  <td data-label="사이즈">{r.size}</td>
                  <td data-label="수량">{r.qty}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

