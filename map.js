// ─────────────────────────────────────────
// 狀態
// ─────────────────────────────────────────
const API = "https://api.azzo133456.page";

// Hash ↔ mode 對照表
const ROUTES = { "": "fullhome", "home": "home", "LZ": "luzhu", "YM": "yangmei" };
const HASHES = { fullhome: "", home: "home", luzhu: "LZ", yangmei: "YM" };

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

  document.getElementById("fullHome").style.display       = mode === "fullhome" ? "flex" : "none";
  document.getElementById("taskListBtn").style.display    = isRegion ? "inline-block" : "none";
  document.getElementById("addLocationBtn").style.display = isRegion ? "inline-block" : "none";
  document.getElementById("backBtn").style.display        = mode !== "fullhome" ? "inline-block" : "none";

  favMarkers.forEach(m => map.removeLayer(m));
  favMarkers = [];

  closeTaskPanel();

  if (mode === "fullhome") return;
  if (mode === "home") { map.setView([25.033, 121.565], 12); return; }

  if (mode === "luzhu")   map.setView([25.012, 121.288], 13);
  if (mode === "yangmei") map.setView([24.916, 121.135], 13);

  loadAndRenderTasks(mode);
}

// ─────────────────────────────────────────
// 任務清單：載入、渲染、面板開關
// ─────────────────────────────────────────
async function loadAndRenderTasks(area) {
  try {
    const res  = await fetch(`${API}/tasks/${area}`);
    const list = await res.json();
    taskCache[area] = list;
    renderTaskList(area);
  } catch {
    document.getElementById("taskCards").innerHTML = `<p class="task-empty">載入失敗</p>`;
  }
}

function renderTaskList(area) {
  const list    = taskCache[area] || [];
  const cards   = document.getElementById("taskCards");
  const countEl = document.getElementById("taskCount");

  countEl.textContent = list.length;

  if (!list.length) {
    cards.innerHTML = `<p class="task-empty">清單是空的<br>搜尋路燈後點「加入清單」</p>`;
    favMarkers.forEach(m => map.removeLayer(m));
    favMarkers = [];
    return;
  }

  cards.innerHTML = list.map(t => {
    const name    = t.is_custom ? (t.address || t.id) : t.id;
    const addr    = (!t.is_custom && t.address) ? t.address : "";
    const meta    = [t.watt ? t.watt + "W" : "", t.col ? t.col + "K" : ""].filter(Boolean).join("　");
    const icon    = t.is_custom ? "📍" : "💡";
    return `
      <div class="task-card" onclick="goToTask('${t.id}')">
        <span class="task-card-icon">${icon}</span>
        <div class="task-card-body">
          <div class="task-card-id">${name}</div>
          ${addr ? `<div class="task-card-addr">${addr}</div>` : ""}
          ${meta ? `<div class="task-card-meta">${meta}</div>` : ""}
        </div>
        <button class="task-del-btn" onclick="event.stopPropagation();removeFav('${t.id}')">×</button>
      </div>`;
  }).join("");

  // 重繪 markers
  favMarkers.forEach(m => map.removeLayer(m));
  favMarkers = list
    .filter(t => t.lat && t.lng)
    .map(t => {
      const m = L.marker([Number(t.lat), Number(t.lng)]).addTo(map);
      m.bindPopup(popupHTML(t, true));
      return m;
    });
}

function goToTask(id) {
  const list = taskCache[mode] || [];
  const t    = list.find(x => x.id === id);
  if (t?.lat && t?.lng) {
    map.setView([Number(t.lat), Number(t.lng)], 18);
    closeTaskPanel();
    const marker = favMarkers.find((m, i) => list[i]?.id === id);
    if (marker) setTimeout(() => marker.openPopup(), 300);
  }
}

function toggleTaskPanel() {
  const panel   = document.getElementById("taskPanel");
  const overlay = document.getElementById("taskOverlay");
  const isOpen  = panel.classList.contains("open");
  if (isOpen) {
    closeTaskPanel();
  } else {
    panel.classList.add("open");
    overlay.style.display = "block";
  }
}

function closeTaskPanel() {
  document.getElementById("taskPanel").classList.remove("open");
  document.getElementById("taskOverlay").style.display = "none";
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
      <button onclick="openEdit('${id}','${addrEsc}',${lat},${lng},${watt ?? "null"},${col ?? "null"})">編輯</button>
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

// ＋ 按鈕：把輸入框的文字加入任務清單（地址自動定位）
async function addFromInput() {
  const input = document.getElementById("lampInput");
  const text  = input.value.trim();
  if (!text) return alert("請輸入路燈編號或地址");

  const btn = document.getElementById("addLocationBtn");
  btn.textContent = "…";
  btn.disabled = true;

  try {
    // 先嘗試當路燈編號加入
    const r1     = await fetch(`${API}/tasks/${mode}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ids: [text] })
    });
    const res1 = await r1.json();

    if (res1.added > 0) {
      // 成功加入路燈
      input.value = "";
      await loadAndRenderTasks(mode);
      toggleTaskPanel();
      return;
    }

    // 找不到路燈編號 → 地址定位預覽
    btn.textContent = "…";
    const r2   = await fetch(`${API}/geocode?q=${encodeURIComponent(text)}`);
    const geo  = await r2.json();

    if (!r2.ok) { alert(`❌ ${geo.error}`); return; }

    // 在地圖上顯示預覽 marker
    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = L.marker([Number(geo.lat), Number(geo.lng)]).addTo(map);
    map.setView([Number(geo.lat), Number(geo.lng)], 17);

    const pendingText = text;
    const pendingGeo  = geo;
    currentMarker.bindPopup(`
      <div style="text-align:center;min-width:140px">
        <div style="font-weight:600;margin-bottom:8px">${pendingText}</div>
        <button onclick="confirmAddCustom('${pendingText.replace(/'/g,"\\'")}',${pendingGeo.lat},${pendingGeo.lng})"
          style="padding:6px 14px;background:#2F4F7F;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-right:6px">加入清單</button>
        <button onclick="cancelPreview()"
          style="padding:6px 14px;background:#eee;border:none;border-radius:6px;cursor:pointer">取消</button>
      </div>
    `).openPopup();

    input.value = "";
  } catch (e) {
    alert(`❌ ${e.message}`);
  } finally {
    btn.textContent = "＋";
    btn.disabled = false;
  }
}

document.getElementById("lampInput").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (["luzhu", "yangmei"].includes(mode)) {
    addFromInput();
  } else {
    searchLamp();
  }
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

function cancelPreview() {
  if (currentMarker) { map.removeLayer(currentMarker); currentMarker = null; }
}

async function confirmAddCustom(label, lat, lng) {
  const res    = await fetch(`${API}/tasks/${mode}/custom`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ label, lat: String(lat), lng: String(lng) })
  });
  const result = await res.json();
  if (currentMarker) { map.removeLayer(currentMarker); currentMarker = null; }
  if (result.ok) {
    await loadAndRenderTasks(mode);
    toggleTaskPanel();
  } else {
    alert(`❌ ${result.error}`);
  }
}

async function clearAllTasks() {
  if (!["luzhu", "yangmei"].includes(mode)) return;
  const count = taskCache[mode]?.length || 0;
  if (!count) return;
  if (!confirm(`確定清空全部 ${count} 筆任務？`)) return;
  await fetch(`${API}/tasks/${mode}`, { method: "DELETE" });
  await loadAndRenderTasks(mode);
}


// ─────────────────────────────────────────
// 定位 + 最近路燈
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// 批次加入清單
// ─────────────────────────────────────────
async function doBatchAdd() {
  if (!["luzhu", "yangmei"].includes(mode)) return;
  const status = document.getElementById("batchStatus");
  const raw    = document.getElementById("batchIds").value.trim();
  if (!raw) { status.textContent = "請輸入路燈編號"; return; }

  const ids = raw.split(/[\n,，、\s]+/).map(s => s.trim()).filter(Boolean);
  status.textContent = `送出 ${ids.length} 筆…`;

  const res    = await fetch(`${API}/tasks/${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  });
  const result = await res.json();

  let msg = `✅ 加入 ${result.added} 筆`;
  if (result.notFound?.length) msg += `，查無：${result.notFound.join("、")}`;
  status.textContent = msg;

  await loadAndRenderTasks(mode);
  if (!result.notFound?.length) {
    setTimeout(() => document.getElementById("batchModal").style.display = "none", 1000);
  }
}

// ─────────────────────────────────────────
// 自訂地點加入清單
// ─────────────────────────────────────────
async function doAddCustom() {
  if (!["luzhu", "yangmei"].includes(mode)) return;
  const status = document.getElementById("customStatus");
  const label  = document.getElementById("customLabel").value.trim();
  const lat    = document.getElementById("customLat").value.trim();
  const lng    = document.getElementById("customLng").value.trim();

  if (!label) { status.textContent = "請輸入名稱或地址"; return; }
  if (!lat || !lng) status.textContent = "定位中…";

  const res    = await fetch(`${API}/tasks/${mode}/custom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, lat, lng })
  });
  const result = await res.json();

  if (result.ok) {
    status.textContent = "✅ 已新增";
    await loadAndRenderTasks(mode);
    setTimeout(() => {
      document.getElementById("customModal").style.display = "none";
      document.getElementById("customLabel").value = "";
      document.getElementById("customLat").value   = "";
      document.getElementById("customLng").value   = "";
      status.textContent = "";
    }, 800);
  } else {
    status.textContent = `❌ ${result.error}`;
  }
}

// ─────────────────────────────────────────
// 單筆編輯
// ─────────────────────────────────────────
let _editId = null;

function openEdit(id, address, lat, lng, watt, col) {
  _editId = id;
  document.getElementById("editId").textContent = `編號：${id}`;
  document.getElementById("editAddress").value = address || "";
  document.getElementById("editLat").value     = lat  ?? "";
  document.getElementById("editLng").value     = lng  ?? "";
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
    lat:     document.getElementById("editLat").value  !== "" ? document.getElementById("editLat").value  : null,
    lng:     document.getElementById("editLng").value  !== "" ? document.getElementById("editLng").value  : null,
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

let locationMarker = null;
let locationCircle = null;
let locationHeading = 0;
let locationLatLng = null;

// 產生方向 SVG 圖示
function makeLocationIcon(heading) {
  const svg = `
    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${heading}, 20, 20)">
        <polygon points="20,4 26,20 20,17 14,20" fill="#4285F4" opacity="0.85"/>
      </g>
      <circle cx="20" cy="20" r="7" fill="#4285F4" stroke="white" stroke-width="2"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
}

function updateLocationMarker() {
  if (!locationLatLng) return;
  if (locationMarker) locationMarker.setIcon(makeLocationIcon(locationHeading));
}

async function locateUser() {
  if (!navigator.geolocation) return alert("此瀏覽器不支援定位功能");

  // iOS 13+ 羅盤權限
  if (typeof DeviceOrientationEvent?.requestPermission === "function") {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== "granted") alert("未取得方向感測器權限，方向功能無法使用");
    } catch {}
  }

  // 監聽方向（iOS 用 webkitCompassHeading，Android 用 alpha absolute）
  window.addEventListener("deviceorientationabsolute", handleOrientation, true);
  window.addEventListener("deviceorientation", handleOrientation, true);

  navigator.geolocation.watchPosition(({ coords }) => {
    const { latitude: lat, longitude: lng, accuracy, heading } = coords;
    locationLatLng = [lat, lng];

    // GPS heading（有時比羅盤準，移動中）
    if (heading != null && !isNaN(heading)) locationHeading = heading;

    if (locationCircle) map.removeLayer(locationCircle);
    locationCircle = L.circle([lat, lng], {
      radius: Math.min(accuracy, 200),
      color: "#4285F4",
      fillColor: "#4285F4",
      fillOpacity: 0.08,
      weight: 1
    }).addTo(map);

    if (!locationMarker) {
      locationMarker = L.marker([lat, lng], { icon: makeLocationIcon(locationHeading), zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup("你在這裡");
      map.setView([lat, lng], 18);
    } else {
      locationMarker.setLatLng([lat, lng]);
      updateLocationMarker();
    }

  }, () => alert("無法取得定位資訊"), { enableHighAccuracy: true, maximumAge: 3000 });
}

function handleOrientation(e) {
  let heading = null;
  if (e.webkitCompassHeading != null) {
    heading = e.webkitCompassHeading; // iOS
  } else if (e.absolute && e.alpha != null) {
    heading = 360 - e.alpha;          // Android absolute
  } else if (e.alpha != null) {
    heading = 360 - e.alpha;          // fallback
  }
  if (heading != null) {
    locationHeading = heading;
    updateLocationMarker();
  }
}
