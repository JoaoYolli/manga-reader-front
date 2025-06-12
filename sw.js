// sw.js

self.addEventListener('install', event => {
  console.log('[SW] Instalado');
  self.skipWaiting(); // Opcional: activa inmediatamente
});

self.addEventListener('activate', event => {
  console.log('[SW] Activado');
  self.clients.claim(); // Toma el control inmediato
});

self.addEventListener('push', event => {
  console.log('[SW] Evento push recibido:', event);
  let data = { title: 'Notificación', body: 'Tienes un mensaje nuevo.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      console.warn('Push con formato no-JSON');
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/img/icon.png',
    badge: data.badge || '/img/badge.png',
    data: data.url || '/'
  };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', event => {
  console.log('[SW] Notificación clicada');
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientsArr => {
      for (let client of clientsArr) {
        if (client.url === event.notification.data && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(event.notification.data);
    })
  );
});
