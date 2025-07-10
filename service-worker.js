self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Notifica Giardino';
  const options = {
    body: data.body || '',
    icon: '/logo192.png',
    badge: '/logo192.png',
    data: data.url ? { url: data.url } : {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
}); 