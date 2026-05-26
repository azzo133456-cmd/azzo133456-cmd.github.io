// ─────────────────────────────────────────
// 狀態
// ─────────────────────────────────────────
const API = "https://api.azzo133456.page";

// Hash ↔ mode 對照表
const ROUTES = { "": "fullhome", "LZ": "luzhu", "YM": "yangmei" };
const HASHES = { fullhome: "", luzhu: "LZ", yangmei: "YM" };

let mode = "fullhome";
let currentMarker = null;
let customMarkers = [];
let favMarkers = [];

// ─────────────────────────────────────────
// 任務清單（伺服器同步）
// ─────────────────────────────────────────
let taskCache = { luzhu: [], yangmei: [] }; // 本地快取

// ─────────────────────────────────────────
// 地圖初始化
// ─────────────────────────────────────────
const map = L.map("map", { zoomControl: false }).setView([25.033, 121.565], 12);
window.map = map;

L.control.zoom({ position: "bottomleft" }).addTo(map);
L.tileLayer("https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}", {
  maxZoom: 20,
  attribution: "© 國土測繪中心"
}).addTo(map);

window.addEventListener("load", () => {
  setTimeout(() => {
    map.invalidateSize();
    handleRoute();
  }, 200);
});

// BFCache（上一頁回來）時重新同步
window.addEventListener("pageshow", () => handleRoute());

window.addEventListener("hashchange", handleRoute);

// ─────────────────────────────────────────
// Hash Router
// ─────────────────────────────────────────
function handleRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const newMode = ROUTES[hash] ?? "fullhome";
  switchMode(newMode);
}

// 從 HTML onclick / 程式碼內部呼叫，統一走這裡
function enterMode(newMode) {
  const hash = HASHES[newMode] ?? "";
  const current = location.hash.replace(/^#\/?/, "");
  if (current !== hash) {
    location.hash = hash; // 觸發 hashchange → handleRoute → switchMode
  } else {
    switchMode(newMode);  // hash 沒變（重整同頁）直接切
  }
}

// ─────────────────────────────────────────
// 模式切換
// ─────────────────────────────────────────
function switchMode(newMode) {
  mode = newMode;

  const isRegion = mode === "luzhu" || mode === "yangmei";

  document.getElementById("fullHome").style.display  = mode === "fullhome" ? "flex" : "none";
  document.getElementById("favList").style.display   = isRegion ? "inline-block" : "none";
  document.getElementById("delFavBtn").style.display = isRegion ? "inline-block" : "none";

  // 清掉舊 markers
  favMarkers.forEach(m => map.removeLayer(m));
  favMarkers = [];

  if (mode === "fullhome") return;

  if (mode === "luzhu") {
    map.setView([25.012, 121.288], 13);
  } else if (mode === "yangmei") {
    map.setView([24.916, 121.135], 13);
  }

  loadAndRenderTasks(mode);
}

// ─────────────────────────────────────────
// 任務清單：從伺服器載入並渲染
// ─────────────────────────────────────────
async function loadAndRenderTasks(area) {
  const favList = document.getElementById("favList");
  favList.innerHTML = `<option value="">載入中…</option>`;

  try {
    const res  = await fetch(`${API}/tasks/${area}`);
    const list = await res.json();
    taskCache[area] = list;
    renderTaskList(area);
  } catch {
    favList.innerHTML = `<option value="">載入失敗</option>`;
  }
}

function renderTaskList(area) {
  const favList = document.getElementById("favList");
  const list    = taskCache[area] || [];

  favList.innerHTML = `<option value="">任務清單（${list.length}）</option>`;
  list.forEach(({ id }) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    favList.appendChild(opt);
  });

  // 清掉舊 markers 再畫新的
  favMarkers.forEach(m => map.removeLayer(m));
  favMarkers = list
    .filter(t => t.lat && t.lng)
    .map(t => {
      const m = L.marker([Number(t.lat), Number(t.lng)]).addTo(map);
      m.bindPopup(popupHTML(t, true));
      return m;
    });
}

// ─────────────────────────────────────────
// Popup HTML 模板
// ─────────────────────────────────────────
function popupHTML({ id, address, lat, lng, watt, col }, isFav = false) {
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const btn = isFav
    ? `<button onclick="removeFav('${id}')">刪除</button>`
    : `<button onclick="addFav('${id}')">加入清單</button>`;
  const addrEsc = (address || "").replace(/'/g, "\\'");
  return `
    <b>路燈編號：</b>${id}<br>
    ${address ? `<b>地址：</b>${address}<br>` : ""}
    <b>經緯度：</b>${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}<br>
    <span style="display:inline-flex;gap:16px;">
      <span><b>瓦數：</b>${watt != null ? watt + " W" : "—"}</span>
      <span><b>色溫：</b>${col  != null ? col  + " K" : "—"}</span>
    </span><br>
    <span style="display:inline-flex;gap:8px;margin-top:4px;">
      ${btn}
      <button onclick="openEdit('${id}','${addrEsc}',${watt ?? "null"},${col ?? "null"})">編輯</button>
    </span><br>
    <a href="${nav}" target="_blank">導航</a>
  `;
}

// ─────────────────────────────────────────
// 搜尋
// ─────────────────────────────────────────
function searchLamp() {
  const input = document.getElementById("lampInput");
  const id = input.value.trim();
  if (!id) return alert("請輸入路燈編號");
  showLamp(id);
  input.value = "";
}

document.getElementById("lampInput").addEventListener("keydown", e => {
  if (e.key === "Enter") searchLamp();
});

// ─────────────────────────────────────────
// 顯示路燈
// ─────────────────────────────────────────
async function showLamp(id) {
  const res = await fetch(`${API}/lamp/${encodeURIComponent(id)}`);
  const data = await res.json();

  if (data.error) return alert("查無此路燈編號");

  const lat = Number(data.lat);
  const lng = Number(data.lng);

  if (currentMarker) map.removeLayer(currentMarker);
  currentMarker = L.marker([lat, lng]).addTo(map);
  currentMarker.bindPopup(popupHTML(data));
  map.setView([lat, lng], 18);
  setTimeout(() => currentMarker.openPopup(), 300);
}

// ─────────────────────────────────────────
// 清單管理
// ─────────────────────────────────────────
async function addFav(id) {
  if (!["luzhu", "yangmei"].includes(mode)) return alert("請先選擇蘆竹或楊梅模式");
  if (taskCache[mode]?.some(t => t.id === id)) return alert("已在清單中");
  const res = await fetch(`${API}/tasks/${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  const result = await res.json();
  if (result.ok) {
    await loadAndRenderTasks(mode);
    alert("已加入清單");
  } else {
    alert(`❌ ${result.error}`);
  }
}

async function removeFav(id) {
  if (!["luzhu", "yangmei"].includes(mode)) return;
  await fetch(`${API}/tasks/${mode}/${encodeURIComponent(id)}`, { method: "DELETE" });
  await loadAndRenderTasks(mode);
}

async function deleteFav() {
  const id = document.getElementById("favList").value;
  if (!id) return alert("請先選擇要刪除的路燈");
  await removeFav(id);
}

document.getElementById("favList").addEventListener("change", function () {
  const item = taskCache[mode]?.find(t => t.id === this.value);
  if (item?.lat && item?.lng) map.setView([Number(item.lat), Number(item.lng)], 18);
});

// ─────────────────────────────────────────
// 定位 + 最近路燈
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// 單筆編輯
// ─────────────────────────────────────────
let _editId = null;

function openEdit(id, address, watt, col) {
  _editId = id;
  document.getElementById("editId").textContent = `編號：${id}`;
  document.getElementById("editAddress").value = address || "";
  document.getElementById("editWatt").value    = watt ?? "";
  document.getElementById("editCol").value     = col  ?? "";
  document.getElementById("editStatus").textContent = "";
  document.getElementById("editModal").style.display = "flex";
}

async function saveEdit() {
  if (!_editId) return;
  const status = document.getElementById("editStatus");
  status.textContent = "儲存中…";

  const body = {
    address: document.getElementById("editAddress").value.trim() || null,
    watt:    document.getElementById("editWatt").value !== "" ? Number(document.getElementById("editWatt").value) : null,
    col:     document.getElementById("editCol").value  !== "" ? Number(document.getElementById("editCol").value)  : null,
  };

  try {
    const res    = await fetch(`${API}/lamp/${encodeURIComponent(_editId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await res.json();
    if (result.ok) {
      status.textContent = "✅ 儲存成功";
      setTimeout(() => document.getElementById("editModal").style.display = "none", 800);
    } else {
      status.textContent = `❌ ${result.error}`;
    }
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
  }
}

// ─────────────────────────────────────────
// 管理員 / 匯入
// ─────────────────────────────────────────
function openImport() {
  const modal = document.getElementById("importModal");
  modal.style.display = "flex";
}

async function doImport() {
  const fileInput  = document.getElementById("importFile");
  const areasInput = document.getElementById("importAreas");
  const status     = document.getElementById("importStatus");
  const btn        = document.getElementById("importBtn");

  if (!fileInput.files.length) { status.textContent = "請選擇檔案"; return; }

  status.textContent = "解析中…";
  btn.disabled = true;

  try {
    const buf  = await fileInput.files[0].arrayBuffer();
    const wb   = XLSX.read(buf, { type: "array", raw: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const allRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

    if (!allRows.length) throw new Error("檔案內無資料");

    // 只保留後端 COL_MAP 認識的欄位，丟掉其餘無用欄位
    const KNOWN_COLS = new Set([
      "路燈編號","開關箱編號","id",
      "地址","詳細位置","address",
      "緯度","lat","經度","lng",
      "燈泡瓦數","瓦特數","watt",
      "色溫","col",
      "X","Y",
      "區域","行政區"
    ]);
    const rows = allRows.map(r => {
      const slim = {};
      for (const k of Object.keys(r)) {
        if (KNOWN_COLS.has(k.trim())) slim[k] = r[k];
      }
      return slim;
    });

    // 解析行政區篩選（逗號或頓號分隔）
    const areasRaw = areasInput.value.trim();
    const areas = areasRaw
      ? areasRaw.split(/[,，、]/).map(a => a.trim()).filter(Boolean)
      : [];

    const BATCH = 2000;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const r = await fetch(`${API}/import`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ data: chunk, areas })
      });
      const result = await r.json();
      if (!result.ok) throw new Error(result.error);
      done += chunk.length;
      const pct = Math.round(done / rows.length * 100);
      status.textContent = `上傳中… ${pct}%（${done} / ${rows.length} 筆）`;
    }

    status.textContent = `✅ 匯入完成：${done} 筆`;
    fileInput.value = "";
  } catch (e) {
    status.textContent = `❌ 錯誤：${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

function locateUser() {
  if (!navigator.geolocation) return alert("此瀏覽器不支援定位功能");

  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    const { latitude: lat, longitude: lng } = coords;

    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = L.marker([lat, lng], {
      icon: L.icon({
        iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/blue-dot.png",
        iconSize: [32, 32]
      })
    }).addTo(map).bindPopup("你在這裡");

    map.setView([lat, lng], 18);
    setTimeout(() => currentMarker.openPopup(), 300);

    const res = await fetch(`${API}/nearest?lat=${lat}&lng=${lng}`);
    const nearest = await res.json();

    if (nearest?.id) {
      const dist = Math.round(nearest.distance * 1000);
      alert(`最近的路燈${dist <= 50 ? "" : "超過 50 公尺，"}距離你約 ${dist} 公尺`);
      showLamp(nearest.id);
    }
  }, () => alert("無法取得定位資訊"));
}
