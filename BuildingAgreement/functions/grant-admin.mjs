import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
const [, , email, action = "grant"] = process.argv;
if (!email || !["grant", "revoke"].includes(action)) {
  console.error("Usage: node grant-admin.mjs EMAIL [grant|revoke]");
  process.exit(1);
}
initializeApp({ credential: applicationDefault(), projectId: "buildingagreement-9ee19" });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
const claims = { ...user.customClaims };
if (action === "grant") claims.agreementAdmin = true;
else delete claims.agreementAdmin;
await auth.setCustomUserClaims(user.uid, claims);
if (action === "revoke") await auth.revokeRefreshTokens(user.uid);
console.log("Updated agreementAdmin for", user.uid);
