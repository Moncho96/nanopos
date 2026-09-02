const params = new URLSearchParams(window.location.search);
const siguiente = params.get('next') || '/pos';

async function intentarEntrar() {
  const password = document.getElementById('password').value;
  const statusEl = document.getElementById('status');
  const btn = document.getElementById('btn-entrar');

  if (!password) {
    statusEl.textContent = 'Escribe la contraseña.';
    return;
  }

  btn.disabled = true;
  statusEl.textContent = '';

  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = err.error || 'No se pudo entrar';
      btn.disabled = false;
      return;
    }
    window.location.href = siguiente;
  } catch (err) {
    statusEl.textContent = 'No se pudo conectar, revisa tu internet.';
    btn.disabled = false;
  }
}

document.getElementById('btn-entrar').addEventListener('click', intentarEntrar);
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') intentarEntrar();
});
