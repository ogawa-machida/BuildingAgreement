import { initializeApp } from "firebase-admin/app";
import { getDatabase, ServerValue } from "firebase-admin/database";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";

initializeApp({
  databaseURL: "https://buildingagreement-9ee19-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "buildingagreement-9ee19.firebasestorage.app"
});
const options = { region: "asia-northeast1", enforceAppCheck: true, maxInstances: 3 };
const db = getDatabase();
const bucket = getStorage().bucket();
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const diagramKinds = ["guide", "site", "floor", "elevation"];
const invalid = message => new HttpsError("invalid-argument", message);

function text(value, limit, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.trim().length > limit || (required && !value.trim())) {
    throw invalid("入力項目を確認してください。");
  }
  return value.trim();
}

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw invalid("工事予定日を確認してください。");
  }
  return value;
}

function checkApplication(data) {
  const info = data.info ?? {};
  const fields = ["owner", "ownerAddress", "ownerPhone", "applicantAddress", "applicantPhone"];
  const parties = Object.fromEntries(fields.map(key => [key, text(info[key], 150, true)]));
  const start = date(info.start);
  const end = date(info.end);
  if (end < start || !["new", "addition"].includes(info.work)) throw invalid("工事予定を確認してください。");
  if (data.area !== "inside" || !Array.isArray(data.checks) || data.checks.length !== 9
    || !Array.from(data.checks).every(value => value === true)) {
    throw invalid("対象区域と建築協約１）〜９）を確認してください。");
  }
  return {
    info: { ...parties, work: info.work, start, end },
    checks: data.checks,
    areaDeclaration: "inside", agreementVersion: "1978-01-01"
  };
}

async function checkFiles(uid, id, files) {
  if (!Array.isArray(files) || files.length > 12 || files.length === 0) throw invalid("図面を添付してください。");
  const slots = new Set(files.map(file => file.slot));
  const kinds = new Set(files.map(file => file.kind));
  if (slots.size !== files.length || !files.every(file => /^(0[1-9]|1[0-2])$/.test(file.slot))
   || !(files.length === 1 && kinds.has("combined") || kinds.size === 4 && diagramKinds.every(kind => kinds.has(kind)))) {
    throw invalid("図面の種類を確認してください。");
  }
  const checked = await Promise.all(files.map(async ({ slot, kind, name }) => {
    const path = `uploads/${uid}/${id}/${slot}`;
    const object = bucket.file(path);
    const [meta] = await object.getMetadata();
    if (meta.contentType !== "application/pdf") throw invalid("PDFを添付してください。");
    const [lead] = await object.download({ start: 0, end: 4, validation: false });
    if (lead.toString() !== "%PDF-") throw invalid("PDFファイルを確認してください。");
    return { path, kind, name: text(name, 180, true), size: Number(meta.size) };
  }));
  if (checked.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) {
    throw invalid("添付の合計容量は50 MB以内にしてください。");
  }
  return checked;
}

export const submitAgreement = onCall(options, async request => {
  const uid = request.auth?.uid;
  if (!uid || request.auth.token.firebase.sign_in_provider !== "anonymous") {
    throw new HttpsError("unauthenticated", "受付画面から開き直してください。");
  }
  const data = request.data ?? {};
  if (!uuid.test(data.id) || !["application", "question"].includes(data.type)) throw invalid("受付情報が無効です。");
  if (data.confirm !== true) throw invalid("情報の取り扱いへの同意を確認してください。");
  const record = db.ref(`cases/${data.id}`);
  const existing = (await record.get()).val();
  if (existing) {
    if (existing.uid !== uid) throw new HttpsError("permission-denied", "受付番号を確認してください。");
    return { id: data.id };
  }
  const isApplication = data.type === "application";
  const email = text(data.email, 254, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("メールアドレスを確認してください。");
  const base = { uid, type: data.type, email, name: text(data.name, 150, true),
    company: text(data.company, 150, true), address: text(data.address, 300, true),
    consent: true, submittedAt: ServerValue.TIMESTAMP, status: isApplication ? "受付済" : "未回答" };
  const body = isApplication
    ? { ...checkApplication(data), files: await checkFiles(uid, data.id, data.files) }
    : { message: text(data.message, 3000, true) };
  const result = await record.transaction(current => current ?? { ...base, ...body });
  if (result.snapshot.child("uid").val() !== uid) throw new HttpsError("permission-denied", "受付番号を確認してください。");
  return { id: data.id };
});

export const updateAgreement = onCall(options, async request => {
  if (request.auth?.token.agreementAdmin !== true) throw new HttpsError("permission-denied", "会の権限が必要です。");
  const { id, status, note, areaReview } = request.data ?? {};
  if (!uuid.test(id)) throw invalid("受付番号を確認してください。");
  const observations = text(note, 4000);
  if (!["未確認", "区域内", "区域外", "要協議"].includes(areaReview)) throw invalid("区域確認結果を確認してください。");
  const result = await db.ref(`cases/${id}`).transaction(current => {
    if (!current) return;
    const allowed = current.type === "application"
      ? ["受付済", "確認中", "修正待ち", "別途協議中", "確認完了"] : ["未回答", "対応中", "回答済"];
    if (!allowed.includes(status)) return;
    return { ...current, status, note: observations, areaReview, updatedAt: ServerValue.TIMESTAMP,
      updatedBy: request.auth.uid };
  });
  if (!result.committed) throw invalid("案件または状態を確認してください。");
  return { ok: true };
});

export { notifyNewApplication } from "./application-notification.mjs";
