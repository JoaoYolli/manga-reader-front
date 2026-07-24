// auth.js
// Login/registro por usuario+contraseña, cambio de contraseña obligatorio para
// perfiles heredados, sincronización de preferencias (tema/modo de lectura)
// con el backend, y el flujo de login por QR para Smart TV (donde escribir
// con el mando es una mala experiencia, misma filosofía que tv-mode.js).

const back = "https://manga-back.yolli.xyz";

// --- Llamadas a la API ---
async function apiRegister(username, password, inviteCode) {
  const res = await fetch(back + "/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, inviteCode })
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

async function apiLogin(username, password) {
  const res = await fetch(back + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

async function apiChangePassword(token, newPassword) {
  const res = await fetch(back + "/change_password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword })
  });
  return res.ok;
}

async function apiSetPreferences(token, preferences) {
  try {
    await fetch(back + "/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, preferences })
    });
  } catch (err) {
    console.error("No se pudieron sincronizar las preferencias:", err);
  }
}

async function apiConfirmPairing(token, code) {
  const res = await fetch(back + "/pair/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, code })
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

async function apiGetCurrentInvite(token) {
  const res = await fetch(back + "/invite/current", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

async function apiGenerateInvite(token) {
  const res = await fetch(back + "/invite/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

// --- Guardar sesión y aplicar preferencias tras un login válido ---
function persistSession({ token, username, isAdmin, preferences }) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", username);
  localStorage.setItem("isAdmin", isAdmin ? "true" : "false");
  if (preferences) {
    setSetting("theme", preferences.theme || "light");
    setSetting("readingMode", preferences.readingMode || "scroll");
    applyTheme(preferences.theme || "light");
  }
}

function modalShellStyle() {
  return {
    position: "fixed", top: 0, left: 0,
    width: "100%", height: "100%",
    backgroundColor: "rgba(0,0,0,0.7)",
    display: "flex", justifyContent: "center",
    alignItems: "center", zIndex: 1000
  };
}

// --- Formulario de login / registro (usuario + contraseña) ---
function showLoginForm(onSuccess) {
  const modal = document.createElement("div");
  Object.assign(modal.style, modalShellStyle());
  modal.innerHTML = `
  <div style="background:#333; color:#fff; padding:20px; border-radius:8px; text-align:center; width:300px; box-shadow:0 4px 8px rgba(0,0,0,0.2);">
    <h2 id="auth-title" style="margin-bottom:20px; font-size:1.4rem;">Iniciar sesión</h2>
    <div id="auth-error" style="color:#ff8080; margin-bottom:10px; font-size:0.9rem; display:none;"></div>
    <input type="text" id="auth-username" placeholder="Usuario" autocomplete="username"
      style="margin-bottom:10px; width:100%; padding:10px; border:none; border-radius:4px; font-size:1rem; box-sizing:border-box;">
    <input type="password" id="auth-password" placeholder="Contraseña" autocomplete="current-password"
      style="margin-bottom:10px; width:100%; padding:10px; border:none; border-radius:4px; font-size:1rem; box-sizing:border-box;">
    <input type="text" id="auth-invite-code" placeholder="Código de invitación" style="display:none; margin-bottom:16px; width:100%; padding:10px; border:none; border-radius:4px; font-size:1rem; box-sizing:border-box;">
    <button id="auth-submit" style="width:100%; padding:10px; border:none; border-radius:4px; background-color:#007bff; color:#fff; font-size:1rem; cursor:pointer; margin-bottom:10px; margin-top:6px;">Entrar</button>
    <p style="font-size:0.9rem; margin-bottom:6px;"><a href="#" id="auth-toggle-mode" style="color:#66b2ff;">¿No tienes cuenta? Crear una</a></p>
    <p style="font-size:0.9rem;"><a href="#" id="auth-use-qr" style="color:#66b2ff;">Iniciar sesión con QR (Smart TV)</a></p>
  </div>`;
  document.body.appendChild(modal);

  let mode = "login";
  const title = modal.querySelector("#auth-title");
  const errorBox = modal.querySelector("#auth-error");
  const userInput = modal.querySelector("#auth-username");
  const passInput = modal.querySelector("#auth-password");
  const inviteInput = modal.querySelector("#auth-invite-code");
  const submitBtn = modal.querySelector("#auth-submit");
  const toggleLink = modal.querySelector("#auth-toggle-mode");
  const qrLink = modal.querySelector("#auth-use-qr");

  if (window.isTvMode) makeTvFocusable(qrLink);
  qrLink.addEventListener("click", (e) => {
    e.preventDefault();
    modal.remove();
    showQrLoginScreen(onSuccess);
  });

  if (window.isTvMode) {
    makeTvFocusable(submitBtn);
    makeTvFocusable(toggleLink);
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = "block";
  }

  toggleLink.addEventListener("click", (e) => {
    e.preventDefault();
    mode = mode === "login" ? "register" : "login";
    title.textContent = mode === "login" ? "Iniciar sesión" : "Crear cuenta";
    submitBtn.textContent = mode === "login" ? "Entrar" : "Crear cuenta";
    toggleLink.textContent = mode === "login" ? "¿No tienes cuenta? Crear una" : "¿Ya tienes cuenta? Inicia sesión";
    inviteInput.style.display = mode === "register" ? "block" : "none";
    errorBox.style.display = "none";
  });

  async function submit() {
    const username = userInput.value.trim();
    const password = passInput.value;
    const inviteCode = inviteInput.value.trim();
    if (!username || !password) return showError("Usuario y contraseña son obligatorios.");
    if (mode === "register" && !inviteCode) return showError("Necesitas un código de invitación para crear una cuenta.");

    submitBtn.disabled = true;
    const { ok, data } = mode === "login"
      ? await apiLogin(username, password)
      : await apiRegister(username, password, inviteCode);
    submitBtn.disabled = false;

    if (!ok) {
      showError(data.error || "Ha ocurrido un error, inténtalo de nuevo.");
      return;
    }

    modal.remove();
    persistSession(data);

    if (data.mustChangePassword) {
      showForcePasswordChangeModal(data.token, () => onSuccess(data));
    } else {
      onSuccess(data);
    }
  }

  submitBtn.addEventListener("click", submit);
  [userInput, passInput, inviteInput].forEach(input => {
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  });
}

// --- Cambio de contraseña obligatorio (perfiles heredados con la contraseña por defecto) ---
function showForcePasswordChangeModal(token, onDone) {
  const modal = document.createElement("div");
  Object.assign(modal.style, modalShellStyle());
  modal.innerHTML = `
  <div style="background:#333; color:#fff; padding:20px; border-radius:8px; text-align:center; width:300px; box-shadow:0 4px 8px rgba(0,0,0,0.2);">
    <h2 style="margin-bottom:16px; font-size:1.3rem;">Cambia tu contraseña</h2>
    <p style="margin-bottom:16px; font-size:0.9rem;">Estás usando la contraseña por defecto de tu perfil. Elige una nueva contraseña para tu cuenta antes de continuar.</p>
    <div id="pwd-change-error" style="color:#ff8080; margin-bottom:10px; font-size:0.9rem; display:none;"></div>
    <input type="password" id="new-password" placeholder="Nueva contraseña"
      style="margin-bottom:10px; width:100%; padding:10px; border:none; border-radius:4px; font-size:1rem; box-sizing:border-box;">
    <input type="password" id="new-password-confirm" placeholder="Repite la nueva contraseña"
      style="margin-bottom:16px; width:100%; padding:10px; border:none; border-radius:4px; font-size:1rem; box-sizing:border-box;">
    <button id="pwd-change-submit" style="width:100%; padding:10px; border:none; border-radius:4px; background-color:#28a745; color:#fff; font-size:1rem; cursor:pointer;">Guardar contraseña</button>
  </div>`;
  document.body.appendChild(modal);

  const errorBox = modal.querySelector("#pwd-change-error");
  const submitBtn = modal.querySelector("#pwd-change-submit");
  if (window.isTvMode) makeTvFocusable(submitBtn);

  submitBtn.addEventListener("click", async () => {
    const p1 = modal.querySelector("#new-password").value;
    const p2 = modal.querySelector("#new-password-confirm").value;

    if (!p1 || p1.length < 4) {
      errorBox.textContent = "La contraseña debe tener al menos 4 caracteres.";
      errorBox.style.display = "block";
      return;
    }
    if (p1 !== p2) {
      errorBox.textContent = "Las contraseñas no coinciden.";
      errorBox.style.display = "block";
      return;
    }

    submitBtn.disabled = true;
    const ok = await apiChangePassword(token, p1);
    submitBtn.disabled = false;

    if (!ok) {
      errorBox.textContent = "No se pudo cambiar la contraseña, inténtalo de nuevo.";
      errorBox.style.display = "block";
      return;
    }

    modal.remove();
    onDone();
  });
}

// --- Login por QR (emparejamiento con el móvil) para Smart TV ---
function showQrLoginScreen(onSuccess) {
  const modal = document.createElement("div");
  Object.assign(modal.style, modalShellStyle());
  modal.innerHTML = `
  <div style="background:#333; color:#fff; padding:24px; border-radius:8px; text-align:center; width:360px; box-shadow:0 4px 8px rgba(0,0,0,0.2);">
    <h2 style="margin-bottom:12px; font-size:1.4rem;">Inicia sesión con tu móvil</h2>
    <p style="margin-bottom:16px; font-size:0.95rem;">Escanea este código con la cámara de tu móvil, o entra en la dirección y escribe el código a mano.</p>
    <div id="qr-container" style="background:#fff; padding:12px; border-radius:6px; display:inline-block; margin-bottom:12px;"></div>
    <p style="font-size:0.9rem; margin-bottom:4px;">O entra en:</p>
    <p id="qr-url" style="font-weight:bold; word-break:break-all; margin-bottom:10px;"></p>
    <p style="font-size:0.9rem; margin-bottom:4px;">y escribe el código:</p>
    <p id="qr-code" style="font-size:1.6rem; font-weight:bold; letter-spacing:2px; margin-bottom:16px;"></p>
    <p id="qr-status" style="font-size:0.9rem; color:#ccc;">Generando código…</p>
    <button id="qr-retry" style="display:none; margin-top:12px; padding:10px 20px; border:none; border-radius:4px; background-color:#007bff; color:#fff; font-size:1rem; cursor:pointer;">Generar otro código</button>
    <p style="font-size:0.9rem; margin-top:14px;"><a href="#" id="qr-use-form" style="color:#66b2ff;">Prefiero escribir usuario y contraseña</a></p>
  </div>`;
  document.body.appendChild(modal);

  const qrContainer = modal.querySelector("#qr-container");
  const urlEl = modal.querySelector("#qr-url");
  const codeEl = modal.querySelector("#qr-code");
  const statusEl = modal.querySelector("#qr-status");
  const retryBtn = modal.querySelector("#qr-retry");
  const formLink = modal.querySelector("#qr-use-form");
  if (window.isTvMode) {
    makeTvFocusable(retryBtn);
    makeTvFocusable(formLink);
  }

  let pollTimer = null;
  let stopped = false;

  async function startPairing() {
    statusEl.textContent = "Generando código…";
    retryBtn.style.display = "none";
    qrContainer.innerHTML = "";

    let pairingId, code;
    try {
      const res = await fetch(back + "/pair/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      ({ pairingId, code } = await res.json());
    } catch (err) {
      statusEl.textContent = "No se pudo generar el código. Comprueba tu conexión.";
      retryBtn.style.display = "inline-block";
      return;
    }

    const pairUrl = `${location.origin}/pages/pair.html?code=${code}`;
    urlEl.textContent = pairUrl.replace(/^https?:\/\//, "");
    codeEl.textContent = code;
    new QRCode(qrContainer, { text: pairUrl, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff" });
    statusEl.textContent = "Esperando confirmación…";

    const startedAt = Date.now();
    pollTimer = setInterval(async () => {
      if (stopped) return;
      let status;
      try {
        const res = await fetch(`${back}/pair/status/${pairingId}`);
        status = await res.json();
      } catch {
        return; // reintenta en el siguiente tick
      }

      if (status.status === "confirmed") {
        clearInterval(pollTimer);
        modal.remove();
        persistSession(status);
        if (status.mustChangePassword) {
          showForcePasswordChangeModal(status.token, () => onSuccess(status));
        } else {
          onSuccess(status);
        }
        return;
      }

      if (status.status === "expired" || Date.now() - startedAt > 5 * 60 * 1000) {
        clearInterval(pollTimer);
        statusEl.textContent = "El código ha caducado.";
        retryBtn.style.display = "inline-block";
      }
    }, 2000);
  }

  retryBtn.addEventListener("click", () => {
    if (pollTimer) clearInterval(pollTimer);
    startPairing();
  });

  formLink.addEventListener("click", (e) => {
    e.preventDefault();
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    modal.remove();
    showLoginForm(onSuccess);
  });

  window.addEventListener("beforeunload", () => { stopped = true; });

  startPairing();
}

// --- Código de invitación (solo admins, desde el menú hamburguesa) ---
function showInviteCodeModal(token) {
  const modal = document.createElement("div");
  Object.assign(modal.style, modalShellStyle());
  modal.innerHTML = `
  <div style="background:#333; color:#fff; padding:20px; border-radius:8px; text-align:center; width:320px; box-shadow:0 4px 8px rgba(0,0,0,0.2);">
    <h2 style="margin-bottom:16px; font-size:1.4rem;">Código de invitación</h2>
    <p style="font-size:0.9rem; margin-bottom:16px;">Compártelo con la persona que quieras invitar. Es de un solo uso y caduca a los 30 minutos.</p>
    <p id="invite-current" style="font-size:1.5rem; font-weight:bold; letter-spacing:2px; margin-bottom:8px;">Cargando…</p>
    <p id="invite-expiry" style="font-size:0.85rem; color:#ccc; margin-bottom:16px;"></p>
    <button id="invite-generate" style="width:100%; padding:10px; border:none; border-radius:4px; background-color:#28a745; color:#fff; font-size:1rem; cursor:pointer; margin-bottom:10px;">Generar nuevo código</button>
    <button id="invite-close" style="width:100%; padding:10px; border:none; border-radius:4px; background-color:#555; color:#fff; font-size:1rem; cursor:pointer;">Cerrar</button>
  </div>`;
  document.body.appendChild(modal);

  const codeEl = modal.querySelector("#invite-current");
  const expiryEl = modal.querySelector("#invite-expiry");
  const generateBtn = modal.querySelector("#invite-generate");
  if (window.isTvMode) makeTvFocusable(generateBtn);

  function render(data) {
    if (data.code) {
      codeEl.textContent = data.code;
      expiryEl.textContent = `Caduca a las ${new Date(data.expiresAt).toLocaleTimeString()}`;
    } else {
      codeEl.textContent = "Sin código activo";
      expiryEl.textContent = "";
    }
  }

  apiGetCurrentInvite(token).then(({ data }) => render(data));

  generateBtn.addEventListener("click", async () => {
    generateBtn.disabled = true;
    const { ok, data } = await apiGenerateInvite(token);
    generateBtn.disabled = false;
    if (ok) render(data);
  });

  modal.querySelector("#invite-close").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
}
