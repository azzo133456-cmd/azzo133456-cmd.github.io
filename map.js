// 初始化地圖
const map = L.map("map", {
  zoomControl: false   // 先關掉預設的右上角縮放按鈕
}).setView([25.033, 121.565], 12);

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

// 顯示某個路燈
function showLamp(id) {
  fetch(`https://lamp-api-bc33.onrender.com/lamp/${id}`)
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        alert("查無此路燈編號");
        return;
      }

      const lat = Number(data.lng); // 緯度
      const lng = Number(data.lat); // 經度

      // 清除舊 marker
      if (currentMarker) {
        map.removeLayer(currentMarker);
      }

      // 新 marker
      currentMarker = L.marker([lat, lng]).addTo(map);

      currentMarker.bindPopup(`
        <b>路燈編號：</b>${data.id}<br>
        <b>地址：</b>${data.address}<br>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank">導航</a>
      `);

      // ⭐⭐⭐ 直接瞬間跳到 marker（不偏移、不動畫）
      map.setView([lat, lng], 18);

      // 開啟 popup
      setTimeout(() => currentMarker.openPopup(), 300);
    });
}

// 搜尋功能
function searchLamp() {
  const input = document.getElementById("lampInput");
  const id = input.value.trim();

  if (!id) {
    alert("請輸入路燈編號");
    return;
  }

  showLamp(id);
  input.value = ""; // 查詢後清空
}

// 🔥 Enter 也能查詢
document.getElementById("lampInput").addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    searchLamp();
  }
});

// ------------------------------------------------------
// 🔥🔥🔥 自動定位使用者位置 + 找最近路燈
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

      // 清除舊 marker
      if (currentMarker) {
        map.removeLayer(currentMarker);
      }

      // 使用者位置 marker（藍色）
      currentMarker = L.marker([userLat, userLng], {
        icon: L.icon({
          iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/blue-dot.png",
          iconSize: [32, 32]
        })
      }).addTo(map);

      currentMarker.bindPopup("你在這裡");

      // ⭐⭐⭐ 直接瞬間跳到定位點（不偏移、不動畫）
      map.setView([userLat, userLng], 18);

      setTimeout(() => currentMarker.openPopup(), 300);

      // ----------------------------------------------------
      // 🔥 找最近路燈（你的後端已經支援）
      // ----------------------------------------------------
      const nearest = await findNearestLamp(userLat, userLng);

      if (nearest) {
        const dist = nearest.distance * 1000; // km → 公尺

        if (dist <= 50) {
          alert(`最近的路燈距離你約 ${Math.round(dist)} 公尺`);
        } else {
          alert(`最近的路燈超過 50 公尺（約 ${Math.round(dist)} 公尺）`);
        }

        // ⭐ 再瞬間跳到最近路燈
        showLamp(nearest.id);
      }
    },
    () => {
      alert("無法取得定位資訊");
    }
  );
}

// 🔥 從 API 找最近的路燈
async function findNearestLamp(lat, lng) {
  const res = await fetch(`https://lamp-api-bc33.onrender.com/nearest?lat=${lat}&lng=${lng}`);
  const data = await res.json();
  return data; // { id: "0400001", distance: ... }
}

setTimeout(() => {
  map.invalidateSize();
}, 500);
