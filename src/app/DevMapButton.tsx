"use client";

import Link from "next/link";
import { useState } from "react";

function SettingsPanel() {
  return (
    <div className="app-settings-panel" role="dialog" aria-label="설정 패널">
      <Link href="/dev-map" className="app-settings-panel__link">
        개발 구조 페이지 열기
      </Link>
    </div>
  );
}

export function DevMapButton() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="app-dev-map-button"
        aria-label="개발 구조 보기"
        title="개발 구조 보기"
        aria-expanded={isSettingsOpen}
        onClick={() => setIsSettingsOpen((prev) => !prev)}
      >
        <span aria-hidden>⚙️</span>
      </button>
      {isSettingsOpen ? <SettingsPanel /> : null}
    </>
  );
}

