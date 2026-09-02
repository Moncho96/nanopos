const params = new URLSearchParams(window.location.search);
const siguiente = params.get('next') || '/pos';

let pin = '';

function renderPuntos() {
  document.getElementById('puntos').innerHTML = [0, 1, 2, 3]
    .map((i) => `<div class="punto ${i < pin.length ? 'lleno' : ''}"></div>`)
    .join('');
}

function renderTeclado() {
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←'];
  document.getElementById('teclado').innerHTML = teclas
    .map((t) => (t === '' ? '<div></div>' : `<button class="tecla ${t === '←' ? 'borrar' : ''}" data-t="${t}">${t}</button>`))
    .join('');
  document.querySelectorAll('.tecla').forEach((btn) => {
    btn.addEventListener('click', () => manejarTecla(btn.dataset.t));
  });
}

function manejarTecla(t) {
  document.getElementById('status').textContent = '';
  if (t === '←') {
    pin = pin.slice(0, -1);
  } else if (pin.length < 4) {
    pin += t;
  }
  renderPuntos();
  if (pin.length === 4) intentarEntrar();
}

async function intentarEntrar() {
  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Entrando...';

  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = err.error || 'No se pudo entrar';
      pin = '';
      renderPuntos();
      return;
    }
    window.location.href = siguiente;
  } catch (err) {
    statusEl.textContent = 'No se pudo conectar, revisa tu internet.';
    pin = '';
    renderPuntos();
  }
}

renderPuntos();
renderTeclado();
