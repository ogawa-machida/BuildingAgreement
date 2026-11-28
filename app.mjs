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

function showReceipt(result, id, email, files) {
  const address = destination();
  const subject = `【建築協約】図面送付｜受付番号 ${id}`;
  const body = `受付番号：${id}\nフォームに入力した返信先：${email}\n`;
  result.textContent = `申請を受け付けました。受付番号 ${id}。図面をメールで送信してください。`;
  appendText(result, `宛先：${address}　件名：${subject}`);
  appendText(result, `選択したPDF：${files.map(file => file.name).join("、")}`);
  const shareData = { files, title: subject, text: `宛先：${address}\n件名：${subject}\n${body}` };
  const shareStatus = document.createElement("span");
  if (navigator.share && navigator.canShare?.({ files })) {
    const share = document.createElement("button");
    share.type = "button";
    share.textContent = "PDFを共有してメールアプリを選ぶ";
    share.onclick = async () => {
      try {
        await navigator.share(shareData);
        shareStatus.textContent = "メールアプリで宛先・件名・添付を確認して送信してください。";
      } catch (error) {
        if (error.name !== "AbortError") shareStatus.textContent = "PDFを渡せませんでした。下のリンクからメールを開き、手動で添付してください。";
      }
    };
    appendText(result, "共有メニューでメールを選び、上記の宛先と件名を確認してください。");
    result.append(document.createElement("br"), share, document.createElement("br"), shareStatus);
  }
  result.append(document.createElement("br"),
    mailLink(address, subject, body + "提出図面のPDFを添付して送信します。\n", "宛先・件名入りのメールを開く（PDFは手動で添付）"));
}

question.addEventListener("submit", event => {
  event.preventDefault();
  const result = $("question-result");
  try {
    const address = destination();
    const { name, company, address: site, email, message } = Object.fromEntries(new FormData(question));
    const subject = "【建築協約】質問・事前相談";
    const body = `氏名：${name.trim()}\n会社名：${company.trim()}\n建築場所：${site.trim()}\n返信先：${email.trim()}\n\n${message.trim()}`;
    const url = draftUrl(address, subject, body);
    result.textContent = "メールアプリで差出人と内容を確認し、送信してください。この画面では送信完了を確認できません。";
    if (url.length <= 1800) {
      result.append(document.createElement("br"), mailLink(address, subject, body, "メールアプリをもう一度開く"));
      location.href = url;
    } else {
      appendText(result, "文章が長いため、下の本文をコピーしてメールに貼り付けてください。");
      const copy = document.createElement("textarea");
      copy.readOnly = true;
      copy.rows = 6;
      copy.setAttribute("aria-label", "コピー用のメール本文");
      copy.value = body;
      result.append(copy, mailLink(address, subject, "", "メールアプリを開く"));
    }
  } catch (error) {
    result.textContent = error.message;
  }
});

function bindApplication(form, result) {
  let attempt;
  let pending = false;
  form.addEventListener("input", () => { if (!attempt?.sending) attempt = undefined; });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    const values = Object.fromEntries(new FormData(form));
    const elements = [...form.elements];
    elements.forEach(control => { control.disabled = true; });
    try {
      if (!attempt) {
        const { name, company, address, email, confirm } = values;
        destination();
        const files = [...$("drawing-files").files];
        if (!files.length || files.some(file => !file.size || !/\.pdf$/i.test(file.name))) {
          throw new Error("空でないPDFを選択してください。");
        }
        const extra = applicationData(values);
        attempt = { id: crypto.randomUUID(), files,
          payload: { name: name.trim(), company: company.trim(), address: address.trim(),
            email: email.trim(), type: "application", consent: confirm === "on", ...extra } };
      }
      attempt.sending = true;
      result.textContent = "送信の準備をしています…";
      const api = await applicant();
      const { ref, set, get, serverTimestamp } = api.databaseApi;
      const path = `cases/${attempt.id}`;
      const { area, ...payload } = attempt.payload;
      const details = { areaDeclaration: area, agreementVersion: "1978-01-01", drawingStatus: "未受領" };
      try {
        await set(ref(api.db, path), { ...payload, ...details, uid: api.user.uid,
          submittedAt: serverTimestamp(), status: "受付済" });
      } catch (error) {
        const saved = await get(ref(api.db, `${path}/submittedAt`)).catch(() => null);
        if (!saved?.exists()) throw error;
      }
      showReceipt(result, attempt.id, attempt.payload.email, attempt.files);
      form.reset();
      attempt = undefined;
    } catch (error) {
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
bindApplication(application, $("application-result"));
