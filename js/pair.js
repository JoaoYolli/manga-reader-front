// pair.js — lado móvil del login por QR: confirma en el backend que esta
// cuenta autoriza la sesión que la Smart TV está esperando.

function getPairingCode() {
    return new URLSearchParams(window.location.search).get('code');
}

function setStatus(html) {
    document.getElementById('pair-status').innerHTML = html;
}

async function confirmWithToken(token, code) {
    setStatus('<p>Vinculando sesión…</p>');
    const { ok, data } = await apiConfirmPairing(token, code);
    if (ok) {
        setStatus('<p>✅ Sesión iniciada en tu TV.</p><p>Ya puedes volver a la pantalla de tu televisor.</p>');
    } else {
        setStatus(`<p>❌ ${data.error || 'No se pudo vincular la sesión.'}</p><p>El código puede haber caducado; genera uno nuevo desde la TV.</p>`);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const code = getPairingCode();
    if (!code) {
        setStatus('<p>Falta el código de vinculación. Escanea de nuevo el QR que aparece en tu TV.</p>');
        return;
    }

    const token = localStorage.getItem('token');
    if (token && (await validateToken(token))) {
        await confirmWithToken(token, code);
        return;
    }

    setStatus('<p>Inicia sesión para vincular tu TV.</p>');
    showLoginForm((data) => confirmWithToken(data.token, code));
});

async function validateToken(token) {
    try {
        const res = await fetch(back + "/validate_token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        });
        return res.status === 200;
    } catch (err) {
        return false;
    }
}
