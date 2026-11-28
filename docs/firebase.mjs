import { firebaseConfig, appCheckSiteKey } from "./config.mjs";
const sdk = "https://www.gstatic.com/firebasejs/11.10.0";
const connections = new Map();

export function connect() {
  return connectionFor("[DEFAULT]");
}

function connectionFor(name) {
  if (!connections.has(name)) {
    connections.set(name, initialize(name).catch(error => {
      connections.delete(name);
      throw error;
    }));
  }
  return connections.get(name);
}

async function initialize(name) {
  if (!appCheckSiteKey) throw new Error("受付サービスの公開設定が準備中です。");
  const [appApi, authApi, appCheck, databaseApi] = await Promise.all(
    ["app", "auth", "app-check", "database"].map(name => import(`${sdk}/firebase-${name}.js`))
  );
  const app = appApi.initializeApp(firebaseConfig, name);
  const attestation = appCheck.initializeAppCheck(app, { provider: new appCheck.ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true });
  const auth = authApi.getAuth(app);
  await auth.authStateReady();
  return { auth, authApi, appCheckToken: async () => (await appCheck.getToken(attestation)).token, db: databaseApi.getDatabase(app), databaseApi };
}

let login;
export async function applicant() {
  const api = await connectionFor("agreement-applicant");
  if (!login) login = (async () => {
    await api.authApi.setPersistence(api.auth, api.authApi.browserSessionPersistence);
    const user = api.auth.currentUser;
    return user ?? (await api.authApi.signInAnonymously(api.auth)).user;
  })().finally(() => { login = undefined; });
  return { ...api, user: await login };
}
