import { connect } from "./firebase.mjs";
const $ = id => document.getElementById(id);
const status = $("status");
const detail = $("detail");
const list = $("cases");
const date = milliseconds => new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo"
}).format(new Date(milliseconds));
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
const requestedCase = new URLSearchParams(location.search).get("case");
const validCaseId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function openCaseById(id) {
  if (!validCaseId.test(id ?? "")) {
    if (id) status.textContent = "受付番号の形式を確認してください。";
    return;
  }
  const { get, ref } = api.databaseApi;
  const snapshot = await get(ref(api.db, `cases/${id}`));
  if (snapshot.exists()) openCase({ ...snapshot.val(), id });
  else status.textContent = "指定された受付番号の案件が見つかりません。";
}

function gmailThreadUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  if (url.origin !== "https://mail.google.com" || url.username || url.password
      || !/^\/mail\/u\/[^/]+\/$/.test(url.pathname) || !/^#[^\s]+\/[A-Za-z0-9_-]+$/.test(url.hash)) {
    throw new Error("Gmailでメールを開いたときのURLを入力してください。");
  }
  return url.href;
}


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
function drawingWorkflow(row) {
  const section = element("section");
  section.append(element("h3", "提出図面・竣工確認"));
  if (row.driveState === "uploading") {
    section.append(element("p", "図面の提出待ち"));
    return section;
  }
  if (row.approvedAt) section.append(element("p", "建築承認日時：" + date(row.approvedAt)));
  if (row.completedAt) section.append(element("p", "竣工確認日時：" + date(row.completedAt)));
  if (row.drawingsDeletedAt) {
    section.append(element("p", "図面削除済み：" + date(row.drawingsDeletedAt)));
    return section;
  }
  if (row.completedAt) {
    section.append(element("p", "図面削除待ち。自動処理の結果は「一覧を更新」で確認できます。"));
    return section;
  }
  if (row.approvedAt) section.append(element("p", "承認済み・竣工待ち"));
  const files = element("ul");
  for (const file of Object.values(row.drawingFiles ?? {})) {
    if (!/^[A-Za-z0-9_-]+$/.test(file.id)) continue;
    const item = element("li");
    const link = element("a", file.name);
    link.href = "https://drive.google.com/file/d/" + file.id + "/view";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.append(link);
    files.append(item);
  }
  section.append(files);
  const complete = Boolean(row.approvedAt);
  const button = element("button", complete ? "竣工確認を記録" : "建築承認を記録");
  const result = element("output");
  result.setAttribute("role", "status");
  button.onclick = async () => {
    if (complete && !window.confirm("実際の竣工を確認しましたか？ この案件の図面が自動で完全削除されます。")) return;
    button.disabled = true;
    try {
      const { ref, update, push, serverTimestamp } = api.databaseApi;
      const path = `cases/${row.id}`;
      const key = push(ref(api.db, `${path}/history`)).key;
      const changes = complete ? { completedAt: serverTimestamp(), purgeRequested: true }
        : { approvedAt: serverTimestamp() };
      await update(ref(api.db, path), { ...changes,
        [`history/${key}`]: { at: serverTimestamp(), summary: complete ? "竣工確認・図面削除待ち" : "建築承認・竣工待ち" } });
      await listCases();
      await openCaseById(row.id);
    } catch {
      result.textContent = "結果を表示できませんでした。「一覧を更新」で記録を確認してください。";
    } finally {
      button.disabled = false;
    }
  };
  section.append(button, result);
  return section;
}

function openCase(row) {
  selected = row.id;
  const heading = element("h2", row.type === "application" ? "建築承認願い" : "質問・事前相談");
  const email = element("a", "メールアプリで新規連絡を作成");
  email.href = "mailto:" + encodeURIComponent(row.email).replace("%40", "@") + "?subject=" + encodeURIComponent(`【建築協約】受付番号 ${row.id}`);
  const summary = element("pre", `受付番号　${row.id}\n受付日時　${date(row.submittedAt)}\n氏名　${row.name}\n会社名　${row.company}\n建築場所　${row.address}\nメール　${row.email}`);
  detail.replaceChildren(heading, summary, email);
  if (row.type === "application") {
    detail.append(element("h3", "工事と連絡先"), element("pre", toLines(row.info, infoNames)),
      element("h3", "協約の自己確認"), element("pre", Array.isArray(row.checks)
        ? row.checks.map((checked, i) => `${i + 1}） ${checked ? "確認済み" : "未確認"}`).join("\n")
        : toLines(row.answers ?? {}, answerNames)),
      row.driveState ? drawingWorkflow(row)
        : element("p", "過去にメール提出された図面は受付番号で照合してください。"));
  } else {
    detail.append(element("h3", "相談内容"), element("pre", row.message));
  }
  const states = row.type === "application" ? ["受付済", "確認中", "修正待ち", "別途協議中", "確認完了"]
    : ["未回答", "対応中", "回答済"];
  const state = selectField("対応状況", states, row.status);
  const area = selectField("会による区域の確認", ["未確認", "区域内", "区域外", "要協議"], row.areaReview);
  const drawing = row.type === "application" && !row.driveState
    ? selectField("図面の受領状況", ["未受領", "受領済み", "差し替え待ち"], row.drawingStatus) : null;
  const mail = selectField("メール対応", ["メール待ち", "メール受領", "返信済み"], row.mailStatus);
  const threadLabel = element("label", "GmailのスレッドURL");
  const thread = element("input");
  thread.type = "url";
  thread.maxLength = 500;
  thread.value = row.gmailThreadUrl ?? "";
  threadLabel.append(thread);
  const gmail = element("a", row.gmailThreadUrl ? "元のメールをGmailで開いて返信" : "受付番号でGmailを検索");
  try {
    gmail.href = gmailThreadUrl(row.gmailThreadUrl) || "https://mail.google.com/mail/u/0/#search/" + encodeURIComponent(row.id);
  } catch {
    gmail.href = "https://mail.google.com/mail/u/0/#search/" + encodeURIComponent(row.id);
  }
  gmail.target = "_blank";
  gmail.rel = "noopener noreferrer";
  const history = element("ul");
  const renderHistory = () => {
    const entries = Object.values(row.history ?? {}).sort((a, b) => b.at - a.at);
    history.replaceChildren(...entries.map(entry => element("li", `${date(entry.at)}　${entry.summary}`)));
    if (!entries.length) history.append(element("li", "対応履歴はまだありません。"));
  };
  renderHistory();
  const notes = element("label", "内部メモ");
  const textarea = element("textarea");
  textarea.maxLength = 4000;
  textarea.value = row.note ?? "";
  notes.append(textarea);
  const save = element("button", "対応状況を保存");
  const result = element("output");
  result.setAttribute("role", "status");
  save.onclick = async () => {
    save.disabled = true;
    try {
      const changes = {
        status: state.select.value, areaReview: area.select.value, note: textarea.value,
        mailStatus: mail.select.value, gmailThreadUrl: gmailThreadUrl(thread.value.trim())
      };
      if (drawing) changes.drawingStatus = drawing.select.value;
      const labels = { status: "対応状況", areaReview: "区域確認", drawingStatus: "図面",
        mailStatus: "メール", note: "内部メモ", gmailThreadUrl: "Gmailリンク" };
      const summary = Object.entries(changes).filter(([key, value]) => row[key] !== value)
        .map(([key, value]) => ["note", "gmailThreadUrl"].includes(key) ? labels[key] + "を更新" : labels[key] + "：" + value)
        .join("、");
      if (!summary) {
        result.textContent = "変更はありません。";
        return;
      }
      const { ref, update, push, serverTimestamp } = api.databaseApi;
      const casePath = `cases/${row.id}`;
      const entryId = push(ref(api.db, `${casePath}/history`)).key;
      await update(ref(api.db, casePath), { ...changes,
        [`history/${entryId}`]: { at: serverTimestamp(), summary } });
      Object.assign(row, changes);
      row.history = { ...row.history, [entryId]: { at: Date.now(), summary } };
      const listed = records.find(item => item.id === row.id);
      if (listed) Object.assign(listed, row);
      gmail.href = changes.gmailThreadUrl || "https://mail.google.com/mail/u/0/#search/" + encodeURIComponent(row.id);
      gmail.textContent = changes.gmailThreadUrl ? "元のメールをGmailで開いて返信" : "受付番号でGmailを検索";
      renderHistory();
      renderList();
      result.textContent = "保存しました。";
    } catch {
      result.textContent = "保存できませんでした。";
    } finally {
      save.disabled = false;
    }
  };
  detail.append(state.wrapper, area.wrapper);
  if (drawing) detail.append(drawing.wrapper);
  detail.append(mail.wrapper, threadLabel, gmail,
    element("p", "Thunderbirdで元のメールに返信する場合は、受付番号で検索してください。送信後はメール対応を「返信済み」にして保存します。"),
    notes, save, result, element("h3", "対応履歴"), history);
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
    if (requestedCase) await openCaseById(requestedCase);
  };
  $("filter").oninput = renderList;
  $("refresh").onclick = async () => {
    try {
      await listCases();
      const current = records.find(row => row.id === selected);
      if (current) openCase(current);
      else if (selected) await openCaseById(selected);
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
