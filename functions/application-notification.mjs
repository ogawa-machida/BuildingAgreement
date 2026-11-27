import { error } from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import { onValueCreated } from "firebase-functions/v2/database";

const apiKey = defineSecret("RESEND_API_KEY");
const sender = defineString("AGREEMENT_MAIL_FROM");
const recipient = defineString("AGREEMENT_ADMIN_EMAIL");
const adminUrl = "https://ogawa-machida.github.io/BuildingAgreement/admin.html";

export const notifyNewApplication = onValueCreated({
  ref: "/cases/{caseId}",
  instance: "buildingagreement-9ee19-default-rtdb",
  region: "asia-southeast1",
  secrets: [apiKey],
  retry: true,
  maxInstances: 1
}, async event => {
  if (event.data.child("type").val() !== "application") return;

  const { caseId } = event.params;
  // Stop retries before the mail provider expires its idempotency key.
  if (Date.now() - Date.parse(event.time) >= 23 * 60 * 60 * 1000) {
    error("受付通知の再試行期限を超過しました。", { caseId });
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.value()}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `buildingagreement/application/${caseId}`
    },
    body: JSON.stringify({
      from: sender.value(),
      to: [recipient.value()],
      subject: "【建築協約】新しい建築承認願いを受け付けました",
      text: `建築承認願いが届きました。\n受付番号：${caseId}\n\n会の管理画面にログインしてご確認ください。\n${adminUrl}\n`
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (response.ok) return;
  const { status } = response;
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    throw new Error(`受付通知の一時的な送信エラー（HTTP ${status}）`);
  }
  error("受付通知を送信できませんでした。メール設定を確認してください。", { caseId, status });
});
