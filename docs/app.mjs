import { applicant } from "./firebase.mjs";
import { boundary } from "./boundary.mjs";
const $ = id => document.getElementById(id);
const application = $("application-form");
const question = $("question-form");
const limit = 50 * 1024 * 1024;
const labels = { combined: "４種類をまとめたPDF", guide: "案内図", site: "配置図", floor: "平面図", elevation: "立面図" };
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

function renderFiles() {
  const kinds = $("file-mode").value === "combined" ? ["combined"] : ["guide", "site", "floor", "elevation"];
  $("files").replaceChildren(...kinds.map(kind => {
    const label = document.createElement("label");
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "application/pdf,.pdf";
    file.name = kind;
    file.required = true;
    file.multiple = kind !== "combined";
    label.append(labels[kind], file);
    return label;
  }));
}
$("file-mode").onchange = renderFiles;
renderFiles();

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

function selectedFiles() {
  const selected = [...$("files").querySelectorAll("input")].flatMap(input =>
    [...input.files].map(file => ({ kind: input.name, file })));
  if (selected.length > 12 || selected.reduce((total, { file }) => total + file.size, 0) > limit) {
    throw new Error("図面は最大12ファイル、合計50 MB以内にしてください。");
  }
  if (selected.some(({ file }) => !file.size || !/\.pdf$/i.test(file.name) || file.name.length > 180)) {
    throw new Error("ファイル名180文字以内のPDFを添付してください。");
  }
  return selected;
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
        const extra = isApplication ? applicationData(values) : { message };
        attempt = { id: crypto.randomUUID(), ready: new Set(), files: isApplication ? selectedFiles() : [],
          payload: { name, company, address, email, type, confirm: confirm === "on", ...extra } };
      }
      attempt.sending = true;
      result.textContent = "送信の準備をしています…";
      const api = await applicant();
      const manifest = [];
      for (const [index, { file, kind }] of attempt.files.entries()) {
        const slot = String(index + 1).padStart(2, "0");
        if (!attempt.ready.has(slot)) {
          result.textContent = `図面をアップロードしています（${index + 1}/${attempt.files.length}）…`;
          const header = await file.slice(0, 5).text();
          if (header !== "%PDF-") throw new Error(`${file.name} はPDFとして読み込めません。`);
          await api.storageApi.uploadBytes(api.storageApi.ref(api.storage,
            `uploads/${api.user.uid}/${attempt.id}/${slot}`), file, { contentType: "application/pdf" });
          attempt.ready.add(slot);
        }
        manifest.push({ slot, name: file.name, kind });
      }
      result.textContent = "受付を確定しています…";
      const receipt = await api.call("submitAgreement", { ...attempt.payload, id: attempt.id, files: manifest });
      result.textContent = `受け付けました。会で内容を確認し、ご連絡します。\n受付番号 ${receipt.id}`;
      form.reset();
      if (form === application) renderFiles();
      attempt = undefined;
    } catch (error) {
      const message = !error.code || error.code === "functions/invalid-argument" ? error.message
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
