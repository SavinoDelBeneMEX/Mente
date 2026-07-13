self.addEventListener('push', function (event) {
  var data = { title: 'Mente', body: 'Tenés un recordatorio' };
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Mente', {
      body: data.body || '',
      icon: 'icon.png',
      badge: 'icon.png',
      tag: 'mente-reminder'
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
