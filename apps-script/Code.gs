const PROJECT = "buildingagreement-9ee19";
const DB = "https://buildingagreement-9ee19-default-rtdb.asia-southeast1.firebasedatabase.app";
const ADMIN_URL = "https://ogawa-machida.github.io/BuildingAgreement/admin.html";

function readJson(url) {
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("Firebase APIへの接続に失敗しました（HTTP " + response.getResponseCode() + "）");
  }
  return JSON.parse(response.getContentText());
}

function adminEmails() {
  const emails = new Set();
  let pageToken;
  do {
    const page = readJson("https://identitytoolkit.googleapis.com/v1/projects/" + PROJECT
      + "/accounts:batchGet?maxResults=1000"
      + (pageToken ? "&nextPageToken=" + encodeURIComponent(pageToken) : ""));
    for (const user of page.users || []) {
      const claims = JSON.parse(user.customAttributes || "{}");
      if (claims.agreementAdmin === true && !user.disabled && user.email) {
        emails.add(user.email.toLowerCase());
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return [...emails];
}

function readCasesFrom(timestamp) {
  return readJson(DB + "/cases.json?orderBy=%22submittedAt%22&startAt=" + timestamp) || {};
}

function installNotifications() {
  const properties = PropertiesService.getScriptProperties();
  const startedAt = Date.now();
  readCasesFrom(startedAt);
  if (!adminEmails().length) throw new Error("Firebase Authenticationで会の管理権限を設定してください。");
  if (!properties.getProperty("notificationCursor")) {
    properties.setProperty("notificationCursor", JSON.stringify({ time: startedAt, ids: [] }));
  }
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === "sendNewCaseNotifications")) {
    ScriptApp.newTrigger("sendNewCaseNotifications").timeBased().everyMinutes(5).create();
  }
}

function sendNewCaseNotifications() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const serialized = properties.getProperty("notificationCursor");
    if (!serialized) throw new Error("installNotifications を先に実行してください。");
    let cursor = JSON.parse(serialized);
    const cases = Object.entries(readCasesFrom(cursor.time))
      .filter(([id, row]) => row.submittedAt > cursor.time || !cursor.ids.includes(id))
      .sort(([, a], [, b]) => a.submittedAt - b.submittedAt);
    if (!cases.length) return;
    const recipients = adminEmails();
    if (!recipients.length) throw new Error("有効な管理者のメールアドレスがありません。");
    for (const [id, row] of cases.slice(0, 50)) {
      if (MailApp.getRemainingDailyQuota() < recipients.length) return;
      const label = row.type === "application" ? "建築承認願い" : "質問・事前相談";
      MailApp.sendEmail({
        to: recipients[0],
        ...(recipients.length > 1 ? { bcc: recipients.slice(1).join(",") } : {}),
        subject: "【建築協約】" + label + "を受け付けました",
        body: label + "が届きました。\n受付番号：" + id + "\n\n会の管理画面でご確認ください。\n" + ADMIN_URL + "?case=" + encodeURIComponent(id)
      });
      cursor = { time: row.submittedAt, ids: row.submittedAt === cursor.time ? [...cursor.ids, id] : [id] };
      properties.setProperty("notificationCursor", JSON.stringify(cursor));
    }
  } finally {
    lock.releaseLock();
  }
}
