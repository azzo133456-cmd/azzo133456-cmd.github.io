// ------------------------------------------------------
// ⭐ 自動偵測 UI 與廣告高度 → 自動調整地圖高度
// ------------------------------------------------------
function updateLayout() {
  const ui = document.getElementById("ui");
  const ad = document.getElementById("adArea");

  const uiHeight = ui ? ui.offsetHeight : 90;
  const adHeight = ad ? ad.offsetHeight : 120;

  document.documentElement.style.setProperty("--ui-height", uiHeight + "px");
  document.documentElement.style.setProperty("--ad-height", adHeight + "px");

  // ⭐ 重新調整地圖大小（Leaflet 必須呼叫）
  if (window.map) {
    setTimeout(() => {
      map.invalidateSize();
    }, 200);
  }
}

// 初次執行
updateLayout();

// 視窗大小變化時重新計算
window.addEventListener("resize", updateLayout);


// ------------------------------------------------------
// ⭐ 初始化地圖
// ------------------------------------------------------
const map = L.map("map", {
  zoomControl: false
}).setView([25.033, 121.565], 12);

// 讓 map 在 updateLayout 裡能被呼叫
window.map = map;

// 把縮放控制放到左下角
L.control.zoom({
  position: "bottomleft"
}).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap"
}).addTo(map);

// 🔥 用來記錄目前的 marker（只保留最新一個）
let currentMarker = null;


// ------------------------------------------------------
// ⭐ 顯示某個路燈
// ------------------------------------------------------
function showLamp(id) {
  fetch(`https://lamp-api-bc33.onrender.com/lamp/${id}`)
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
  const res = await fetch(`https://lamp-api-bc33.onrender.com/nearest?lat=${lat}&lng=${lng}`);
  const data = await res.json();
  return data;
}


// ------------------------------------------------------
// ⭐ 初次載入後再強制調整一次地圖大小
// ------------------------------------------------------
setTimeout(() => {
  map.invalidateSize();
}, 500);
