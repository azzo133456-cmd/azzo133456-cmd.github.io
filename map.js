// ─────────────────────────────────────────
// 狀態
// ─────────────────────────────────────────
const API = "https://api.azzo133456.page";

// 目前版本（每次發布新版時連同 index.html 的 ?v= 與 version.json 一起更新）
const APP_VERSION = "58";

// HTML 跳脫：避免地址/編號/名稱含特殊字元時破版或被注入
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Hash ↔ mode 對照表
const ROUTES = { "": "fullhome", "home": "home", "LZ": "luzhu", "YM": "yangmei", "YC": "ymctrl", "TC": "tyctrl" };
const HASHES = { fullhome: "", home: "home", luzhu: "LZ", yangmei: "YM", ymctrl: "YC", tyctrl: "TC" };

// 有任務清單的模式（共用）
const TASK_MODES = ["luzhu", "yangmei", "ymctrl", "tyctrl"];
// 智控器模式（只要藍+綠，不顯示 W/K）
const CTRL_MODES  = ["ymctrl", "tyctrl"];
// 有會勘排程功能的模式
const VISIT_MODES = ["luzhu", "yangmei"];
let mode = "fullhome";
let currentMarker = null;
let customMarkers = [];
let favMarkers = [];
let clusterGroup  = null;   // markercluster 群組
let ctrlClusterCache = {};  // 智控器：已建好的 cluster group 快取（area -> {cg, markers}）

// ─────────────────────────────────────────
// 任務清單（伺服器同步）
// ─────────────────────────────────────────
let taskCache = { luzhu: [], yangmei: [], ymctrl: [], tyctrl: [] }; // 本地快取

// ─────────────────────────────────────────
// 地圖初始化
// ─────────────────────────────────────────
const map = L.map("map", { zoomControl: false, rotate: true, touchRotate: true }).setView([25.033, 121.565], 12);
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
  initPanelDrag();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  checkForUpdate();
  setInterval(checkForUpdate, 5 * 60 * 1000); // 每 5 分鐘檢查一次新版本
});

// 檢查是否有新版本（version.json），有的話顯示更新提示
async function checkForUpdate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (data.version && data.version !== APP_VERSION) {
      document.getElementById("updateBanner").style.display = "block";
    }
  } catch {}
}

// ─────────────────────────────────────────
// 任務面板拖曳（改良版）
// ─────────────────────────────────────────
function initPanelDrag() {
  const handle = document.getElementById("panelHandle");
  const panel  = document.getElementById("taskPanel");
  if (!handle || !panel) return;

  const MAX_H      = () => window.innerHeight * 0.92;
  const CLOSE_THRESH = 60;   // px：低於此高度自動關閉

  let dragging = false;
  let startY = 0, startH = 0;

  handle.addEventListener("touchstart", e => {
    dragging = true;
    startY = e.touches[0].clientY;
    startH = panel.offsetHeight;
    panel.classList.add("dragging");
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!dragging) return;
    const dy = startY - e.touches[0].clientY;   // 正 = 往上拉
    panel.style.height = Math.max(0, Math.min(MAX_H(), startH + dy)) + "px";
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("dragging");

    if (panel.offsetHeight < CLOSE_THRESH) {
      panel.style.height = "";
      panel.classList.remove("open");
    }
    // 其他：停在當前高度（不做任何 snap）
  }, { passive: true });
}

// BFCache（上一頁回來）：頁面狀態已完整保留，只在 hash 與當前模式不符時才重建
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;   // 非 BFCache 還原由 load 事件負責，不重複建立
  const hash = location.hash.replace(/^#\/?/, "");
  if ((ROUTES[hash] ?? "fullhome") !== mode) handleRoute();
});

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

  const isRegion = TASK_MODES.includes(mode);

  document.getElementById("fullHome").style.display       = mode === "fullhome" ? "flex" : "none";
  document.getElementById("taskListBtn").style.display    = isRegion ? "block" : "none";
  document.getElementById("addLocationBtn").style.display = isRegion ? "inline-block" : "none";
  document.getElementById("backBtn").style.display        = mode !== "fullhome" ? "inline-block" : "none";
  document.getElementById("visitPanelBtn").style.display  = VISIT_MODES.includes(mode) ? "" : "none";

  checkVisitBanner(mode);

  if (clusterGroup) { map.removeLayer(clusterGroup); clusterGroup = null; }
  favMarkers.forEach(m => map.removeLayer(m));
  favMarkers = [];
  updateCtrlLabelVisibility();
  setRotationEnabled(!CTRL_MODES.includes(mode));   // 智控器關閉旋轉（少一個重繪來源、避免誤觸）

  closeTaskPanel();

  if (mode === "fullhome") return;
  if (mode === "home")    { map.setView([25.033, 121.565], 12); return; }
  if (mode === "luzhu")   { map.setView([25.012, 121.288], 13); }
  if (mode === "yangmei") { map.setView([24.916, 121.135], 13); }
  if (mode === "ymctrl")  { map.setView([24.916, 121.135], 13); }
  if (mode === "tyctrl")  { map.setView([24.993, 121.301], 13); }

  loadAndRenderTasks(mode);
}

// ─────────────────────────────────────────
// 任務清單：載入、渲染、面板開關
// ─────────────────────────────────────────
// localStorage 快照（只當「上次看到的畫面」，伺服器永遠是真相來源）
function lsGetTasks(area) {
  try { const s = localStorage.getItem(`tasklist_${area}`); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
function lsSetTasks(area, list) {
  try { localStorage.setItem(`tasklist_${area}`, JSON.stringify(list)); } catch {}
}

// stale-while-revalidate：先用本地快照即時顯示，再背景抓最新、有變才重繪
async function loadAndRenderTasks(area) {
  const cached = lsGetTasks(area);
  let shownSig = null;
  if (cached) {
    taskCache[area] = cached;
    renderTaskList(area);
    shownSig = JSON.stringify(cached);
  }

  try {
    const res  = await fetch(`${API}/tasks/${area}`);
    const list = await res.json();
    const sig  = JSON.stringify(list);
    lsSetTasks(area, list);            // 更新快照（以伺服器為準）
    if (sig !== shownSig) {            // 與目前畫面不同才重繪
      taskCache[area] = list;
      if (mode === area) renderTaskList(area);   // 期間若已切走就不重繪
    }
  } catch {
    if (!cached) document.getElementById("taskCards").innerHTML = `<p class="task-empty">載入失敗</p>`;
    // 有快照時：保留舊畫面，不顯示失敗（離線可用）
  }
}

// ─────────────────────────────────────────
// 虛擬捲動（智控器專用）
// ─────────────────────────────────────────
const VS_ITEM_H = 72;   // 每張卡片估算高度（px）
const VS_BUFFER = 4;    // 視窗外多渲染幾張

function vsRender(area) {
  const el   = document.getElementById("taskCards");
  const list = taskCache[area] || [];
  if (!list.length) {
    el.innerHTML = `<p class="task-empty">清單是空的<br>點「自訂＋」或長按地圖加入地點</p>`;
    return;
  }

  const isCtrl = CTRL_MODES.includes(area);
  const colors = isCtrl
    ? TASK_COLORS.filter(c => c.hex === null || c.hex === "#38a169")
    : TASK_COLORS;

  const scrollTop = el.scrollTop;
  const viewH     = el.clientHeight || 400;
  const startIdx  = Math.max(0, Math.floor(scrollTop / VS_ITEM_H) - VS_BUFFER);
  const endIdx    = Math.min(list.length, Math.ceil((scrollTop + viewH) / VS_ITEM_H) + VS_BUFFER);

  if (el._vsStart === startIdx && el._vsEnd === endIdx) return; // 無變化不重繪
  el._vsStart = startIdx;
  el._vsEnd   = endIdx;

  const topPad = startIdx * VS_ITEM_H;
  const botPad = Math.max(0, (list.length - endIdx) * VS_ITEM_H);

  el.innerHTML =
    `<div style="height:${topPad}px"></div>` +
    list.slice(startIdx, endIdx).map(t => buildCardHtml(t, area, colors)).join("") +
    `<div style="height:${botPad}px"></div>`;
}

function buildCardHtml(t, area, colors) {
  const name      = t.is_custom ? (t.address || t.id) : t.id;
  const addr      = (!t.is_custom && t.address) ? t.address : "";
  const isCtrl    = CTRL_MODES.includes(area);
  const meta      = isCtrl ? "" :
    [t.watt ? t.watt + "W" : "", t.col ? t.col + "K" : ""].filter(Boolean).join("　");
  const priCls    = t.priority ? " priority" : "";
  const priBtnCls = t.priority ? " active" : "";
  const idSafe    = t.id.replace(/'/g, "\\'");
  const colorGrid = colors.map(c => {
    const isActive = (t.color === c.hex);
    const arg      = c.hex ? `'${c.hex}'` : "null";
    return `<span class="color-dot${isActive ? " active" : ""}" style="background:${c.css}"
      onclick="event.stopPropagation();setTaskColor('${idSafe}',${arg})"></span>`;
  }).join("");
  return `
    <div class="task-card${priCls}" onclick="goToTask('${idSafe}')">
      <span class="task-card-icon">${cardMarkerHtml(t.color, t.priority)}</span>
      <div class="task-card-body">
        <div class="task-card-id">${escapeHtml(name)}</div>
        ${addr ? `<div class="task-card-addr">${escapeHtml(addr)}</div>` : ""}
        ${meta ? `<div class="task-card-meta">${meta}</div>` : ""}
      </div>
      <div class="card-right">
        <div class="color-grid">${colorGrid}</div>
        <button class="task-pri-btn${priBtnCls}" onclick="event.stopPropagation();togglePriority('${idSafe}')" title="優先">🚩</button>
        <button class="task-del-btn" onclick="event.stopPropagation();removeFav('${idSafe}')">×</button>
      </div>
    </div>`;
}

function buildMarker(t) {
  const icon  = t.color ? getColorIcon(t.color) : t.priority ? getPriorityIcon() : new L.Icon.Default();
  const label = t.is_custom ? (t.label || t.address || t.id) : t.id;
  const m = L.marker([Number(t.lat), Number(t.lng)], { icon });
  m.bindPopup(popupHTML(t, true));
  m.bindTooltip(escapeHtml(label), {
    permanent: true, direction: "bottom", offset: [0, 4],
    className: t.priority ? "task-label task-label-priority" : "task-label"
  });
  return m;
}

// 智控器 marker 分批建立，用 MarkerClusterGroup 聚合（低縮放只渲染幾十個圓，不是 1000+）
async function addCtrlMarkersChunked(area, list) {
  const renderer = L.canvas({ padding: 0.5 });
  const pts = list.filter(t => t.lat && t.lng);
  const CHUNK = 200;

  const cg = L.markerClusterGroup({
    chunkedLoading:          true,
    disableClusteringAtZoom: 15,   // zoom >= 15 就散開成個別路燈點（只在很遠時聚合）
    maxClusterRadius:        50,
    spiderfyOnMaxZoom:       false,
    showCoverageOnHover:     false,
  });

  const tempMarkers = [];

  for (let i = 0; i < pts.length; i += CHUNK) {
    if (mode !== area) return;
    const batch = pts.slice(i, i + CHUNK).map(t => {
      const fillColor = t.color || (t.priority ? "#e53e3e" : "#2A81CB");
      const label = t.is_custom ? (t.label || t.address || t.id) : t.id;
      const m = L.circleMarker([Number(t.lat), Number(t.lng)], {
        renderer, radius: 7, fillColor, color: "#fff", weight: 2, fillOpacity: 1
      });
      m._taskId = t.id;
      m.bindPopup(() => popupHTML(t, true));   // 延遲產生：點擊時才組 HTML，不在載入時建 1000+ 字串
      m.bindTooltip(escapeHtml(label), { permanent: true, direction: "bottom", offset: [0, 4], className: "task-label" });
      tempMarkers.push(m);
      return m;
    });
    cg.addLayers(batch);
    await new Promise(r => setTimeout(r, 0));
  }

  if (mode !== area) return;
  clusterGroup = cg;
  map.addLayer(cg);
  favMarkers = tempMarkers;
  ctrlClusterCache[area] = { cg, markers: tempMarkers };
  updateCtrlLabelVisibility();
}

function renderTaskList(area) {
  const list    = taskCache[area] || [];
  const countEl = document.getElementById("taskCount");
  const cards   = document.getElementById("taskCards");
  const isCtrl  = CTRL_MODES.includes(area);

  countEl.textContent = list.length;

  if (!list.length) {
    cards.innerHTML = `<p class="task-empty">清單是空的<br>點「自訂＋」或長按地圖加入地點</p>`;
    if (clusterGroup) { map.removeLayer(clusterGroup); clusterGroup = null; }
    favMarkers.forEach(m => map.removeLayer(m));
    favMarkers = [];
    delete ctrlClusterCache[area];
    return;
  }

  if (isCtrl) {
    // ── 智控器：虛擬捲動（只渲染可見卡片） ──
    cards._vsArea  = area;
    cards._vsStart = -1;
    cards._vsEnd   = -1;
    cards.scrollTop = 0;

    // 綁定捲動監聽（同一個 element 只綁一次）
    if (!cards._vsListener) {
      cards._vsListener = () => {
        if (CTRL_MODES.includes(mode)) vsRender(cards._vsArea);
      };
      cards.addEventListener("scroll", cards._vsListener, { passive: true });
    }
    vsRender(area);

    // ── 地圖：優先重用已建好的 cluster group（離開回來不必重建 1000+ marker）──
    if (clusterGroup) { map.removeLayer(clusterGroup); clusterGroup = null; }
    const cached = ctrlClusterCache[area];
    const sig    = list.filter(t => t.lat && t.lng).map(t => t.id).join("|");
    if (cached && cached.markers.map(m => m._taskId).join("|") === sig) {
      clusterGroup = cached.cg;
      favMarkers   = cached.markers;
      map.addLayer(clusterGroup);
      updateCtrlLabelVisibility();
    } else {
      favMarkers = [];
      addCtrlMarkersChunked(area, list);  // 非同步分批建立並寫入快取
    }

  } else {
    // ── 蘆竹/楊梅：原本全量渲染（筆數少，不需虛擬捲動）──
    const colors = TASK_COLORS;
    cards.innerHTML = list.map(t => buildCardHtml(t, area, colors)).join("");

    if (clusterGroup) { map.removeLayer(clusterGroup); clusterGroup = null; }
    favMarkers.forEach(m => map.removeLayer(m));
    favMarkers = list.filter(t => t.lat && t.lng).map(t => {
      const m = buildMarker(t);
      m.addTo(map);
      return m;
    });
  }
}

function goToTask(id) {
  const list = taskCache[mode] || [];
  const t    = list.find(x => x.id === id);
  if (t?.lat && t?.lng) {
    closeTaskPanel();

    let marker;
    if (CTRL_MODES.includes(mode)) {
      marker = favMarkers.find(m => m._taskId === id);
    } else {
      marker = favMarkers.find(m => {
        const ll = m.getLatLng();
        return Math.abs(ll.lat - Number(t.lat)) < 0.00001 &&
               Math.abs(ll.lng - Number(t.lng)) < 0.00001;
      });
    }
    map.setView([Number(t.lat), Number(t.lng)], 18);
    if (marker) setTimeout(() => marker.openPopup(), 300);
  }
}

function toggleTaskPanel() {
  const panel  = document.getElementById("taskPanel");
  const isOpen = panel.classList.contains("open");
  if (isOpen) {
    closeTaskPanel();
  } else {
    panel.classList.add("open");
  }
}

function closeTaskPanel() {
  const panel = document.getElementById("taskPanel");
  panel.style.height = "";          // 清掉拖曳設的 inline height
  panel.classList.remove("open");
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
    <b>路燈編號：</b>${escapeHtml(id)}<br>
    ${address ? `<b>地址：</b>${escapeHtml(address)}<br>` : ""}
    <b>經緯度：</b>${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}<br>
    <span style="display:inline-flex;gap:16px;">
      <span><b>瓦數：</b>${watt != null ? watt + " W" : "—"}</span>
      <span><b>色溫：</b>${col  != null ? col  + " K" : "—"}</span>
    </span><br>
    <span style="display:inline-flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
      <a href="${nav}" target="_blank" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:13px;text-decoration:none;display:inline-flex;align-items:center;">導航</a>
      <button onclick="openEdit('${id}','${addrEsc}',${lat},${lng},${watt ?? "null"},${col ?? "null"})">編輯</button>
      ${btn}
    </span>
  `;
}

// ─────────────────────────────────────────
// 搜尋
// ─────────────────────────────────────────
async function searchLamp() {
  const input = document.getElementById("lampInput");
  const text  = input.value.trim();
  if (!text) return;

  // 先嘗試路燈編號
  try {
    const res = await fetch(`${API}/lamp/${encodeURIComponent(text)}`);
    if (res.ok) {
      const data = await res.json();
      if (!data.error) {
        input.value = "";
        const lat = Number(data.lat), lng = Number(data.lng);
        if (currentMarker) map.removeLayer(currentMarker);
        currentMarker = L.marker([lat, lng]).addTo(map);
        currentMarker.bindPopup(popupHTML(data));
        map.setView([lat, lng], 18);
        setTimeout(() => currentMarker.openPopup(), 300);
        return;
      }
    }
  } catch {}

  // 找不到路燈 → 嘗試地址定位
  try {
    const r2 = await fetch(`${API}/geocode?q=${encodeURIComponent(text)}`);
    if (!r2.ok) { alert("查無此路燈編號，地址定位也失敗"); return; }
    const geo = await r2.json();
    input.value = "";
    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = L.marker([Number(geo.lat), Number(geo.lng)]).addTo(map)
      .bindPopup(`<b>${escapeHtml(text)}</b>`);
    map.setView([Number(geo.lat), Number(geo.lng)], 17);
    setTimeout(() => currentMarker.openPopup(), 300);
  } catch {
    alert("查無此路燈編號");
  }
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
    let geo;
    try {
      const r2 = await fetch(`${API}/geocode?q=${encodeURIComponent(text)}`);
      if (!r2.ok) { alert("地址定位失敗，請確認地址是否正確"); return; }
      geo = await r2.json();
    } catch {
      alert("地址定位失敗，請稍後再試");
      return;
    }

    if (!geo?.lat) { alert("找不到此地址"); return; }

    // 在地圖上顯示預覽 marker
    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = L.marker([Number(geo.lat), Number(geo.lng)]).addTo(map);
    map.setView([Number(geo.lat), Number(geo.lng)], 17);

    const pendingText = text;
    const pendingGeo  = geo;
    currentMarker.bindPopup(`
      <div style="text-align:center;min-width:140px">
        <div style="font-weight:600;margin-bottom:8px">${escapeHtml(pendingText)}</div>
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
  if (e.key === "Enter") searchLamp();
});

// ─────────────────────────────────────────
// 顯示路燈
// ─────────────────────────────────────────
async function showLamp(id) {
  try {
    const res = await fetch(`${API}/lamp/${encodeURIComponent(id)}`);
    if (!res.ok) { alert("查無此路燈編號"); return; }
    const data = await res.json();
    if (data.error) { alert("查無此路燈編號"); return; }

    const lat = Number(data.lat);
    const lng = Number(data.lng);

    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = L.marker([lat, lng]).addTo(map);
    currentMarker.bindPopup(popupHTML(data));
    map.setView([lat, lng], 18);
    setTimeout(() => currentMarker.openPopup(), 300);
  } catch {
    alert("查詢失敗，請稍後再試");
  }
}

// ─────────────────────────────────────────
// 清單管理
// ─────────────────────────────────────────
async function addFav(id) {
  if (!TASK_MODES.includes(mode)) return alert("請先選擇蘆竹或楊梅模式");
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
  if (!TASK_MODES.includes(mode)) return;
  taskCache[mode] = (taskCache[mode] || []).filter(t => t.id !== id);

  if (CTRL_MODES.includes(mode)) {
    // 只移除單一 marker，不全量重繪
    const marker = favMarkers.find(m => m._taskId === id);
    if (marker && clusterGroup) clusterGroup.removeLayer(marker);
    favMarkers = favMarkers.filter(m => m._taskId !== id);
    if (ctrlClusterCache[mode]) ctrlClusterCache[mode].markers = favMarkers;
    document.getElementById("taskCount").textContent = taskCache[mode].length;
    vsRender(mode);
  } else {
    renderTaskList(mode);
  }

  lsSetTasks(mode, taskCache[mode]);
  fetch(`${API}/tasks/${mode}/${encodeURIComponent(id)}`, { method: "DELETE" });
}


function setTaskColor(id, hex) {
  if (!TASK_MODES.includes(mode)) return;
  const task = taskCache[mode]?.find(t => t.id === id);
  if (!task) return;
  task.color = hex;

  if (CTRL_MODES.includes(mode)) {
    const marker = favMarkers.find(m => m._taskId === id);
    if (marker) marker.setStyle({ fillColor: hex || (task.priority ? "#e53e3e" : "#2A81CB") });
    vsRender(mode);
  } else {
    renderTaskList(mode);
  }

  lsSetTasks(mode, taskCache[mode]);
  fetch(`${API}/tasks/${mode}/${encodeURIComponent(id)}/color`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color: hex })
  });
}

async function togglePriority(id) {
  if (!TASK_MODES.includes(mode)) return;
  const task = taskCache[mode]?.find(t => t.id === id);
  if (!task) return;
  task.priority = task.priority ? 0 : 1;
  taskCache[mode].sort((a, b) => (b.priority || 0) - (a.priority || 0) || 0);

  if (CTRL_MODES.includes(mode)) {
    const marker = favMarkers.find(m => m._taskId === id);
    if (marker) marker.setStyle({ fillColor: task.color || (task.priority ? "#e53e3e" : "#2A81CB") });
    vsRender(mode);
  } else {
    renderTaskList(mode);
  }

  lsSetTasks(mode, taskCache[mode]);
  fetch(`${API}/tasks/${mode}/${encodeURIComponent(id)}/priority`, { method: "PATCH" });
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
  if (!TASK_MODES.includes(mode)) return;
  const count = taskCache[mode]?.length || 0;
  if (!count) return;
  if (!confirm(`確定清空全部 ${count} 筆任務？`)) return;
  await fetch(`${API}/tasks/${mode}`, { method: "DELETE" });
  await loadAndRenderTasks(mode);
}

// ─────────────────────────────────────────
// 會勘排程（site_visits：日期+時間+地點+備註，與路燈無關）
// ─────────────────────────────────────────
function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function openVisitModal() {
  if (!VISIT_MODES.includes(mode)) return;
  document.getElementById("visitModal").style.display = "flex";
  document.getElementById("visitStatus").textContent = "";
  initVisitPasteZone();
  updatePushButtonLabel();
  await renderVisitList();
}

// 截圖貼上區：點擊後按 Ctrl+V 直接貼上剪貼簿圖片做 OCR
function initVisitPasteZone() {
  const zone = document.getElementById("visitPasteZone");
  if (zone._bound) return;
  zone._bound = true;
  zone.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        handleVisitOcr(item.getAsFile());
        return;
      }
    }
    // 沒有圖片時，嘗試直接解析貼上的純文字（例：複製自公文的會勘事由/時間/地點）
    const text = e.clipboardData?.getData("text/plain");
    if (text && text.trim()) {
      e.preventDefault();
      applyOcrResult(text);
    }
  });
}

async function renderVisitList() {
  const listEl = document.getElementById("visitList");
  listEl.innerHTML = `<p style="text-align:center;color:#aaa;font-size:13px;padding:8px 0">載入中...</p>`;
  try {
    const res  = await fetch(`${API}/visits/${mode}`);
    const list = await res.json();
    if (!list.length) {
      listEl.innerHTML = `<p style="text-align:center;color:#aaa;font-size:13px;padding:8px 0">尚無排程</p>`;
      return;
    }
    listEl.innerHTML = list.map(v => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#f7f9fd;border-radius:8px;margin-bottom:6px;border:1.5px solid #e8edf6;">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:#2F4F7F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(v.label)}</div>
          <div style="font-size:12px;color:#666;margin-top:2px">${escapeHtml(v.visit_date)}${v.visit_time ? "　" + escapeHtml(v.visit_time) : ""}</div>
          ${v.note ? `<div style="font-size:12px;color:#999;margin-top:2px">${escapeHtml(v.note)}</div>` : ""}
        </div>
        <button class="task-pri-btn active" onclick="locateVisit('${escapeHtml(v.label)}')" title="定位">📍</button>
        <button class="task-del-btn" onclick="deleteVisit(${v.id})">×</button>
      </div>
    `).join("");
  } catch {
    listEl.innerHTML = `<p style="text-align:center;color:#c00;font-size:13px;padding:8px 0">載入失敗</p>`;
  }
}

// 點擊會勘排程的「📍」：將該地點地址送去定位，並把地圖移動到該位置
async function locateVisit(label) {
  try {
    let lat, lng;

    // 地點文字若已內含座標（例如「...（24.996214, 121.322952）」），直接使用
    const coordMatch = label.match(/([\d.]+)\s*,\s*([\d.]+)/);
    if (coordMatch) {
      lat = Number(coordMatch[1]);
      lng = Number(coordMatch[2]);
    } else {
      const res = await fetch(`${API}/geocode?q=${encodeURIComponent(label)}`);
      if (!res.ok) { alert("地址定位失敗，請確認地點是否正確"); return; }
      const geo = await res.json();
      if (!geo?.lat) { alert("找不到此地點"); return; }
      lat = Number(geo.lat);
      lng = Number(geo.lng);
    }

    document.getElementById("visitModal").style.display = "none";
    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = L.marker([lat, lng]).addTo(map)
      .bindPopup(`<b>${escapeHtml(label)}</b>`);
    map.setView([lat, lng], 17);
    setTimeout(() => currentMarker.openPopup(), 300);
  } catch {
    alert("地址定位失敗，請稍後再試");
  }
}

async function addVisit() {
  const label      = document.getElementById("visitLabel").value.trim();
  const visit_date = document.getElementById("visitDate").value;
  const visit_time = document.getElementById("visitTime").value;
  const note       = document.getElementById("visitNote").value.trim();
  const statusEl   = document.getElementById("visitStatus");

  if (!label || !visit_date) {
    statusEl.textContent = "❌ 請輸入地點與日期";
    statusEl.style.color = "#c00";
    return;
  }

  const res = await fetch(`${API}/visits/${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, visit_date, visit_time, note })
  });
  const result = await res.json();
  if (result.ok) {
    document.getElementById("visitLabel").value = "";
    document.getElementById("visitDate").value = "";
    document.getElementById("visitTime").value = "";
    document.getElementById("visitNote").value = "";
    statusEl.textContent = "✅ 已新增";
    statusEl.style.color = "#2F4F7F";
    await renderVisitList();
    checkVisitBanner(mode);
  } else {
    statusEl.textContent = `❌ ${result.error}`;
    statusEl.style.color = "#c00";
  }
}

// 截圖辨識：上傳公文截圖 → Vision OCR → 嘗試自動填入日期/時間/地點
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 中文數字 → 阿拉伯數字（逐位讀法，用於民國年：一一五 → 115）
function cnDigitsToInt(s) {
  const map = { "零": 0, "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  return Number([...s].map(c => map[c]).join(""));
}

// 中文數字 → 阿拉伯數字（一般讀法，用於月/日：六 → 6、十六 → 16、二十三 → 23）
function cnNumToInt(s) {
  const map = { "零": 0, "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
  if (s.length === 1) return map[s];
  if (s === "十") return 10;
  if (s[0] === "十") return 10 + (map[s[1]] || 0);          // 十X
  if (s.length === 2) return map[s[0]] * 10;                 // X十
  if (s.length === 3) return map[s[0]] * 10 + map[s[2]];     // X十X
  return NaN;
}

// 從 OCR 文字嘗試解析日期/時間/地點
function parseOcrText(text) {
  const result = { date: null, time: null, label: null };

  const CN = "[一二三四五六七八九十〇零]";
  const dateRe = new RegExp(`(\\d{2,3}|${CN}{2,3})\\s*年\\s*(\\d{1,2}|${CN}{1,3})\\s*月\\s*(\\d{1,2}|${CN}{1,3})\\s*日`);
  let m = text.match(dateRe);
  if (m) {
    const toNum = (s, isYear) => /^\d+$/.test(s) ? Number(s) : (isYear ? cnDigitsToInt(s) : cnNumToInt(s));
    const y = toNum(m[1], true) + 1911;
    const mo = toNum(m[2], false);
    const d  = toNum(m[3], false);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      result.date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  if (!result.date) {
    // 西元日期：2026/6/15、2026-06-15、2026.6.15
    m = text.match(/(20\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})\s*日?/);
    if (m) result.date = `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  }

  // 時間：14:30、下午2時30分、下午2時、上午9時
  m = text.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    result.time = `${String(m[1]).padStart(2, "0")}:${m[2]}`;
  } else {
    m = text.match(/(上午|下午)\s*(\d{1,2})\s*時\s*(\d{1,2})?\s*分?/);
    if (m) {
      let h = Number(m[2]);
      if (m[1] === "下午" && h < 12) h += 12;
      result.time = `${String(h).padStart(2, "0")}:${String(m[3] || 0).padStart(2, "0")}`;
    }
  }

  // 地點：抓「地點：」「會勘地點：」「地址：」後面的文字（到換行或全形/半形句點為止）
  m = text.match(/(?:會勘)?地點[:：]\s*([^\n]+)/) || text.match(/地址[:：]\s*([^\n]+)/);
  if (m) {
    result.label = m[1].trim();
  } else {
    // 沒有「地點/地址：」標籤時，嘗試直接找路名/路口（例：中興路/中興二街口）
    const road = /[一-鿿]{1,8}(?:路|街|大道)[一二三四五六七八九十百\d]*(?:段|巷|弄)?[一二三四五六七八九十百\d]*/;
    const re = new RegExp(`${road.source}(?:[\\/、與和]\\s*${road.source})?(?:口|交叉口)?`);
    m = text.match(re);
    if (m) result.label = m[0].trim();
  }

  return result;
}

// 移除「主持人/聯絡人/出席者/列席者/副本」等與會勘內容無關的內容
function stripIrrelevantLines(text) {
  const KEY = "(?:主持人|聯絡人|出席人|出席者|列席人|列席者|副本)";
  // 整行以該欄位開頭（含常見編號，如 一、二、(一)、1. 等）→ 整行移除
  const lineRe = new RegExp(`^[\\s　]*[（(]?[一二三四五六七八九十\\d]{0,3}[、.)）]?\\s*${KEY}`);
  let lines = text.split(/\r?\n/).filter(line => !lineRe.test(line.trim()));
  // 同一行中內嵌的欄位（例：「...　主持人：王科長」）→ 移除該段
  const inlineRe = new RegExp(`(?:^|[\\s　、,，])${KEY}[:：][^\\n　]*`, "g");
  lines = lines.map(line => line.replace(inlineRe, "").trim());
  return lines.filter(l => l.length > 0).join("\n");
}

// 將解析結果（日期/時間/地點/全文）填入會勘表單
function applyOcrResult(text) {
  const parsed = parseOcrText(text);
  if (parsed.date)  document.getElementById("visitDate").value  = parsed.date;
  if (parsed.time)  document.getElementById("visitTime").value  = parsed.time;
  if (parsed.label) document.getElementById("visitLabel").value = parsed.label;
  document.getElementById("visitNote").value = stripIrrelevantLines(text);

  const statusEl = document.getElementById("visitOcrStatus");
  statusEl.style.display = "block";
  statusEl.style.color = "#2F4F7F";
  statusEl.textContent = "✅ 已解析貼上的文字，請檢查並修正欄位內容";
}

async function handleVisitOcr(file) {
  if (!file) return;
  const statusEl = document.getElementById("visitOcrStatus");
  statusEl.style.display = "block";
  statusEl.style.color = "#999";
  statusEl.textContent = "辨識中...";

  try {
    const base64 = await fileToBase64(file);
    const res = await fetch(`${API}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64 })
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);

    const text = result.text || "";
    if (!text.trim()) {
      statusEl.style.color = "#c00";
      statusEl.textContent = "❌ 辨識不到文字，請手動輸入";
      return;
    }

    applyOcrResult(text);
    statusEl.style.color = "#2F4F7F";
    statusEl.textContent = "✅ 辨識完成，請檢查並修正欄位內容";
  } catch (e) {
    statusEl.style.color = "#c00";
    statusEl.textContent = `❌ 辨識失敗：${e.message}`;
  } finally {
    document.getElementById("visitOcrFile").value = "";
  }
}

async function deleteVisit(id) {
  if (!confirm("確定刪除此排程？")) return;
  await fetch(`${API}/visits/${mode}/${id}`, { method: "DELETE" });
  await renderVisitList();
  checkVisitBanner(mode);
}

// 將日期+時間轉成中文顯示，例：2026-06-15 + 16:00 → 6月15日（星期一）下午4時
function formatVisitDateTime(date, time) {
  const d = new Date(`${date}T00:00:00`);
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  let s = `${d.getMonth() + 1}月${d.getDate()}日（星期${weekdays[d.getDay()]}）`;
  if (time) {
    const [h, m] = time.split(":").map(Number);
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    s += `${h < 12 ? "上午" : "下午"}${h12}時`;
    if (m) s += `${m}分`;
  }
  return s;
}

// ─────────────────────────────────────────
// 會勘提示橫幅：
//  - 今天的排程：只要還沒過會勘時間就提醒（沒填時間視為整天）
//  - 明天的排程：現在已過下午4點才提醒
// ─────────────────────────────────────────
async function checkVisitBanner(area) {
  const banner = document.getElementById("visitBanner");
  banner.style.display = "none";
  banner.innerHTML = "";
  if (!VISIT_MODES.includes(area)) return;

  try {
    const res  = await fetch(`${API}/visits/${area}`);
    const list = await res.json();

    const now      = new Date();
    const nowTime  = now.toTimeString().slice(0, 5); // HH:MM
    const today    = todayStr(0);
    const tomorrow = todayStr(1);
    const dismissed = JSON.parse(localStorage.getItem("visitBannerDismissed") || "[]");

    const todayVisits = list.filter(v =>
      v.visit_date === today &&
      (!v.visit_time || v.visit_time >= nowTime) &&
      !dismissed.includes(`${v.id}_${v.visit_date}`)
    ).map(v => ({ ...v, _when: "今天" }));

    const tomorrowVisits = now.getHours() >= 16
      ? list.filter(v => v.visit_date === tomorrow && !dismissed.includes(`${v.id}_${v.visit_date}`))
            .map(v => ({ ...v, _when: "明天" }))
      : [];

    const upcoming = [...todayVisits, ...tomorrowVisits];
    if (!upcoming.length) return;

    banner.innerHTML = upcoming.map(v => `
      <div style="display:flex;align-items:flex-start;gap:8px;background:#fff8e1;border:1.5px solid #ffd166;border-radius:10px;padding:10px 12px;margin-bottom:6px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <span style="font-size:18px">📅</span>
        <div style="flex:1;font-size:13px;color:#5a4a00;line-height:1.5">
          <b>${v._when}有會勘：${escapeHtml(v.label)}</b>　${escapeHtml(formatVisitDateTime(v.visit_date, v.visit_time))}
        </div>
        <button onclick="dismissVisitBanner(${v.id}, '${v.visit_date}')" style="border:none;background:transparent;font-size:16px;color:#999;cursor:pointer;line-height:1;padding:0">×</button>
      </div>
    `).join("");
    banner.style.display = "block";
  } catch {}
}

// 關閉提示只針對「該排程＋該日期」生效，換一天會重新提醒
function dismissVisitBanner(id, visitDate) {
  const key = `${id}_${visitDate}`;
  const today = todayStr(0);
  let dismissed = JSON.parse(localStorage.getItem("visitBannerDismissed") || "[]");
  // 順手清掉過期（早於今天）的紀錄，避免無限累積
  dismissed = dismissed.filter(k => {
    const d = k.split("_").slice(1).join("_");
    return d >= today;
  });
  if (!dismissed.includes(key)) dismissed.push(key);
  localStorage.setItem("visitBannerDismissed", JSON.stringify(dismissed));
  checkVisitBanner(mode);
}

// ─────────────────────────────────────────
// Web Push 推播訂閱
// ─────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function updatePushButtonLabel() {
  const btn = document.getElementById("pushSubBtn");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    btn.textContent = "🔔 此裝置不支援推播";
    btn.disabled = true;
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    btn.textContent = sub ? "🔕 關閉會勘推播提醒" : "🔔 開啟會勘推播提醒";
  } catch {
    btn.textContent = "🔔 開啟會勘推播提醒";
  }
}

async function togglePushSubscription() {
  const statusEl = document.getElementById("visitStatus");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    statusEl.textContent = "❌ 此裝置/瀏覽器不支援推播通知";
    statusEl.style.color = "#c00";
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();

    if (existing) {
      await fetch(`${API}/push/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: existing.endpoint })
      });
      await existing.unsubscribe();
      statusEl.textContent = "✅ 已關閉推播提醒";
      statusEl.style.color = "#2F4F7F";
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        statusEl.textContent = "❌ 未授權通知權限";
        statusEl.style.color = "#c00";
        return;
      }
      const { key } = await (await fetch(`${API}/push/vapid-public-key`)).json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      });
      await fetch(`${API}/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: mode, subscription: sub })
      });
      statusEl.textContent = "✅ 已開啟推播提醒（會勘前一天 16:00 後通知）";
      statusEl.style.color = "#2F4F7F";
    }
  } catch (e) {
    statusEl.textContent = `❌ 設定失敗：${e.message}`;
    statusEl.style.color = "#c00";
  }
  updatePushButtonLabel();
}


// ─────────────────────────────────────────
// 定位 + 最近路燈
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// 批次加入清單
// ─────────────────────────────────────────
async function doBatchAdd() {
  if (!TASK_MODES.includes(mode)) return;
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
    document.getElementById("batchIds").value = "";
    document.getElementById("batchStatus").textContent = "";
    setTimeout(() => document.getElementById("batchModal").style.display = "none", 800);
  }
}

// ─────────────────────────────────────────
// TWD97 TM2 (EPSG:3826) → WGS84（前端版本）
// ─────────────────────────────────────────
function twd97ToWgs84(x, y) {
  const a=6378137,f=1/298.257222101,b=a*(1-f),e2=1-(b/a)**2,k0=0.9999,x0=250000,lon0=121*Math.PI/180;
  const xp=x-x0,M=y/k0;
  const mu=M/(a*(1-e2/4-3*e2**2/64-5*e2**3/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const phi1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const sp=Math.sin(phi1),cp=Math.cos(phi1),tp=Math.tan(phi1);
  const N1=a/Math.sqrt(1-e2*sp**2),T1=tp**2,C1=e2*cp**2/(1-e2),R1=a*(1-e2)/(1-e2*sp**2)**1.5,D=xp/(N1*k0);
  const lat=phi1-(N1*tp/R1)*(D**2/2-(5+3*T1+10*C1-4*C1**2-9*e2)*D**4/24+(61+90*T1+298*C1+45*T1**2-252*e2-3*C1**2)*D**6/720);
  const lon=lon0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1**2+8*e2+24*T1**2)*D**5/120)/cp;
  return { lat: lat*180/Math.PI, lng: lon*180/Math.PI };
}

// ─────────────────────────────────────────
// 台電圖號 → WGS84
// 格式：B0940CC25（9碼）或 Q0445DD4116（11碼）
// 先解碼成 TWD67 TM2，再 Molodensky → WGS84
// ─────────────────────────────────────────
const TAI_GRID = {
  'A':[170000,2750000],'B':[250000,2750000],'C':[330000,2750000],
  'D':[170000,2700000],'E':[250000,2700000],'F':[330000,2700000],
  'G':[170000,2650000],'H':[250000,2650000],'J':[90000,2600000],
  'K':[170000,2600000],'L':[250000,2600000],'M':[90000,2550000],
  'N':[170000,2550000],'O':[250000,2550000],'P':[90000,2500000],
  'Q':[170000,2500000],'R':[250000,2500000],'T':[170000,2450000],
  'U':[250000,2450000],'V':[170000,2400000],'W':[250000,2400000],
  'X':[275000,2614000],'Y':[275000,2564000]
};

function taipowerToWgs84(code) {
  code = code.trim().toUpperCase();
  const base = TAI_GRID[code[0]];
  if (!base) throw new Error("無效的台電圖號首字母：" + code[0]);
  if (code.length < 9) throw new Error("台電圖號長度不足（需至少9碼）");

  const t2x = parseInt(code.slice(1,3)) * 800;
  const t2y = parseInt(code.slice(3,5)) * 500;
  const t3x = (code.charCodeAt(5) - 65) * 100;
  const t3y = (code.charCodeAt(6) - 65) * 100;
  const t99x = code.length >= 11 ? (parseInt(code[9]) || 0) : 0;
  const t99y = code.length >= 11 ? (parseInt(code[10]) || 0) : 0;
  const t5x  = parseInt(code[7]) * 10 + t99x;
  const t5y  = parseInt(code[8]) * 10 + t99y;

  const tx = base[0] + t2x + t3x + t5x;
  const ty = base[1] + t2y + t3y + t5y;

  // TWD67 TM2 → TWD67 geodetic（Australian National Spheroid）
  const a=6378160.0, f=1/298.25, b=a*(1-f), e2=1-(b/a)**2;
  const k0=0.9999, x0=250000, lon0=121*Math.PI/180;
  const xp=tx-x0, M=ty/k0;
  const mu=M/(a*(1-e2/4-3*e2**2/64-5*e2**3/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const phi1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const sp=Math.sin(phi1),cp=Math.cos(phi1),tp=Math.tan(phi1);
  const N1=a/Math.sqrt(1-e2*sp**2),T1=tp**2,C1=e2*cp**2/(1-e2),R1=a*(1-e2)/(1-e2*sp**2)**1.5,D=xp/(N1*k0);
  const lat67=phi1-(N1*tp/R1)*(D**2/2-(5+3*T1+10*C1-4*C1**2-9*e2)*D**4/24+(61+90*T1+298*C1+45*T1**2-252*e2-3*C1**2)*D**6/720);
  const lon67=lon0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1**2+8*e2+24*T1**2)*D**5/120)/cp;

  // Molodensky：TWD67 → WGS84（towgs84=-752,-358,-179）
  const dX=-752, dY=-358, dZ=-179;
  const a2=6378137.0, f2=1/298.257223563, da=a2-a, df=f2-f;
  const sLa=Math.sin(lat67),cLa=Math.cos(lat67),sLo=Math.sin(lon67),cLo=Math.cos(lon67);
  const Nm=a/Math.sqrt(1-e2*sLa**2), Mm=a*(1-e2)/Math.pow(1-e2*sLa**2,1.5);
  const dLat=(-dX*sLa*cLo - dY*sLa*sLo + dZ*cLa + (a*df+f*da)*Math.sin(2*lat67))/Mm;
  const dLon=(-dX*sLo + dY*cLo)/(Nm*cLa);

  return { lat:(lat67+dLat)*180/Math.PI, lng:(lon67+dLon)*180/Math.PI };
}

// ─────────────────────────────────────────
// 自訂地點 Modal
// ─────────────────────────────────────────
let _coordTab = "wgs";

function switchCoordTab(tab) {
  _coordTab = tab;
  document.getElementById("coordWGS").style.display  = tab === "wgs" ? "block" : "none";
  document.getElementById("coordTAI").style.display  = tab === "tai" ? "block" : "none";
  document.getElementById("coordTabWGS").style.background = tab === "wgs" ? "#2F4F7F" : "#f0f0f0";
  document.getElementById("coordTabWGS").style.color      = tab === "wgs" ? "#fff"    : "#555";
  document.getElementById("coordTabTAI").style.background = tab === "tai" ? "#2F4F7F" : "#f0f0f0";
  document.getElementById("coordTabTAI").style.color      = tab === "tai" ? "#fff"    : "#555";
}

function openCustomModal(lat, lng) {
  if (!TASK_MODES.includes(mode)) return alert("請先進入蘆竹或楊梅模式");
  document.getElementById("customLabel").value   = "";
  document.getElementById("customLat").value     = lat != null ? Number(lat).toFixed(6) : "";
  document.getElementById("customLng").value     = lng != null ? Number(lng).toFixed(6) : "";
  document.getElementById("customTaiCode").value = "";
  document.getElementById("customStatus").textContent = "";
  // 有座標時預設停在經緯度頁
  switchCoordTab(lat != null ? "wgs" : "wgs");
  document.getElementById("customModal").style.display = "flex";
}

// ─────────────────────────────────────────
// 智控器標籤可見性（縮放 >= 16 才顯示，避免 1000+ DOM 標籤拖慢縮放）
// ─────────────────────────────────────────
const CTRL_LABEL_MIN_ZOOM = 16;   // zoom 15 先顯示乾淨彩色點，16+ 再帶出編號標籤

// 啟用／關閉地圖旋轉（leaflet-rotate 的觸控與 shift 拖曳旋轉）
function setRotationEnabled(on) {
  const handlers = [map.touchRotate, map.shiftKeyRotate];
  for (const h of handlers) {
    if (!h) continue;
    on ? h.enable() : h.disable();
  }
  if (!on) {
    map.setBearing(0);   // 關閉時順手回正
    const btn = document.getElementById("northBtn");
    if (btn) btn.style.transform = "rotate(0deg)";
  }
  // 智控器隱藏指南針按鈕（不能轉就不需要）
  const northBtn = document.getElementById("northBtn");
  if (northBtn) northBtn.style.display = on ? "" : "none";
}

function updateCtrlLabelVisibility() {
  const mapEl = document.getElementById("map");
  if (!CTRL_MODES.includes(mode)) {
    mapEl.classList.remove("ctrl-labels-hidden");
    return;
  }
  mapEl.classList.toggle("ctrl-labels-hidden", map.getZoom() < CTRL_LABEL_MIN_ZOOM);
}

map.on("zoomend", updateCtrlLabelVisibility);

// 指南針圖示跟著地圖旋轉
map.on("rotate", () => {
  const bearing = map.getBearing();
  const btn = document.getElementById("northBtn");
  if (btn) btn.style.transform = `rotate(${-bearing}deg)`;
});

// 地圖長按（contextmenu 在手機上是長按）→ 自動帶入座標
map.on("contextmenu", (e) => {
  openCustomModal(e.latlng.lat, e.latlng.lng);
});

// 搜尋 marker 的 popup 關閉時自動移除 marker
map.on("popupclose", (e) => {
  if (currentMarker && e.popup === currentMarker.getPopup()) {
    map.removeLayer(currentMarker);
    currentMarker = null;
  }
});

async function doAddCustom() {
  if (!TASK_MODES.includes(mode)) return;
  const status = document.getElementById("customStatus");
  const label  = document.getElementById("customLabel").value.trim();
  if (!label) { status.textContent = "請輸入名稱"; return; }

  let lat = "", lng = "";

  if (_coordTab === "tai") {
    // 台電圖號 → WGS84
    const code = document.getElementById("customTaiCode").value.trim();
    if (!code) { status.textContent = "請輸入台電圖號"; return; }
    try {
      const wgs = taipowerToWgs84(code);
      lat = String(wgs.lat.toFixed(6));
      lng = String(wgs.lng.toFixed(6));
      status.textContent = `轉換完成：${lat}, ${lng}`;
    } catch (e) { status.textContent = "❌ " + e.message; return; }
  } else {
    lat = document.getElementById("customLat").value.trim();
    lng = document.getElementById("customLng").value.trim();
    if (!lat || !lng) status.textContent = "定位中…";
  }

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

let locationMarker  = null;
let locationCircle  = null;
let locationHeading = 0;
let locationLatLng  = null;
let locationWatchId = null;          // 避免重複 watchPosition
let orientationAdded = false;        // 避免重複加 orientation listener
let lastOrientationTime = 0;         // 節流：最多 5 fps

// 任務 marker 色盤（null = 預設藍 L.Icon.Default；紅色保留給置頂）
// css 是色點顯示色；filter 是套在 Leaflet PNG 圖釘上的 CSS 濾鏡
const TASK_COLORS = [
  { hex: null,      css: "#2A81CB", filter: "" },                                                   // 預設藍
  { hex: "#38a169", css: "#38a169", filter: "hue-rotate(-63deg) saturate(0.9) brightness(1.05)" },  // 綠
  { hex: "#805ad5", css: "#805ad5", filter: "hue-rotate(56deg) saturate(1.3) brightness(1.05)" },   // 紫
  { hex: "#dd6b20", css: "#dd6b20", filter: "hue-rotate(179deg) saturate(2.4) brightness(1.1)" },   // 橘
];

const LEAFLET_PIN_URL    = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
const LEAFLET_SHADOW_URL = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";

// 產生彩色版 Leaflet 圖釘（用 CSS filter 染色，保留原本形狀）
function getColorIcon(hex) {
  const entry  = TASK_COLORS.find(c => c.hex === hex);
  const filter = entry ? entry.filter : "";
  const fs     = filter ? `filter:${filter}` : "";
  return L.divIcon({
    html: `<div style="position:relative;width:25px;height:41px;overflow:visible">
      <img src="${LEAFLET_SHADOW_URL}" style="position:absolute;left:-1px;top:0;width:41px;height:41px;pointer-events:none">
      <img src="${LEAFLET_PIN_URL}" style="position:absolute;left:0;top:0;width:25px;height:41px;${fs}">
    </div>`,
    className:    "leaflet-div-icon-color",
    iconSize:     [25, 41],
    iconAnchor:   [12, 41],
    popupAnchor:  [1, -34],
    tooltipAnchor:[16, -28]
  });
}

// 優先任務 — 紅色圖釘（獨立 SVG，不在色盤中）
function getPriorityIcon() {
  return L.divIcon({
    html: `<div style="position:relative;width:25px;height:41px;overflow:visible">
      <img src="${LEAFLET_SHADOW_URL}" style="position:absolute;left:-1px;top:0;width:41px;height:41px;pointer-events:none">
      <img src="${LEAFLET_PIN_URL}" style="position:absolute;left:0;top:0;width:25px;height:41px;filter:hue-rotate(157deg) saturate(3) brightness(1.1)">
    </div>`,
    className:    "leaflet-div-icon-color",
    iconSize:     [25, 41],
    iconAnchor:   [12, 41],
    popupAnchor:  [1, -34],
    tooltipAnchor:[16, -28]
  });
}

// 任務卡片左側迷你圖釘（img + filter，與地圖一致）
function cardMarkerHtml(hex, isPriority) {
  if (isPriority && !hex) {
    // 置頂：紅色
    return `<img src="${LEAFLET_PIN_URL}" style="width:16px;height:26px;filter:hue-rotate(157deg) saturate(3) brightness(1.1)">`;
  }
  const entry  = TASK_COLORS.find(c => c.hex === hex);
  const filter = entry ? entry.filter : "";
  const fs     = filter ? `filter:${filter}` : "";
  return `<img src="${LEAFLET_PIN_URL}" style="width:16px;height:26px;${fs}">`;
}

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

function resetNorth() {
  map.setBearing(0);
  document.getElementById("northBtn").style.transform = "rotate(0deg)";
}

async function locateUser() {
  if (!navigator.geolocation) return alert("此瀏覽器不支援定位功能");

  // iOS 13+ 羅盤權限（只申請一次）
  if (!orientationAdded && typeof DeviceOrientationEvent?.requestPermission === "function") {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== "granted") alert("未取得方向感測器權限，方向功能無法使用");
    } catch {}
  }

  // 只加一次 orientation listener
  if (!orientationAdded) {
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation",         handleOrientation, true);
    orientationAdded = true;
  }

  // 清掉舊的 watchPosition，避免重複
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }

  locationWatchId = navigator.geolocation.watchPosition(({ coords }) => {
    const { latitude: lat, longitude: lng, accuracy, heading } = coords;
    locationLatLng = [lat, lng];

    if (heading != null && !isNaN(heading)) locationHeading = heading;

    // 直接更新 circle，不刪掉重建
    if (locationCircle) {
      locationCircle.setLatLng([lat, lng]);
      locationCircle.setRadius(Math.min(accuracy, 200));
    } else {
      locationCircle = L.circle([lat, lng], {
        radius: Math.min(accuracy, 200),
        color: "#4285F4", fillColor: "#4285F4", fillOpacity: 0.08, weight: 1
      }).addTo(map);
    }

    if (!locationMarker) {
      locationMarker = L.marker([lat, lng], {
        icon: makeLocationIcon(locationHeading), zIndexOffset: 1000
      }).addTo(map).bindPopup("你在這裡");
      map.setView([lat, lng], 18);
    } else {
      locationMarker.setLatLng([lat, lng]);
      updateLocationMarker();
    }

  }, () => alert("無法取得定位資訊"),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

function handleOrientation(e) {
  // 節流：最多每 200ms 更新一次（避免每秒幾十次重繪 SVG）
  const now = Date.now();
  if (now - lastOrientationTime < 200) return;
  lastOrientationTime = now;

  let heading = null;
  if (e.webkitCompassHeading != null) {
    heading = e.webkitCompassHeading;
  } else if (e.absolute && e.alpha != null) {
    heading = 360 - e.alpha;
  } else if (e.alpha != null) {
    heading = 360 - e.alpha;
  }
  if (heading != null) {
    locationHeading = heading;
    updateLocationMarker();
  }
}
