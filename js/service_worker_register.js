// service_worker_register.js

let swRegistrationPromise = null;

// Separado de askPermission(): el registro del SW (y por tanto el precache
// del app shell que dispara su 'install') debe pasar siempre que se cargue
// cualquier página, no solo tras un login exitoso. Antes, un usuario que
// nunca había iniciado sesión con éxito online no tenía ni siquiera un SW
// instalado que pudiera cachear nada para cuando lo necesitara offline.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('SW no soportado');
    return Promise.resolve(null);
  }
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        console.log('SW registrado, scope:', reg.scope);
        return reg;
      })
      .catch(err => {
        console.error('Error registrando el SW:', err);
        swRegistrationPromise = null;
        return null;
      });
  }
  return swRegistrationPromise;
}

registerServiceWorker();

async function askPermission() {
  if (!('PushManager' in window)) return console.warn('Push API no soportado');

  try {
    const reg = await registerServiceWorker();
    if (!reg) return;

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
    // /subscribe ahora exige sesión (antes cualquiera en internet podía
    // mandar un endpoint inventado sin límite) — el token no ata la
    // suscripción a ese usuario en concreto, solo demuestra que quien la
    // manda tiene una cuenta válida.
    await fetch(`${back}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: localStorage.getItem('token'), subscription: sub.toJSON() })
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
