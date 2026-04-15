/**
 * 제품 페이지 UI 기능 플래그.
 *
 * TODO(ENABLE_BATCH_IMAGE_UPLOAD): `false`로 끈 채 기능을 완전히 없애려면
 * - 이 파일 삭제 또는 아래 상수만 제거한 뒤
 * - `ProductsClient.tsx`에서 `bulkImage` / `bulkOnlyEmpty` / `handleBulkImageFiles` / `ENABLE_BATCH_IMAGE_UPLOAD` 검색 →
 *   한 덩어리(state·ref·콜백·업로드 메뉴 JSX·모달 JSX·actions의 bulkUpload import) 삭제
 */

export const ENABLE_BATCH_IMAGE_UPLOAD = false;
