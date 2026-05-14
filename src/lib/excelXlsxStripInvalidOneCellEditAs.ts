import JSZip from "jszip";

/**
 * ExcelJS 4.x는 `xdr:oneCellAnchor` 시작 태그에 `editAs`를 넣는데,
 * OOXML `CT_OneCellAnchor`에는 그 속성이 없어 Excel이 `drawing*.xml`을 복구(손상)합니다.
 * 해당 속성만 제거해 통합 문서를 정상 열리게 합니다.
 */
export async function stripInvalidOneCellAnchorEditAsFromXlsxBuffer(
  buf: Uint8Array
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/drawings\/drawing\d+\.xml$/i.test(name) || zip.files[name]!.dir) continue;
    const entry = zip.file(name);
    if (!entry) continue;
    const xml = await entry.async("string");
    const next = xml.replace(/<xdr:oneCellAnchor\s+editAs="[^"]*"\s*>/g, "<xdr:oneCellAnchor>");
    if (next !== xml) {
      zip.file(name, next);
    }
  }
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return out;
}
