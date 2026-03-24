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
// favData 載入 / 儲存
// ─────────────────────────────────────────
function loadFavData() {
  try {
    const raw = JSON.parse(localStorage.getItem("favData") || "{}");
    return {
      luzhu:   Array.isArray(raw.luzhu)   ? raw.luzhu   : [],
      yangmei: Array.isArray(raw.yangmei) ? raw.yangmei : []
    };
  } catch {
    return { luzhu: [], yangmei: [] };
  }
}

function saveFavData() {
  localStorage.setItem("favData", JSON.stringify(favData));
}

let favData = loadFavData();

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
window.addEventListener("pageshow", (e) => {
  favData = loadFavData();
  handleRoute();
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

  const isRegion = mode === "luzhu" || mode === "yangmei";

  document.getElementById("fullHome").style.display  = mode === "fullhome" ? "flex"         : "none";
  document.getElementById("favList").style.display   = isRegion            ? "inline-block" : "none";
  document.getElementById("delFavBtn").style.display = isRegion            ? "inline-block" : "none";

  // 清掉區域路燈 markers
  customMarkers.forEach(m => map.removeLayer(m));
  customMarkers = [];

  // 清掉舊的收藏 markers（每次都重畫，避免跨區殘留）
  favMarkers.forEach(m => map.removeLayer(m));
  favMarkers = [];

  if (mode === "fullhome") return;

  if (mode === "luzhu") {
    loadCustomMarkers(luzhuList);
    map.setView([25.012, 121.288], 14);
  } else if (mode === "yangmei") {
    loadCustomMarkers(yangmeiList);
    map.setView([24.916, 121.135], 14);
  } else {
    map.setView([25.033, 121.565], 12);
    return;
  }

  renderFav(); // 只有區域模式才渲染收藏清單
}

// ─────────────────────────────────────────
// 渲染收藏清單 + Markers
// ─────────────────────────────────────────
function renderFav() {
  const favList = document.getElementById("favList");
  favList.innerHTML = `<option value="">我的清單</option>`;

  // 重新從 localStorage 確保資料最新
  favData = loadFavData();

  const list = favData[mode] || [];

  list.forEach(({ id, lat, lng }) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    favList.appendChild(opt);
  });

  favMarkers = list.map(({ id, lat, lng }) => {
    const m = L.marker([lat, lng]).addTo(map);
    m.bindPopup(popupHTML({ id, lat, lng }, true));
    return m;
  });
}

// ─────────────────────────────────────────
// Popup HTML 模板
// ─────────────────────────────────────────
function popupHTML({ id, address, lat, lng }, isFav = false) {
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const btn = isFav
    ? `<button onclick="removeFav('${id}')">刪除</button>`
    : `<button onclick="addFav('${id}', ${lat}, ${lng})">加入清單</button>`;
  return `
    <b>路燈編號：</b>${id}<br>
    ${address ? `<b>地址：</b>${address}<br>` : ""}
    <b>經緯度：</b>${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}<br>
    ${btn}<br>
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
function addFav(id, lat, lng) {
  if (!["luzhu", "yangmei"].includes(mode)) return alert("請先選擇蘆竹或楊梅模式");
  if (favData[mode].some(item => item.id === id)) return alert("已在清單中");
  favData[mode].push({ id, lat, lng });
  saveFavData();
  renderFav();
  alert("已加入清單");
}

function removeFav(id) {
  if (!["luzhu", "yangmei"].includes(mode)) return;
  favData[mode] = favData[mode].filter(item => item.id !== id);
  saveFavData();
  renderFav();
}

function deleteFav() {
  const id = document.getElementById("favList").value;
  if (!id) return alert("請先選擇要刪除的路燈");
  removeFav(id);
}

document.getElementById("favList").addEventListener("change", function () {
  const item = favData[mode]?.find(x => x.id === this.value);
  if (item) map.setView([item.lat, item.lng], 18);
});

// ─────────────────────────────────────────
// 定位 + 最近路燈
// ─────────────────────────────────────────
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
