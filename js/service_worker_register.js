// service_worker_register.js

async function askPermission() {
if (!('serviceWorker' in navigator)) return console.warn('SW no soportado');
  if (!('PushManager' in window)) return console.warn('Push API no soportado');

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('SW registrado, scope:', reg.scope);

    // Pide permiso al usuario
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return console.warn('Permiso denegado:', perm);

    // Clave pública VAPID (genera con web-push)
    const response = await fetch(`${back}/vapidPublicKey`);
    const { vapidPublicKey } = await response.json();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });

    console.log('Suscripción creada:', sub);
    await fetch(`${back}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });

    console.log('Suscripción enviada al servidor');
  } catch (err) {
    console.error('Error SW / Push:', err);
  }
} 

// Helper para convertir clave VAPID a Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
