"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { DevSourceItem } from "./devSourceMap";

type DevSourceModalProps = {
  open: boolean;
  title: string;
  subtitle: string;
  items: DevSourceItem[];
  copiedFile: string;
  onClose: () => void;
  onCopy: (file: string) => void;
};

export function DevSourceModal({ open, title, subtitle, items, copiedFile, onClose, onCopy }: DevSourceModalProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="dev-source-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="dev-source-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-source-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dev-source-modal-header">
          <h3 id="dev-source-modal-title">{title}</h3>
          <p className="dev-source-modal-subtitle">{subtitle}</p>
        </header>
        <ul className="dev-source-list">
          {items.map((item) => (
            <li key={item.file} className="dev-source-item">
              <div className="dev-source-item-title">{item.label}</div>
              {item.description ? <p className="dev-source-item-description">{item.description}</p> : null}
              <button
                type="button"
                className="dev-source-file"
                onClick={() => onCopy(item.file)}
                aria-label={`${item.file} 경로 복사`}
                title="클릭해서 경로 복사"
              >
                {copiedFile === item.file ? "복사됨 ✓" : item.file}
              </button>
              {item.keywords?.length ? (
                <div className="dev-source-tags">
                  {item.keywords.map((keyword) => (
                    <span key={`${item.file}-${keyword}`} className="dev-source-tag">
                      {keyword}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="dev-source-modal-footer">
          <button type="button" className="btn btn-secondary btn-compact" onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
