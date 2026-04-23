import fs from "node:fs/promises";

const base = "http://localhost:3000";
const filePath = "C:/Users/(주)세림통상/Desktop/inventory-mvp/tmp/size-analysis-sample.csv";

async function main() {
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "text/csv" }), "size-analysis-sample.csv");

  const uploadRes = await fetch(`${base}/api/size-analysis/upload`, { method: "POST", body: form });
  const upload = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(`upload 실패: ${JSON.stringify(upload)}`);

  const jobId = upload.jobId;
  const sheetName = upload.sheets?.[0]?.name;
  if (!jobId || !sheetName) throw new Error(`jobId/sheetName 누락: ${JSON.stringify(upload)}`);

  const detectRes = await fetch(`${base}/api/size-analysis/detect-structure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, sheetName }),
  });
  const detect = await detectRes.json();
  if (!detectRes.ok) throw new Error(`detect 실패: ${JSON.stringify(detect)}`);

  const saveRes = await fetch(`${base}/api/size-analysis/save-mapping`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, sheetName, mapping: detect.mapping }),
  });
  const save = await saveRes.json();
  if (!saveRes.ok) throw new Error(`save 실패: ${JSON.stringify(save)}`);

  const runRes = await fetch(`${base}/api/size-analysis/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  const run = await runRes.json();
  if (!runRes.ok) throw new Error(`run 실패: ${JSON.stringify(run)}`);

  const summaryRes = await fetch(`${base}/api/size-analysis/${jobId}/summary`);
  const summary = await summaryRes.json();
  if (!summaryRes.ok) throw new Error(`summary 실패: ${JSON.stringify(summary)}`);

  console.log(JSON.stringify({ jobId, upload, detect, save, run, summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

