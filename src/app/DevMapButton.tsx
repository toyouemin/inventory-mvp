"use client";

import { useState } from "react";

function SettingsPanel() {
  return (
    <div className="app-settings-panel" role="dialog" aria-label="설정 패널">
      <p className="app-settings-panel__title">설정</p>
      <p className="app-settings-panel__item">개발 구조 보기 패널이 열려 있습니다.</p>
      <p className="app-settings-panel__item">다시 톱니 버튼을 누르면 닫힙니다.</p>
    </div>
  );
}

export function DevMapButton() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleClickSettings = () => {
    setIsSettingsOpen((prev) => !prev);
  };

  return (
    <>
      <button
        type="button"
        className="app-dev-map-button"
        aria-label="개발 구조 보기"
        title="개발 구조 보기"
        aria-expanded={isSettingsOpen}
        onClick={handleClickSettings}
      >
        <span aria-hidden>⚙️</span>
      </button>
      {isSettingsOpen && <SettingsPanel />}
    </>
  );
}

