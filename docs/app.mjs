import * as settings from "./config.mjs";
import { applicant } from "./firebase.mjs";
import { boundary } from "./boundary.mjs";
const $ = id => document.getElementById(id);
const application = $("application-form");
const question = $("question-form");
let map;
function startMap() {
  if (!$("application").hidden && !map) {
    if (!globalThis.L) {
      $("map").hidden = true;
      $("map-fallback").hidden = false;
      return;
    }
    $("map").hidden = false;
    $("map-fallback").hidden = true;
    map = L.map("map", { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).on("tileerror", () => { $("map-fallback").hidden = false; }).addTo(map);
    const layer = L.polygon(boundary.map(([lon, lat]) => [lat, lon]), {
      color: "#151e1a", weight: 2, fillColor: "#36785f", fillOpacity: .30, interactive: false
    }).addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  } else if (!$("application").hidden) {
    map.invalidateSize();
  }
}

const tabs = [...document.querySelectorAll('[role="tab"]')];
function showTab() {
  const current = location.hash === "#question" ? "question" : "application";
  for (const tab of tabs) {
    const panel = tab.getAttribute("aria-controls");
    const active = current === panel;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    $(panel).hidden = !active;
  }
  if (document.readyState === "complete") startMap();
}
for (const [index, tab] of tabs.entries()) {
  tab.onclick = () => { location.hash = tab.getAttribute("aria-controls"); };
  tab.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + 1) % tabs.length];
    next.click();
    next.focus();
  };
}
window.addEventListener("hashchange", showTab);
window.addEventListener("load", startMap);
showTab();

function applicationData(values) {
  if (values.area !== "inside") {
    throw new Error("対象区域が分からない場合は、質問・事前相談タブからご連絡ください。");
  }
  if (values.end < values.start) throw new Error("完工予定日は着工予定日以降を入力してください。");
  const pick = keys => Object.fromEntries(keys.map(key => [key, values[key]]));
  return {
    info: pick(["owner", "ownerAddress", "ownerPhone", "applicantAddress", "applicantPhone", "work", "start", "end"]),
    checks: Array.from({ length: 9 }, (_, i) => values[`clause${i + 1}`] === "on"),
    area: values.area
  };
}

function destination() {
  const address = settings.drawingEmail;
  if (!/^[^\s@?:/,;]+@[^\s@?:/,;]+\.[^\s@?:/,;]+$/.test(address ?? "")) {
    throw new Error("会のメール送付先の設定が準備中です。");
  }
  return address;
}

function draftUrl(address, subject, body) {
  return `mailto:${encodeURIComponent(address).replace("%40", "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`;
}

function mailLink(address, subject, body, label) {
  const link = document.createElement("a");
  link.href = draftUrl(address, subject, body);
  link.textContent = label;
  return link;
}

function appendText(result, text) {
  result.append(document.createElement("br"), document.createTextNode(text));
}

function caseUrl(id) {
  const url = new URL("./admin.html", location.href);
  url.searchParams.set("case", id);
  return url.href;
}

const maxDrawingBytes = 10 * 1024 * 1024;

function drawingUploadUrl() {
  const url = new URL(settings.drawingUploadUrl || "https://script.google.com/");
  if (url.origin !== "https://script.google.com" || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)
      || url.username || url.password || url.search || url.hash) {
    throw new Error("図面の提出先が準備中です。");
  }
  return url.href;
}

async function drawingFiles(files) {
  if (!files.length || files.length > 8 || files.reduce((sum, file) => sum + file.size, 0) > maxDrawingBytes) {
    throw new Error("PDFを１〜８件、合計10 MB以内で選んでください。");
  }
  return Promise.all(files.map(async file => {
    if (!/\.pdf$/i.test(file.name) || file.name.length > 160 || await file.slice(0, 5).text() !== "%PDF-") {
      throw new Error("選択したファイルをPDFでご用意ください。");
    }
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
      reader.onerror = () => reject(new Error("PDFを読み込めませんでした。"));
      reader.readAsDataURL(file);
    });
    return { name: file.name, data };
  }));
}

function postDrawings(url, payload, target) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  form.target = target;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = JSON.stringify(payload);
  form.append(input);
  document.body.append(form);
  form.submit();
  form.remove();
}

function showQuestionReceipt(result, id, values) {
  const subject = `【建築協約】質問・事前相談｜受付番号 ${id}`;
  const body = `受付番号：${id}\n氏名：${values.name}\n会社名：${values.company}\n建築場所：${values.address}\n返信先：${values.email}\n\n${values.message}\n\n会の管理画面：${caseUrl(id)}`;
  const address = destination();
  result.textContent = `台帳に登録しました。受付番号 ${id}。下のリンクからメールを開いて送信してください。`;
  if (draftUrl(address, subject, body).length <= 1800) {
    result.append(document.createElement("br"), mailLink(address, subject, body, "質問・相談のメールを開く"));
    return;
  }
  appendText(result, "下の本文をコピーして、メールに貼り付けてください。");
  const copy = document.createElement("textarea");
  copy.readOnly = true;
  copy.rows = 6;
  copy.setAttribute("aria-label", "コピー用のメール本文");
  copy.value = body;
  result.append(copy, mailLink(address, subject, "", "メールアプリを開く"));
}

function bindSubmission(form, result, type) {
  let attempt;
  let pending = false;
  form.addEventListener("input", () => { if (!attempt?.sending) attempt = undefined; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    const target = "drawing-receipt-" + crypto.randomUUID();
    const receiptWindow = type === "application" ? window.open("about:blank", target) : null;
    if (receiptWindow) receiptWindow.document.title = "図面送信の準備中";
    const values = Object.fromEntries(new FormData(form));
    const elements = [...form.elements];
    elements.forEach(control => { control.disabled = true; });
    try {
      if (!attempt) {
        const { name, company, address, email, confirm, message } = values;
        if (type === "application") drawingUploadUrl();
        else destination();
        const files = type === "application" ? await drawingFiles([...$("drawing-files").files]) : [];
        const extra = type === "application" ? applicationData(values) : { message: message.trim() };
        attempt = { id: crypto.randomUUID(), files,
          payload: { name: name.trim(), company: company.trim(), address: address.trim(),
            email: email.trim(), type, consent: confirm === "on", ...extra } };
      }
      attempt.sending = true;
      result.textContent = "送信の準備をしています…";
      const api = await applicant();
      const { ref, set, get, serverTimestamp } = api.databaseApi;
      const path = `cases/${attempt.id}`;
      const { area, ...payload } = attempt.payload;
      const details = type === "application" ? { areaDeclaration: area, agreementVersion: "1978-01-01", drawingStatus: "未受領", driveState: "uploading" } : {};
      try {
        await set(ref(api.db, path), { ...payload, ...details, uid: api.user.uid,
          submittedAt: serverTimestamp(), status: type === "application" ? "受付済" : "未回答" });
      } catch (error) {
        const saved = await get(ref(api.db, `${path}/submittedAt`)).catch(() => null);
        if (!saved?.exists()) throw error;
      }
      if (type === "application") {
        const [idToken, appCheck] = await Promise.all([api.user.getIdToken(), api.appCheckToken()]);
        postDrawings(drawingUploadUrl(), { id: attempt.id, idToken, appCheck, files: attempt.files },
          receiptWindow ? target : "_self");
        result.textContent = "送信結果は図面受付の画面でご確認ください。送信に失敗した場合はこの画面から再試行できます。";
      } else {
        showQuestionReceipt(result, attempt.id, attempt.payload);
        form.reset();
        attempt = undefined;
      }
    } catch (error) {
      receiptWindow?.close();
      const message = !error.code || error.code === "invalid-argument" ? error.message
        : "送信できませんでした。時間をおいて、もう一度送信してください。";
      result.textContent = message;
    } finally {
      if (attempt) attempt.sending = false;
      elements.forEach(control => { control.disabled = false; });
      pending = false;
    }
  });
}
bindSubmission(application, $("application-result"), "application");
bindSubmission(question, $("question-result"), "question");
