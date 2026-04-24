"use client";

import { useMemo, useState } from "react";

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

  const clubSizeRows = useMemo(() => {
    const obj = summary?.clubSize ?? {};
    const out: Array<{ club: string; size: string; qty: number }> = [];
    Object.entries(obj).forEach(([club, sizeMap]) => {
      Object.entries(sizeMap as Record<string, number>).forEach(([size, qty]) => out.push({ club, size, qty }));
    });
    return out.sort((a, b) => a.club.localeCompare(b.club) || a.size.localeCompare(b.size));
  }, [summary]);

  async function uploadFile(file: File) {
    setError("");
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
    try {
      const res = await fetch("/api/size-analysis/detect-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, sheetName: selectedSheet }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "구조 분석 실패");
      setDetectResult(json);
      setMapping(json.mapping);
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
    } catch (e) {
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
      status === "all" ? `/api/size-analysis/${id}/rows` : `/api/size-analysis/${id}/rows?status=${encodeURIComponent(status)}`;
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

      <SizeAnalysisUploadCard onUpload={uploadFile} loading={loading === "upload"} />
      <WorkbookSheetSelector sheets={sheets} selectedSheet={selectedSheet} onSelect={setSelectedSheet} />

      <StructureDetectionPanel
        detectResult={detectResult}
        loading={loading === "detect"}
        onDetect={detectStructureAction}
      />

      <FieldMappingEditor
        mapping={mapping}
        onChange={setMapping}
        onSave={saveMappingAction}
        loading={loading === "mapping"}
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
    <section className="size-analysis-card">
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
    <section className="size-analysis-card">
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
    <section className="size-analysis-card">
      <h3>3) 구조 분석</h3>
      <button className="btn btn-secondary" onClick={onDetect} disabled={loading}>
        {loading ? "분석 중..." : "헤더/구조 자동 추천"}
      </button>
      {detectResult ? (
        <div className="size-analysis-grid">
          <div>추천 헤더 행: {detectResult.headerRowIndex}</div>
          <div>추천 구조 유형: {labelStructureType(detectResult.structureType)}</div>
        </div>
      ) : null}
    </section>
  );
}

export function FieldMappingEditor({
  mapping,
  onChange,
  onSave,
  loading,
}: {
  mapping: Mapping | null;
  onChange: (mapping: Mapping) => void;
  onSave: () => void;
  loading: boolean;
}) {
  if (!mapping) return null;
  const roles = ["club", "name", "gender", "size", "qty", "item", "note"];
  return (
    <section className="size-analysis-card">
      <h3>4) 필드 매핑</h3>
      <div className="size-analysis-grid">
        <label>
          구조 유형
          <select
            value={mapping.structureType}
            onChange={(e) => onChange({ ...mapping, structureType: e.target.value as Mapping["structureType"] })}
          >
            <option value="single_row_person">{STRUCTURE_TYPE_LABEL.single_row_person}</option>
            <option value="repeated_slots">{STRUCTURE_TYPE_LABEL.repeated_slots}</option>
            <option value="size_matrix">{STRUCTURE_TYPE_LABEL.size_matrix}</option>
            <option value="unknown">{STRUCTURE_TYPE_LABEL.unknown}</option>
          </select>
        </label>
        <label>
          헤더 행
          <input
            type="number"
            value={mapping.headerRowIndex}
            onChange={(e) => onChange({ ...mapping, headerRowIndex: Number(e.target.value || 0) })}
          />
        </label>
        {roles.map((role) => (
          <label key={role}>
            {FIELD_ROLE_LABEL[role] ?? role}
            <input
              type="number"
              value={mapping.fields[role] ?? ""}
              onChange={(e) =>
                onChange({
                  ...mapping,
                  fields: { ...mapping.fields, [role]: e.target.value === "" ? undefined : Number(e.target.value) },
                })
              }
            />
          </label>
        ))}
      </div>
      <button className="btn btn-secondary" onClick={onSave} disabled={loading}>
        {loading ? "저장 중..." : "매핑 확정"}
      </button>
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
        {STATUS_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt}
            className={`btn ${value === opt ? "btn-primary" : "btn-secondary"}`}
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
        <table className="size-analysis-table">
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

export function ClubSizeSummaryTable({ rows }: { rows: Array<{ club: string; size: string; qty: number }> }) {
  if (rows.length === 0) return null;
  return (
    <section className="size-analysis-card">
      <h3>8) 클럽/사이즈 집계</h3>
      <div className="size-analysis-table-wrap">
        <table className="size-analysis-table">
          <thead>
            <tr>
              <th>클럽</th>
              <th>사이즈</th>
              <th>수량</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.club}-${r.size}-${idx}`}>
                <td data-label="클럽">{r.club}</td>
                <td data-label="사이즈">{r.size}</td>
                <td data-label="수량">{r.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

