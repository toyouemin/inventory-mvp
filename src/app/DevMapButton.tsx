"use client";

import Link from "next/link";

export function DevMapButton() {
  return (
    <Link href="/dev-map" className="app-dev-map-button" aria-label="개발 구조 보기" title="개발 구조 보기">
      <span aria-hidden>⚙️</span>
    </Link>
  );
}

