/**
 * 한 세션 동안 로드에 실패한 상품 이미지 URL을 기억해, 같은 URL을 다시 요청하지 않음.
 * - 카드 ↔ 리스트 전환(컴포넌트 언마운트) 후에도 유지: 모듈 전역 Set + sessionStorage
 */

const STORAGE_KEY = "inventory:product-img-fail-v1";

type Listener = () => void;
const listeners = new Set<Listener>();

let cacheVersion = 0;

/** 서버/SSR에서는 항상 빈 Set (요청 간 공유되어도 마크되지 않음) */
let memorySet: Set<string> | null = null;

function readStorageIntoSet(): Set<string> {
  const set = new Set<string>();
  if (typeof window === "undefined") return set;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return set;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return set;
    for (const u of arr) {
      if (typeof u === "string" && u) set.add(u);
    }
  } catch {
    /* ignore */
  }
  return set;
}

function getSet(): Set<string> {
  if (memorySet) return memorySet;
  memorySet = readStorageIntoSet();
  return memorySet;
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...getSet()]));
  } catch {
    /* quota */
  }
}

function bumpVersion(): void {
  cacheVersion++;
  for (const l of listeners) l();
}

export function subscribeProductImageFailureCache(onStoreChange: Listener): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getProductImageFailureCacheVersion(): number {
  return cacheVersion;
}

/** `<img onError>`에서 호출: URL을 실패 목록에 넣고 구독자 갱신 */
export function markProductImageUrlFailed(url: string): void {
  const s = (url ?? "").trim();
  if (!s) return;
  const set = getSet();
  if (set.has(s)) return;
  set.add(s);
  persist();
  bumpVersion();
}

export function filterFailedProductImageCandidates(candidates: string[]): string[] {
  const set = getSet();
  return candidates.filter((u) => {
    const t = (u ?? "").trim();
    return t && !set.has(t);
  });
}
