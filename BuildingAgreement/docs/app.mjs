import { applicant } from "./firebase.mjs";
import { assessPoint } from "./area.mjs";
import { boundary } from "./boundary.mjs";
const $ = id => document.getElementById(id);
const application = $("application-form");
const question = $("question-form");
const lookup = $("lookup");
const output = $("area-result");
const limit = 50 * 1024 * 1024;
const labels = { combined: "４種類をまとめたPDF", guide: "案内図", site: "配置図", floor: "平面図", elevation: "立面図" };
const verdict = { inside: "対象区域内の地点です。", outside: "対象区域外の地点です。",
  review: "境界付近です。敷地の範囲について、会にご相談ください。" };

for (const name of ["use", "multi", "retaining", "utilities", "exception"]) {
  const select = application.elements[name];
  for (const [label, value] of [["選択してください", ""], ["はい", "yes"], ["いいえ", "no"], ["判断できない", "unknown"]]) {
    select.add(new Option(label, value));
  }
}

let map;
let marker;
function mark(lat, lon) {
  if (!map) return;
  marker ??= L.marker([lat, lon]).addTo(map);
  marker.setLatLng([lat, lon]);
  map.panInside([lat, lon]);
}
function startMap() {
  if (!globalThis.L) {
    $("map").hidden = true;
    return;
  }
  map = L.map("map", { scrollWheelZoom: false });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  const layer = L.polygon(boundary.map(([lon, lat]) => [lat, lon]), {
    color: "#151e1a", weight: 2, fillColor: "#36785f", fillOpacity: .30, interactive: false
  }).addTo(map);
  map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  map.on("click", ({ latlng: { lat, lng } }) => {
    mark(lat, lng);
    output.textContent = `地図上で選んだ地点の目安｜${verdict[assessPoint(lng, lat)]}`;
  });
}
if (document.readyState === "complete") startMap();
else window.addEventListener("load", startMap);

const addressValue = () => lookup.elements.address.value.trim();
lookup.addEventListener("input", () => { output.textContent = ""; });
lookup.addEventListener("submit", async event => {
  event.preventDefault();
  const address = addressValue();
  const type = lookup.elements.type.value;
  const button = event.submitter;
  button.disabled = true;
  output.textContent = "所在地を検索しています…";
  try {
    const api = await applicant();
    const normalized = address.normalize("NFKC");
    const query = /^小川[一二12]/.test(normalized) ? `東京都町田市${address}`
      : normalized.startsWith("町田市") ? `東京都${address}` : address;
    const result = await api.call("lookupAddress", { address: query, type });
    if (addressValue() !== address || lookup.elements.type.value !== type) return;
    if (result.reason) {
      output.textContent = result.reason === "setup"
        ? "住所検索は準備中です。地図で位置を確認するか、会にご相談ください。"
        : "入力から正確な地点を特定できません。地図で位置を確認するか、会にご相談ください。";
      return;
    }
    mark(result.lat, result.lon);
    output.textContent = `${result.matched}\n${verdict[assessPoint(result.lon, result.lat)]}${result.attribution ? "\n" + result.attribution : ""}`;
  } catch (error) {
    if (addressValue() === address && lookup.elements.type.value === type) {
      output.textContent = "住所検索を利用できません。地図で位置を確認するか、会にご相談ください。";
    }
  } finally {
    button.disabled = false;
  }
});
function transferAddress(form, hash) {
  form.elements.address.value = addressValue();
  if (form === application) application.elements.area.value = "";
  location.hash = hash;
  form.elements.address.focus();
}
$("apply-address").onclick = () => transferAddress(application, "application");
$("ask-address").onclick = () => transferAddress(question, "question");
$("transfer-question").onclick = () => {
  for (const name of ["address", "name", "email", "company"]) {
    const value = application.elements[name].value.trim();
    if (value) question.elements[name].value = value;
  }
  location.hash = "question";
  question.elements.message.focus();
};

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
  if (values.area !== "inside" || values.exception !== "no" || values.use !== "yes" || values.multi !== "no" ||
      Number(values.stories) > 2 || Number(values.height) > 9 || Number(values.eaves) > 6.5 ||
      Number(values.setback) < 1 || values.retaining !== "no" || values.utilities !== "yes") {
    throw new Error("会での確認が必要です。「入力を引き継いで相談する」からご連絡ください。");
  }
  if (values.end < values.start) throw new Error("完工予定日は着工予定日以降を入力してください。");
  const pick = keys => Object.fromEntries(keys.map(key => [key, values[key]]));
  return {
    info: pick(["owner", "ownerAddress", "ownerPhone", "applicantAddress", "applicantPhone", "work", "start", "end"]),
    answers: pick(["use", "multi", "stories", "height", "eaves", "setback", "retaining", "equipment", "living", "workNoise", "utilities"]),
    area: values.area, exception: values.exception
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
