// ------------------------------------------------------
// ⭐ 初始化地圖
// ------------------------------------------------------
const map = L.map("map", {
  zoomControl: false
}).setView([25.033, 121.565], 12);

// 讓其他函式能使用 map
window.map = map;

// 把縮放控制放到左下角
L.control.zoom({
  position: "bottomleft"
}).addTo(map);

L.tileLayer(
  "https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}",
  {
    maxZoom: 20,
    attribution: "© 國土測繪中心"
  }
).addTo(map);

// ⭐ 初次載入後強制修正 Leaflet 尺寸（手機/電腦都需要）
window.addEventListener("load", () => {
  setTimeout(() => map.invalidateSize(), 200);
});

// 全域變數
let mode = "home";
let customMarkers = [];
let currentMarker = null;

let favData = {
  luzhu: [],
  yangmei: []
};

let favMarkers = [];

function loadFavFromStorage() {
  const saved = localStorage.getItem("favData");
  if (saved) favData = JSON.parse(saved);
}

function saveFavToStorage() {
  localStorage.setItem("favData", JSON.stringify(favData));
}

const map = L.map("map", { zoomControl: false }).setView([25.033, 121.565], 12);
window.map = map;

L.control.zoom({ position: "bottomleft" }).addTo(map);

L.tileLayer(
  "https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}",
  { maxZoom: 20, attribution: "© 國土測繪中心" }
).addTo(map);

loadFavFromStorage();


// 進入模式（首頁按鈕用）
function enterMode(newMode) {
  document.getElementById("fullHome").style.display = "none";
  switchMode(newMode);
}

// 切換模式
function switchMode(newMode) {
  mode = newMode;

  // 清掉舊 marker
  customMarkers.forEach(m => map.removeLayer(m));
  customMarkers = [];

  // 取得下拉式選單與刪除按鈕
  const favList = document.getElementById("favList");
  const delFavBtn = document.getElementById("delFavBtn");

  // ⭐ 主頁模式：隱藏下拉式選單
  if (mode === "home") {
    favList.style.display = "none";
    delFavBtn.style.display = "none";

    map.setView([25.033, 121.565], 12);
    return;
  }

  // ⭐ 蘆竹 / 楊梅模式：顯示下拉式選單
  favList.style.display = "inline-block";
  delFavBtn.style.display = "inline-block";

  if (mode === "luzhu") {
  loadCustomMarkers(luzhuList);
  map.setView([25.012, 121.288], 14);
  refreshFavList();
  refreshFavMarkers();
}

if (mode === "yangmei") {
  loadCustomMarkers(yangmeiList);
  map.setView([24.916, 121.135], 14);
  refreshFavList();
  refreshFavMarkers();
}
}
// ------------------------------------------------------
// ⭐ 用來記錄目前的 marker（只保留最新一個）
// ------------------------------------------------------
let currentMarker = null;

// ------------------------------------------------------
// ⭐ 顯示某個路燈
// ------------------------------------------------------
function showLamp(id) {
  fetch(`https://api.azzo133456.page/lamp/${id}`)
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        alert("查無此路燈編號");
        return;
      }

      const lat = Number(data.lng); // 緯度
      const lng = Number(data.lat); // 經度

      if (currentMarker) {
        map.removeLayer(currentMarker);
      }

      currentMarker = L.marker([lat, lng]).addTo(map);

      currentMarker.bindPopup(`
  <b>路燈編號：</b>${data.id}<br>
  <b>地址：</b>${data.address}<br>
  <b>經緯度：</b>${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
  <button onclick="addFav('${data.id}', ${lat}, ${lng})">加入清單</button><br>
  <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank">導航</a>
      `);

      map.setView([lat, lng], 18);

      setTimeout(() => currentMarker.openPopup(), 300);
    });
}

// ------------------------------------------------------
// ⭐ 搜尋功能
// ------------------------------------------------------
function searchLamp() {
  const input = document.getElementById("lampInput");
  const id = input.value.trim();

  if (!id) {
    alert("請輸入路燈編號");
    return;
  }

  showLamp(id);
  input.value = "";
}

document.getElementById("lampInput").addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    searchLamp();
  }
});

// ------------------------------------------------------
// ⭐ 路燈加入下拉式選單及刪除
// ------------------------------------------------------

function addFav(id, lat, lng) {
  if (mode !== "luzhu" && mode !== "yangmei") {
    alert("請先選擇蘆竹或楊梅模式");
    return;
  }

  // 檢查是否已存在
  if (favData[mode].some(item => item.id === id)) {
    alert("已在清單中");
    return;
  }

  favData[mode].push({ id, lat, lng });
  saveFavToStorage();
  refreshFavList();
  refreshFavMarkers();

  alert("已加入清單");
}

function deleteFav() {
  const favList = document.getElementById("favList");
  const id = favList.value;

  if (!id) {
    alert("請先選擇要刪除的路燈");
    return;
  }

  favData[mode] = favData[mode].filter(item => item.id !== id);
  saveFavToStorage();
  refreshFavList();
  refreshFavMarkers();
}

document.getElementById("favList").addEventListener("change", function () {
  const id = this.value;
  if (!id) return;

  const item = favData[mode].find(x => x.id === id);
  if (!item) return;

  map.setView([item.lat, item.lng], 18);
});

let favMarkers = [];

function refreshFavMarkers() {
  // 清除舊 marker
  favMarkers.forEach(m => map.removeLayer(m));
  favMarkers = [];

  favData[mode].forEach(item => {
    const marker = L.marker([item.lat, item.lng]).addTo(map);
    marker.bindPopup(`
      <b>路燈編號：</b>${item.id}<br>
      <b>經緯度：</b>${item.lat}, ${item.lng}<br>
      <button onclick="deleteFavById('${item.id}')">刪除</button>
    `);
    favMarkers.push(marker);
  });
}
function deleteFavById(id) {
  favData[mode] = favData[mode].filter(item => item.id !== id);
  saveFavToStorage();
  refreshFavList();
  refreshFavMarkers();
}

function refreshFavList() {
  const favList = document.getElementById("favList");
  favList.innerHTML = `<option value="">我的清單</option>`;

  favData[mode].forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.id} (${item.lat.toFixed(5)}, ${item.lng.toFixed(5)})`;
    favList.appendChild(opt);
  });
}
// ------------------------------------------------------
// ⭐清單儲存
// ------------------------------------------------------  
  let favData = {
  luzhu: [],
  yangmei: []
};
function loadFavFromStorage() {
  const saved = localStorage.getItem("favData");
  if (saved) {
    favData = JSON.parse(saved);
  }
}

function saveFavToStorage() {
  localStorage.setItem("favData", JSON.stringify(favData));
}

// ------------------------------------------------------
// ⭐自動定位使用者位置 + 找最近路燈
// ------------------------------------------------------  
  
function locateUser() {
  if (!navigator.geolocation) {
    alert("此瀏覽器不支援定位功能");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const userLat = pos.coords.latitude;
      const userLng = pos.coords.longitude;

      if (currentMarker) {
        map.removeLayer(currentMarker);
      }

      currentMarker = L.marker([userLat, userLng], {
        icon: L.icon({
          iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/blue-dot.png",
          iconSize: [32, 32]
        })
      }).addTo(map);

      currentMarker.bindPopup("你在這裡");

      map.setView([userLat, userLng], 18);

      setTimeout(() => currentMarker.openPopup(), 300);

      const nearest = await findNearestLamp(userLat, userLng);

      if (nearest) {
        const dist = nearest.distance * 1000;

        if (dist <= 50) {
          alert(`最近的路燈距離你約 ${Math.round(dist)} 公尺`);
        } else {
          alert(`最近的路燈超過 50 公尺（約 ${Math.round(dist)} 公尺）`);
        }

        showLamp(nearest.id);
      }
    },
    () => {
      alert("無法取得定位資訊");
    }
  );
}

// ------------------------------------------------------
// ⭐ 從 API 找最近的路燈
// ------------------------------------------------------
async function findNearestLamp(lat, lng) {
  const res = await fetch(`https://api.azzo133456.page/nearest?lat=${lat}&lng=${lng}`);
  const data = await res.json();
  return data;
}
