"use client";

import { useMemo, useState } from "react";

import { DEV_MAP } from "@/features/devMap/devMapData";

export default function DevMapPage() {
  const [query, setQuery] = useState("");
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return DEV_MAP;
    return DEV_MAP.filter((item) => {
      const editableText = item.editable.join(" ");
      const haystack = `${item.category} ${item.file} ${item.role} ${editableText}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [q]);

  function itemKeyOf(item: (typeof DEV_MAP)[number]): string {
    return `${item.category}-${item.file}`;
  }

  function toggleCard(key: string) {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <main className="dev-map-page">
      <section className="dev-map-card">
        <h1 className="dev-map-title">개발 구조 설명</h1>
        <input
          className="dev-map-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="파일명 / 기능 / 키워드 검색 (예: 클럽별, 엑셀, 중복)"
          aria-label="개발 구조 검색"
        />
      </section>

      <section className="dev-map-grid" aria-label="개발 구조 목록">
        {filtered.map((item) => {
          const key = itemKeyOf(item);
          const collapsed = collapsedKeys.has(key);
          return (
            <article key={key} className="dev-map-item-card">
              <div className="dev-map-item-head">
                <div className="dev-map-item-head__text">
                  <p className="dev-map-item-category">{item.category}</p>
                  <p className="dev-map-item-file">{item.file}</p>
                </div>
                <button
                  type="button"
                  className="dev-map-toggle-btn"
                  onClick={() => toggleCard(key)}
                  aria-expanded={!collapsed}
                  aria-label={`${item.file} ${collapsed ? "펼치기" : "접기"}`}
                >
                  {collapsed ? "펼치기" : "접기"}
                </button>
              </div>
              {!collapsed ? (
                <>
                  <p className="dev-map-item-role">
                    <strong>역할:</strong> {item.role}
                  </p>
                  <div className="dev-map-item-editable">
                    <p className="dev-map-item-editable-title">여기서 바꾸는 것:</p>
                    <ul>
                      {item.editable.map((line) => (
                        <li key={`${item.file}-${line}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  {item.note ? (
                    <p className="dev-map-item-note">
                      <strong>주의:</strong> {item.note}
                    </p>
                  ) : null}
                </>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}

