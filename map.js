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
  document.getElementById("taskListBtn").style.display    = isRegion ? "block" : "none";
  document.getElementById("addLocationBtn").style.display = isRegion ? "inline-block" : "none";
  document.getElementById("backBtn").style.display        = mode !== "fullhome" ? "inline-block" : "none";

  favMarkers.forEach(m => map.removeLayer(m));
  favMarkers = [];

  // 清除路線預覽
  closeRoute();

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
    const priCls  = t.priority ? " priority" : "";
    const priBtnCls = t.priority ? " active" : "";
    const idSafe  = t.id.replace(/'/g, "\\'");
    // 顏色點選器：null = 預設藍（選中），其他顏色對比 t.color
    const colorDots = TASK_COLORS.map(c => {
      const isActive = (t.color === c.hex);  // null===null → 預設藍選中
      const arg      = c.hex ? `'${c.hex}'` : "null";
      return `<span class="color-dot${isActive ? " active" : ""}"
        style="background:${c.css}"
        onclick="event.stopPropagation();setTaskColor('${idSafe}',${arg})"></span>`;
    }).join("");
    return `
      <div class="task-card${priCls}" onclick="goToTask('${idSafe}')">
        <span class="task-card-icon">${cardMarkerHtml(t.color, t.priority)}</span>
        <div class="task-card-body">
          <div class="task-card-id">${name}</div>
          ${addr ? `<div class="task-card-addr">${addr}</div>` : ""}
          ${meta ? `<div class="task-card-meta">${meta}</div>` : ""}
          <div class="color-dots">${colorDots}</div>
        </div>
        <button class="task-pri-btn${priBtnCls}" onclick="event.stopPropagation();togglePriority('${idSafe}')" title="優先">🚩</button>
        <button class="task-del-btn" onclick="event.stopPropagation();removeFav('${idSafe}')">×</button>
      </div>`;
  }).join("");

  // 重繪 markers（優先 → 紅色，永久顯示名稱標籤）
  favMarkers.forEach(m => map.removeLayer(m));
  favMarkers = list
    .filter(t => t.lat && t.lng)
    .map(t => {
      // 有設色 → 彩色 PNG filter；無色+置頂 → 紅 PNG filter；無色+普通 → Leaflet 預設藍
      const icon = t.color
        ? getColorIcon(t.color)
        : t.priority ? getPriorityIcon() : new L.Icon.Default();
      const label = t.is_custom ? (t.label || t.address || t.id) : t.id;
      const m = L.marker([Number(t.lat), Number(t.lng)], { icon }).addTo(map);
      m.bindPopup(popupHTML(t, true));
      m.bindTooltip(label, {
        permanent:  true,
        direction:  "bottom",
        offset:     [0, 4],
        className:  t.priority ? "task-label task-label-priority" : "task-label"
      });
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
  const panel  = document.getElementById("taskPanel");
  const isOpen = panel.classList.contains("open");
  if (isOpen) {
    closeTaskPanel();
  } else {
    panel.classList.add("open");
  }
}

function closeTaskPanel() {
  document.getElementById("taskPanel").classList.remove("open");
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
    <span style="display:inline-flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
      ${btn}
      <button onclick="openEdit('${id}','${addrEsc}',${lat},${lng},${watt ?? "null"},${col ?? "null"})">編輯</button>
      <button onclick="routeToPoint(${lat},${lng})" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:13px;">路線</button>
    </span><br>
    <a href="${nav}" target="_blank">導航</a>
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
      .bindPopup(`<b>${text}</b>`);
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
  // 先從本地快取移除，立即更新畫面
  taskCache[mode] = (taskCache[mode] || []).filter(t => t.id !== id);
  renderTaskList(mode);
  // 背景同步伺服器
  fetch(`${API}/tasks/${mode}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─────────────────────────────────────────
// 路線預覽
// ─────────────────────────────────────────
let routeLine       = null;
let routeActive     = false;
let routeNumMarkers = [];

function clearRouteLayers() {
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  routeNumMarkers.forEach(m => map.removeLayer(m));
  routeNumMarkers = [];
}

// Google encoded polyline 解碼
function decodePolyline(encoded) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

function closeRoute() {
  clearRouteLayers();
  routeActive = false;
  document.getElementById("closeRouteBtn").style.display = "none";
}

async function routeToPoint(lat, lng) {
  // 已有路線先清掉
  closeRoute();

  if (!locationLatLng) {
    alert("請先按 📍 取得你的位置");
    return;
  }

  const closeBtn = document.getElementById("closeRouteBtn");
  closeBtn.textContent = "規劃中…";
  closeBtn.style.display = "block";
  closeBtn.disabled = true;

  try {
    const origin      = `${locationLatLng[0]},${locationLatLng[1]}`;
    const destination = `${lat},${lng}`;
    const res  = await fetch(`${API}/directions?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`);
    const data = await res.json();

    if (data.status !== "OK" || !data.routes?.[0]) {
      alert(`路線規劃失敗：${data.status || "未知錯誤"}`);
      closeBtn.style.display = "none";
      return;
    }

    const allPts = data.routes[0].legs.flatMap(leg =>
      leg.steps.flatMap(step => decodePolyline(step.polyline.points))
    );

    routeLine = L.polyline(allPts, { color:"#1a73e8", weight:5, opacity:0.9 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding:[50,50] });

    routeActive = true;
    closeBtn.textContent = "✕ 關閉路線";
    closeBtn.disabled = false;

  } catch(e) {
    alert("路線規劃失敗：" + e.message);
    closeBtn.style.display = "none";
  }
}

function setTaskColor(id, hex) {
  // hex 可以是 null（預設藍）或色碼字串
  if (!["luzhu", "yangmei"].includes(mode)) return;
  const task = taskCache[mode]?.find(t => t.id === id);
  if (!task) return;
  task.color = hex;   // null = 預設藍 L.Icon.Default
  renderTaskList(mode);
  fetch(`${API}/tasks/${mode}/${encodeURIComponent(id)}/color`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color: hex })
  });
}

async function togglePriority(id) {
  if (!["luzhu", "yangmei"].includes(mode)) return;
  const task = taskCache[mode]?.find(t => t.id === id);
  if (!task) return;
  // 樂觀更新
  task.priority = task.priority ? 0 : 1;
  taskCache[mode].sort((a, b) => (b.priority || 0) - (a.priority || 0) || 0);
  renderTaskList(mode);
  // 同步後端
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
  if (!["luzhu", "yangmei"].includes(mode)) return alert("請先進入蘆竹或楊梅模式");
  document.getElementById("customLabel").value   = "";
  document.getElementById("customLat").value     = lat != null ? Number(lat).toFixed(6) : "";
  document.getElementById("customLng").value     = lng != null ? Number(lng).toFixed(6) : "";
  document.getElementById("customTaiCode").value = "";
  document.getElementById("customStatus").textContent = "";
  // 有座標時預設停在經緯度頁
  switchCoordTab(lat != null ? "wgs" : "wgs");
  document.getElementById("customModal").style.display = "flex";
}

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

async function doAddCustom() {
  if (!["luzhu", "yangmei"].includes(mode)) return;
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
