const params = new URLSearchParams(window.location.search);
const token = params.get('token');

let calificacionElegida = 0;
let pedidoInfo = null;

function mostrarPantalla(id) {
  ['pantalla-cargando', 'pantalla-error', 'pantalla-ya', 'pantalla-form', 'pantalla-gracias'].forEach((p) => {
    document.getElementById(p).style.display = p === id ? 'block' : 'none';
  });
}

async function init() {
  if (!token) {
    mostrarPantalla('pantalla-error');
    document.getElementById('pantalla-error').textContent = 'Este link no es válido.';
    return;
  }

  try {
    const resp = await fetch(`/api/resenas/pedido/${token}`);
    if (!resp.ok) {
      mostrarPantalla('pantalla-error');
      document.getElementById('pantalla-error').textContent = 'Este link no es válido o ya expiró.';
      return;
    }
    pedidoInfo = await resp.json();

    if (pedidoInfo.ya_reseno) {
      mostrarPantalla('pantalla-ya');
      return;
    }

    document.getElementById('titulo-form').textContent =
      `Hola ${pedidoInfo.cliente_nombre || ''}, ¿cómo estuvo tu pedido en ${pedidoInfo.sucursal_nombre}?`;
    renderEstrellas();
    mostrarPantalla('pantalla-form');
  } catch (err) {
    mostrarPantalla('pantalla-error');
    document.getElementById('pantalla-error').textContent = 'No se pudo cargar, revisa tu conexión.';
  }
}

function renderEstrellas() {
  const cont = document.getElementById('estrellas');
  cont.innerHTML = [1, 2, 3, 4, 5]
    .map((n) => `<span class="estrella" data-n="${n}">★</span>`)
    .join('');
  cont.querySelectorAll('.estrella').forEach((el) => {
    el.addEventListener('click', () => {
      calificacionElegida = Number(el.dataset.n);
      pintarEstrellas();
      document.getElementById('btn-enviar').disabled = false;
    });
  });
}

function pintarEstrellas() {
  document.querySelectorAll('.estrella').forEach((el) => {
    el.classList.toggle('activa', Number(el.dataset.n) <= calificacionElegida);
  });
}

document.getElementById('btn-enviar').addEventListener('click', async () => {
  const statusEl = document.getElementById('status-form');
  if (!calificacionElegida) {
    statusEl.textContent = 'Elige una calificación de estrellas primero.';
    return;
  }

  const comentario = document.getElementById('comentario').value.trim();
  const btn = document.getElementById('btn-enviar');
  btn.disabled = true;
  statusEl.textContent = '';

  try {
    const resp = await fetch('/api/resenas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, calificacion: calificacionElegida, comentario }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = err.error || 'No se pudo enviar, intenta de nuevo.';
      btn.disabled = false;
      return;
    }

    if (calificacionElegida >= 4) {
      document.getElementById('mensaje-gracias').textContent =
        'Nos da mucho gusto que te haya gustado. ¿Nos ayudarías compartiéndolo en Google? Le sirve muchísimo a un negocio pequeño como el nuestro.';
      if (pedidoInfo.google_maps_url) {
        const btnGoogle = document.getElementById('btn-google');
        btnGoogle.href = pedidoInfo.google_maps_url;
        btnGoogle.style.display = 'inline-flex';
      }
    } else {
      document.getElementById('mensaje-gracias').textContent =
        'Gracias por contarnos — vamos a tomar en cuenta tu comentario para mejorar.';
    }
    mostrarPantalla('pantalla-gracias');
  } catch (err) {
    statusEl.textContent = 'No se pudo enviar, revisa tu conexión.';
    btn.disabled = false;
  }
});

init();
