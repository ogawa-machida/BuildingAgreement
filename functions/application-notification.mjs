import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { error, warn } from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import { onValueCreated } from "firebase-functions/v2/database";

const apiKey = defineSecret("RESEND_API_KEY");
const sender = defineString("AGREEMENT_MAIL_FROM");
const adminUrl = "https://ogawa-machida.github.io/BuildingAgreement/admin.html";

const caseLabels = { application: "建築承認願い", question: "質問・事前相談" };

async function administratorEmails() {
  const emails = new Set();
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const user of page.users) {
      if (!user.disabled && user.customClaims?.agreementAdmin === true && user.email) {
        emails.add(user.email.trim().toLowerCase());
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return [...emails].filter(Boolean);
}

export const notifyNewApplication = onValueCreated({
  ref: "/cases/{caseId}",
  instance: "buildingagreement-9ee19-default-rtdb",
  region: "asia-southeast1",
  secrets: [apiKey],
  retry: true,
  maxInstances: 1
}, async event => {
  const type = event.data.child("type").val();
  if (!Object.hasOwn(caseLabels, type)) return;
  const label = caseLabels[type];

  const { caseId } = event.params;
  // Stop retries before the mail provider expires its idempotency key.
  if (Date.now() - Date.parse(event.time) >= 23 * 60 * 60 * 1000) {
    error("受付通知の再試行期限を超過しました。", { caseId });
    return;
  }
  const recipients = await administratorEmails();
  if (!recipients.length) {
    warn("通知先となる有効な会の管理アカウントがありません。", { caseId });
    return;
  }
  const deliveries = await Promise.allSettled(recipients.map(email => sendNotification(email, caseId, label)));
  for (const delivery of deliveries) {
    if (delivery.status === "rejected") throw delivery.reason;
  }
});

async function sendNotification(email, caseId, label) {
  const recipientHash = createHash("sha256").update(email).digest("hex");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.value()}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `buildingagreement/${caseId}/${recipientHash}`
    },
    body: JSON.stringify({
      from: sender.value(),
      to: [email],
      subject: `【建築協約】${label}を受け付けました`,
      text: `${label}が届きました。\n受付番号：${caseId}\n\n会の管理画面にログインしてご確認ください。\n${adminUrl}\n`
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (response.ok) return;
  const { status } = response;
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    throw new Error(`受付通知の一時的な送信エラー（HTTP ${status}）`);
  }
  error("受付通知を送信できませんでした。メール設定を確認してください。", { caseId, status });
}
