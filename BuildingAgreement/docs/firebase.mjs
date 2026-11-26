import { firebaseConfig, region, appCheckSiteKey } from "./config.mjs";
const sdk = "https://www.gstatic.com/firebasejs/11.10.0";
let connection;

export async function connect() {
  if (!connection) connection = initialize().catch(error => { connection = undefined; throw error; });
  return connection;
}

async function initialize() {
  if (!appCheckSiteKey) throw new Error("受付サービスの公開設定が準備中です。");
  const [appApi, authApi, functionsApi, appCheck, storageApi, databaseApi] = await Promise.all(
    ["app", "auth", "functions", "app-check", "storage", "database"].map(name => import(`${sdk}/firebase-${name}.js`))
  );
  const app = appApi.initializeApp(firebaseConfig);
  appCheck.initializeAppCheck(app, { provider: new appCheck.ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true });
  const auth = authApi.getAuth(app);
  const functions = functionsApi.getFunctions(app, region);
  await auth.authStateReady();
  return { auth, authApi, storageApi, storage: storageApi.getStorage(app),
    db: databaseApi.getDatabase(app), databaseApi,
    call: async (name, data) => (await functionsApi.httpsCallable(functions, name)(data)).data };
}

let login;
export async function applicant() {
  const api = await connect();
  if (!login) login = (async () => {
    await api.authApi.setPersistence(api.auth, api.authApi.browserSessionPersistence);
    const user = api.auth.currentUser;
    if (user && !user.isAnonymous) throw new Error("管理画面からログアウトしてから提出してください。");
    return user ?? (await api.authApi.signInAnonymously(api.auth)).user;
  })().finally(() => { login = undefined; });
  return { ...api, user: await login };
}
