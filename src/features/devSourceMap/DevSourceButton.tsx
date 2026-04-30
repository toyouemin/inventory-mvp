"use client";

import { useEffect, useMemo, useState } from "react";
import { DevSourceModal } from "./DevSourceModal";
import { DEV_SOURCE_MAP, type DevSourcePageKey } from "./devSourceMap";

type DevSourceButtonProps = {
  pageKey: DevSourcePageKey;
  variant?: "default" | "icon";
};

export function DevSourceButton({ pageKey, variant = "default" }: DevSourceButtonProps) {
  const [open, setOpen] = useState(false);
  const [copiedFile, setCopiedFile] = useState("");
  const items = useMemo(() => DEV_SOURCE_MAP[pageKey] ?? [], [pageKey]);

  useEffect(() => {
    if (!copiedFile) return;
    const timer = window.setTimeout(() => setCopiedFile(""), 1200);
    return () => window.clearTimeout(timer);
  }, [copiedFile]);

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  async function handleCopy(file: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(file);
      setCopiedFile(file);
    } catch {
      setCopiedFile("");
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          className="app-dev-map-button dev-source-icon-button"
          onClick={() => setOpen(true)}
          aria-label="소스 위치 보기"
          title="소스 위치 보기"
        >
          <span className="dev-source-icon-glyph" aria-hidden>
            ⚙️
          </span>
        </button>
      ) : (
        <button type="button" className="btn btn-secondary btn-compact dev-source-button" onClick={() => setOpen(true)}>
          소스 위치 보기
        </button>
      )}
      <DevSourceModal
        open={open}
        title="소스 위치 보기"
        subtitle="현재 화면 수정에 자주 사용하는 핵심 파일입니다."
        items={items}
        copiedFile={copiedFile}
        onClose={() => setOpen(false)}
        onCopy={(file) => void handleCopy(file)}
      />
    </>
  );
}
