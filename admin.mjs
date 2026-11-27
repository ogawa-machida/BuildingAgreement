import { connect } from "./firebase.mjs";
const $ = id => document.getElementById(id);
const status = $("status");
const detail = $("detail");
const list = $("cases");
const date = milliseconds => new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo"
}).format(new Date(milliseconds));
const captions = { guide: "案内図", site: "配置図", floor: "平面図", elevation: "立面図", combined: "一括PDF" };
const answerNames = { use: "１）一戸建専用住宅", multi: "２）集合住宅", stories: "３）地上階数",
  height: "４）建築物の高さ（m）", eaves: "４）軒の高さ（m）",
  setback: "５）境界からの距離（m）", retaining: "６）よう壁の増積等",
  equipment: "７）発生源への配慮", living: "８）生活騒音対策",
  workNoise: "８）工事騒音対策", utilities: "９）各設備の完備" };
const infoNames = { owner: "施主氏名", ownerAddress: "施主住所", ownerPhone: "施主電話",
  applicantAddress: "申請人住所", applicantPhone: "申請人電話", work: "工事区分", start: "着工予定", end: "完工予定" };
const valueNames = { yes: "はい", no: "いいえ", new: "新築", addition: "増築" };
const api = await connect().catch(error => { status.textContent = error.message; });
let records = [];
let selected;

function element(tag, content) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  return node;
}
function selectField(label, values, current) {
  const wrapper = element("label", label);
  const select = element("select");
  for (const choice of values) select.add(new Option(choice, choice));
  select.value = current ?? values[0];
  wrapper.append(select);
  return { wrapper, select };
}
function toLines(data, names) {
  return Object.entries(names).map(([key, label]) => `${label}　${valueNames[data[key]] ?? data[key] ?? ""}`).join("\n");
}
async function listCases() {
  const { get, query, ref, orderByChild, limitToLast } = api.databaseApi;
  const snapshot = await get(query(ref(api.db, "cases"), orderByChild("submittedAt"), limitToLast(200)));
  const nextRecords = [];
  snapshot.forEach(child => { nextRecords.push({ id: child.key, ...child.val() }); });
  records = nextRecords.reverse();
  renderList();
}
function renderList() {
  const keyword = $("filter").value.trim().toLowerCase();
  const filtered = records.filter(row => [row.id, row.name, row.address, row.status, row.company]
    .some(value => String(value ?? "").toLowerCase().includes(keyword)));
  list.replaceChildren(...filtered.map(row => {
    const item = element("li");
    const button = element("button", `${row.type === "application" ? "申請" : "質問"}｜${row.name}｜${row.status}`);
    button.addEventListener("click", () => openCase(row));
    item.append(button, element("p", `${date(row.submittedAt)}　${row.address ?? ""}`));
    return item;
  }));
  if (!filtered.length) list.append(element("li", "該当する案件がありません。"));
}
function openCase(row) {
  selected = row.id;
  const heading = element("h2", row.type === "application" ? "建築承認願い" : "質問・事前相談");
  const email = element("a", "申請者にメールで連絡");
  email.href = "mailto:" + encodeURIComponent(row.email).replace("%40", "@");
  const summary = element("pre", `受付番号　${row.id}\n受付日時　${date(row.submittedAt)}\n氏名　${row.name}\n会社名　${row.company}\n建築場所　${row.address}\nメール　${row.email}`);
  detail.replaceChildren(heading, summary, email);
  if (row.type === "application") {
    const files = element("ul");
    for (const file of row.files ?? []) {
      const item = element("li");
      const button = element("button", `${captions[file.kind]}を保存`);
      item.append(button, element("p", file.name));
      button.onclick = async () => {
        button.disabled = true;
        try {
          const { ref, getBlob } = api.storageApi;
          const blob = await getBlob(ref(api.storage, file.path), 50 * 1024 * 1024);
          const url = URL.createObjectURL(blob);
          const link = element("a");
          link.href = url;
          link.download = file.name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        } catch {
          status.textContent = "図面を取得できません。管理権限とStorageの設定を確認してください。";
        } finally {
          button.disabled = false;
        }
      };
      files.append(item);
    }
    detail.append(element("h3", "工事と連絡先"), element("pre", toLines(row.info, infoNames)),
      element("h3", "協約の自己確認"), element("pre", Array.isArray(row.checks)
        ? row.checks.map((checked, i) => `${i + 1}） ${checked ? "確認済み" : "未確認"}`).join("\n")
        : toLines(row.answers ?? {}, answerNames)),
      element("h3", "提出図面"), files);
  } else {
    detail.append(element("h3", "相談内容"), element("pre", row.message));
  }
  const states = row.type === "application" ? ["受付済", "確認中", "修正待ち", "別途協議中", "確認完了"]
    : ["未回答", "対応中", "回答済"];
  const state = selectField("対応状況", states, row.status);
  const area = selectField("会による区域の確認", ["未確認", "区域内", "区域外", "要協議"], row.areaReview);
  const notes = element("label", "内部メモ");
  const textarea = element("textarea");
  textarea.lang = "ja";
  textarea.inputMode = "text";
  textarea.maxLength = 4000;
  textarea.value = row.note ?? "";
  notes.append(textarea);
  const save = element("button", "対応状況を保存");
  const result = element("output");
  result.setAttribute("role", "status");
  save.onclick = async () => {
    save.disabled = true;
    try {
      const update = { id: row.id, status: state.select.value, areaReview: area.select.value, note: textarea.value };
      await api.call("updateAgreement", update);
      Object.assign(row, update);
      renderList();
      result.textContent = "保存しました。";
    } catch {
      result.textContent = "保存できませんでした。";
    } finally {
      save.disabled = false;
    }
  };
  detail.append(state.wrapper, area.wrapper, notes, save, result);
  detail.hidden = false;
  detail.scrollIntoView({ block: "start" });
}
if (api) {
  $("login-button").disabled = false;
  const showLogin = async () => {
    $("login-section").hidden = false;
    $("admin").hidden = true;
    detail.hidden = true;
    detail.replaceChildren();
    records = [];
    renderList();
    selected = undefined;
  };
  const showAdmin = async user => {
    if (!user || user.isAnonymous || (await user.getIdTokenResult(true)).claims.agreementAdmin !== true) {
      throw new Error("会の管理権限がありません。");
    }
    await listCases();
    $("login-section").hidden = true;
    $("admin").hidden = false;
    status.textContent = "";
  };
  $("filter").oninput = renderList;
  $("refresh").onclick = async () => {
    try {
      await listCases();
      const current = records.find(row => row.id === selected);
      if (current) openCase(current);
      else detail.hidden = true;
    } catch {
      status.textContent = "一覧を更新できませんでした。";
    }
  };
  $("logout").onclick = async () => {
    await api.authApi.signOut(api.auth);
    await showLogin();
  };
  $("login").onsubmit = async event => {
    event.preventDefault();
    event.submitter.disabled = true;
    const form = event.currentTarget;
    try {
      if (api.auth.currentUser?.isAnonymous) await api.authApi.signOut(api.auth);
      await api.authApi.setPersistence(api.auth, api.authApi.browserSessionPersistence);
      const result = await api.authApi.signInWithEmailAndPassword(api.auth, form.elements.email.value.trim(), form.elements.password.value);
      await showAdmin(result.user);
      form.reset();
    } catch (error) {
      await api.authApi.signOut(api.auth);
      await showLogin();
      status.textContent = error.code ? "ログインまたは一覧の取得に失敗しました。" : error.message;
    } finally {
      event.submitter.disabled = false;
    }
  };
  if (api.auth.currentUser && !api.auth.currentUser.isAnonymous) {
    await showAdmin(api.auth.currentUser).catch(error => { status.textContent = error.message; });
  }
}
