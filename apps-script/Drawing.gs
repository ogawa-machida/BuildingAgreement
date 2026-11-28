const DRAWING_BYTES = 10 * 1024 * 1024;
const CASE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const CLOCK = { ".sv": "timestamp" };

function drawingFolderId() {
  const id = PropertiesService.getScriptProperties().getProperty("DRAWING_FOLDER_ID")?.trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("図面フォルダが未設定です。");
  return id;
}

function writeCase(id, fields) {
  const response = UrlFetchApp.fetch(DB + "/cases/" + id + ".json", {
    method: "patch", contentType: "application/json", payload: JSON.stringify(fields),
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error("案件の保存に失敗しました。");
}

function verifyDrawingSubmission(id, token, attestation) {
  const response = UrlFetchApp.fetch(DB + "/cases/" + id + "/submittedAt.json?auth=" + encodeURIComponent(token), {
    headers: { "X-Firebase-AppCheck": attestation }, muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200 || !Number.isFinite(JSON.parse(response.getContentText()))) {
    throw new Error("受付を確認できません。受付画面から再試行してください。");
  }
}

function caseDrawings(id) {
  const files = [];
  let pageToken;
  do {
    const page = Drive.Files.list({
      q: "'" + drawingFolderId() + "' in parents and appProperties has { key='buildingAgreementCase' and value='" + id + "' }",
      fields: "nextPageToken,files(id,name,appProperties)",
      pageSize: 100,
      pageToken
    });
    files.push(...(page.files || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

function parseDrawingFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 8) throw new Error("PDFは１〜８件です。");
  let bytes = 0;
  return files.map((file, index) => {
    if (typeof file?.name !== "string" || !/^[^\x00-\x1f/\\]{1,156}\.pdf$/i.test(file.name)
        || typeof file.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) {
      throw new Error("PDFの形式を確認してください。");
    }
    const contents = Utilities.base64Decode(file.data);
    bytes += contents.length;
    if (bytes > DRAWING_BYTES || contents.slice(0, 5).join(",") !== "37,80,68,70,45") {
      throw new Error("PDFの形式と合計10 MB以内の容量を確認してください。");
    }
    const hash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, contents));
    return { name: file.name, key: index + "-" + hash, blob: Utilities.newBlob(contents, "application/pdf", file.name) };
  });
}

function acceptDrawings(payload) {
  const { id, idToken, appCheck, files } = payload;
  if (typeof id !== "string" || !CASE_ID.test(id)
      || typeof idToken !== "string" || !idToken || idToken.length > 4096
      || typeof appCheck !== "string" || !appCheck || appCheck.length > 4096) {
    throw new Error("受付情報を確認できません。");
  }
  verifyDrawingSubmission(id, idToken, appCheck);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const row = readJson(DB + "/cases/" + id + ".json");
    if (!row || row.type !== "application") throw new Error("建築承認願いを確認できません。");
    if (row.driveState === "ready" && !row.completedAt) return id;
    if (row.driveState !== "uploading" || row.completedAt) throw new Error("この案件は図面を受け付けていません。");
    requirePrivateDrawingFolder();
    const drawings = parseDrawingFiles(files);
    const existing = new Map(caseDrawings(id).map(file => [file.appProperties.buildingAgreementFile, file]));
    const manifest = drawings.map(drawing => {
      const file = existing.get(drawing.key) || Drive.Files.create({
        name: drawing.name, parents: [drawingFolderId()],
        appProperties: { buildingAgreementCase: id, buildingAgreementFile: drawing.key }
      }, drawing.blob, { fields: "id" });
      return { id: file.id, name: drawing.name };
    });
    writeCase(id, { driveState: "ready", drawingStatus: "受領済み", drawingFiles: manifest,
      drawingFolder: drawingFolderId(), submittedAt: CLOCK });
    return id;
  } finally {
    lock.releaseLock();
  }
}

function doPost(event) {
  let message = "図面の受付を完了できませんでした。受付画面から再試行してください。";
  try {
    if (!event.postData || event.postData.length > 19 * 1024 * 1024) throw new Error("送信容量を確認してください。");
    const id = acceptDrawings(JSON.parse(event.parameter.payload));
    message = "建築承認願いと図面を受け付けました。受付番号：" + id;
  } catch (_) {
    console.warn("図面の受付に失敗しました。");
  }
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>図面の受付結果</title>'
    + '<h1>図面の受付結果</h1><p>' + message + '</p>'
    + '<p><a target="_top" href="https://ogawa-machida.github.io/BuildingAgreement/">受付ページへ戻る</a></p></html>'
  );
}

function requirePrivateDrawingFolder() {
  const folder = DriveApp.getFolderById(drawingFolderId());
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error("図面フォルダの一般的なアクセスを制限付きにしてください。");
  }
}

function installDrawingCleanup() {
  requirePrivateDrawingFolder();
  Drive.Files.list({ pageSize: 1, fields: "files(id)" });
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === "purgeCompletedDrawings")) {
    ScriptApp.newTrigger("purgeCompletedDrawings").timeBased().everyMinutes(5).create();
  }
}

function purgeCompletedDrawings() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const queue = readJson(DB + "/cases.json?orderBy=%22purgeRequested%22&equalTo=true") || {};
    for (const [id, row] of Object.entries(queue).slice(0, 30)) {
      if (!CASE_ID.test(id) || row.type !== "application" || row.driveState !== "ready"
          || !Number.isFinite(row.approvedAt) || !Number.isFinite(row.completedAt) || row.completedAt < row.approvedAt) continue;
      try {
        if (row.drawingFolder !== drawingFolderId()) throw new Error("図面の保管先が変更されています。");
        const files = caseDrawings(id);
        for (const file of files) Drive.Files.remove(file.id);
        if (caseDrawings(id).length) continue;
        writeCase(id, { drawingFiles: null, driveState: "deleted", drawingsDeletedAt: CLOCK, purgeRequested: false });
      } catch (_) {
        console.warn("竣工済み図面の削除待ち：" + id);
      }
    }
  } finally {
    lock.releaseLock();
  }
}
