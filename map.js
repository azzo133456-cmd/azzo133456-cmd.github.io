// ------------------------------------------------------
// ⭐ 自動偵測 UI 與廣告高度 → 自動調整地圖高度（手機 + 電腦通用）
// ------------------------------------------------------
function updateLayout() {
  const ui = document.getElementById("ui");
  const ad = document.getElementById("adArea");
  const mapContainer = document.getElementById("mapContainer");

  const uiH = ui ? ui.offsetHeight : 60;
  const adH = ad ? ad.offsetHeight : 90;

  // ⭐ 地圖高度 = 全螢幕 - UI - 廣告
  const vh = window.innerHeight;
  const mapHeight = vh - uiH - adH;

  mapContainer.style.height = mapHeight + "px";

  // ⭐ Leaflet 必須重新計算尺寸
  if (window.map) {
    setTimeout(() => map.invalidateSize(), 150);
  }
}

// 初次執行
updateLayout();

// 視窗大小變化時重新計算
window.addEventListener("resize", updateLayout);

// AdSense 延遲載入 → 每 500ms 修正一次（最多 5 秒）
let fixCount = 0;
const fixInterval = setInterval(() => {
  updateLayout();
  fixCount++;
  if (fixCount > 10) clearInterval(fixInterval);
}, 500);


// ------------------------------------------------------
// ⭐ 初始化地圖
// ------------------------------------------------------
const map = L.map("map", {
  zoomControl: false
}).setView([25.033, 121.565], 12);

// 讓 updateLayout() 能呼叫 map
window.map = map;

// 把縮放控制放到左下角
L.control.zoom({
  position: "bottomleft"
}).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap"
}).addTo(map);

// ⭐ 初次載入後強制修正 Leaflet 尺寸
window.addEventListener("load", () => {
  setTimeout(() => map.invalidateSize(), 200);
});


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

      const lat = Number(data.lng);
      const lng = Number(data.lat);

      if (currentMarker) {
        map.removeLayer(currentMarker);
      }

      currentMarker = L.marker([lat, lng]).addTo(map);

      currentMarker.bindPopup(`
        <b>路燈編號：</b>${data.id}<br>
        <b>地址：</b>${data.address}<br>
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
// ⭐ 自動定位使用者位置 + 找最近路燈
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
