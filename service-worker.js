// 路燈查詢地圖 - Service Worker
// 目前僅用於 PWA 安裝資格 + Web Push 推播接收（不做離線快取，避免地圖資料過期）

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  self.clients.claim();
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: "通知", body: e.data ? e.data.text() : "" }; }

  const title = data.title || "路燈查詢地圖";
  const options = {
    body: data.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: data.tag || "notification",
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window" }).then((clientsArr) => {
      const hadWindow = clientsArr.find((c) => "focus" in c);
      if (hadWindow) return hadWindow.focus();
      return clients.openWindow("./index.html");
    })
  );
});
