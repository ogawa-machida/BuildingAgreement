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

function showReceipt(result, id, type) {
  result.textContent = `受け付けました。受付番号 ${id}`;
  if (type !== "application") return;
  const address = settings.drawingEmail;
  const link = document.createElement("a");
  const subject = encodeURIComponent(`【建築協約】図面送付｜受付番号 ${id}`);
  const body = encodeURIComponent(`受付番号：${id}\n提出図面のPDFを添付して送信してください。\n`);
  link.href = `mailto:${encodeURIComponent(address).replace("%40", "@")}?subject=${subject}&body=${body}`;
  link.textContent = "図面送付用のメールを開く";
  result.append(document.createElement("br"), link,
    document.createTextNode(`（図面送付先：${address}）`));
}

function bindSubmission(form, result, type) {
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
        const { name, company, address, email, message, confirm } = values;
        const isApplication = type === "application";
        const extra = isApplication ? applicationData(values) : { message: message.trim() };
        if (isApplication && !/^[^\s@?:/]+@[^\s@?:/]+\.[^\s@?:/]+$/.test(settings.drawingEmail ?? "")) {
          throw new Error("図面送付先の設定が準備中です。");
        }
        attempt = { id: crypto.randomUUID(),
          payload: { name: name.trim(), company: company.trim(), address: address.trim(),
            email: email.trim(), type, consent: confirm === "on", ...extra } };
      }
      attempt.sending = true;
      result.textContent = "送信の準備をしています…";
      const api = await applicant();
      const { ref, set, get, serverTimestamp } = api.databaseApi;
      const path = `cases/${attempt.id}`;
      const { area, ...payload } = attempt.payload;
      const details = type === "application"
        ? { areaDeclaration: area, agreementVersion: "1978-01-01", drawingStatus: "未受領" } : {};
      try {
        await set(ref(api.db, path), { ...payload, ...details, uid: api.user.uid,
          submittedAt: serverTimestamp(), status: type === "application" ? "受付済" : "未回答" });
      } catch (error) {
        const saved = await get(ref(api.db, `${path}/submittedAt`)).catch(() => null);
        if (!saved?.exists()) throw error;
      }
      showReceipt(result, attempt.id, type);
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
bindSubmission(application, $("application-result"), "application");
bindSubmission(question, $("question-result"), "question");
