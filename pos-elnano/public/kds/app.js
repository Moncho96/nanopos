let pedidos = [];
let sucursalId = null;
const socket = io();

const UMBRAL_AMARILLO_MIN = 10;
const UMBRAL_ROJO_MIN = 15;

function normalizarSlug(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function cargarSucursales() {
  const empleado = await fetch('/api/me').then((r) => (r.ok ? r.json() : null));
  const sucursales = await fetch('/api/sucursales').then((r) => r.json());
  const select = document.getElementById('sucursal-select');
  select.innerHTML = sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');

  const params = new URLSearchParams(window.location.search);
  const sucursalParam = params.get('sucursal');
  if (sucursalParam) {
    const encontrada = sucursales.find(
      (s) => normalizarSlug(s.nombre) === sucursalParam.toLowerCase() || String(s.id) === sucursalParam
    );
    if (encontrada) select.value = encontrada.id;
  }

  if (empleado?.sucursal_id) {
    select.value = empleado.sucursal_id;
    select.disabled = true;
    select.title = 'Tu acceso está limitado a esta sucursal';
  }

  sucursalId = Number(select.value);
  select.addEventListener('change', () => {
    sucursalId = Number(select.value);
    socket.emit('join_sucursal', sucursalId);
    cargarPedidos();
    cargarPromedio();
  });
  document.getElementById('btn-ir-pos').addEventListener('click', () => {
    const sucursalActual = sucursales.find((s) => s.id === sucursalId);
    const slug = sucursalActual ? normalizarSlug(sucursalActual.nombre) : '';
    window.location.href = slug ? `/pos?sucursal=${slug}` : '/pos';
  });
  socket.emit('join_sucursal', sucursalId);
  cargarPedidos();
  cargarPromedio();
  setInterval(cargarPromedio, 60000); // refresca el promedio cada minuto
  setInterval(actualizarCronometros, 1000); // el cronómetro de cada ticket, en vivo
}

async function cargarPromedio() {
  const data = await fetch(`/api/kds/tiempo-promedio?sucursal_id=${sucursalId}`).then((r) => r.json());
  const barra = document.getElementById('promedio-bar');
  if (!data.promedioMinutos) {
    barra.textContent = '⏱️ Todavía no hay pedidos terminados hoy para calcular el promedio';
  } else {
    barra.innerHTML = `⏱️ Tiempo promedio de hoy: <strong>${data.promedioMinutos} min</strong> (basado en ${data.cantidad} pedido${data.cantidad === 1 ? '' : 's'})`;
  }
}

async function cargarPedidos() {
  pedidos = await fetch(`/api/pedidos?sucursal_id=${sucursalId}`).then((r) => r.json());
  // solo interesa lo que sigue activo en cocina
  pedidos = pedidos.filter((p) => ['recibido', 'en_preparacion', 'listo'].includes(p.estado) && !p.cancelado);
  render();
}

function render() {
  const cols = { recibido: [], en_preparacion: [], listo: [] };
  pedidos.forEach((p) => {
    if (cols[p.estado]) cols[p.estado].push(p);
  });

  for (const estado of Object.keys(cols)) {
    const cont = document.getElementById(`col-${estado}`);
    cont.innerHTML = cols[estado]
      .map((p) => renderTicket(p))
      .join('') || '<p style="opacity:0.5">Sin pedidos</p>';
  }

  document.querySelectorAll('[data-avanzar]').forEach((btn) => {
    btn.addEventListener('click', () => avanzarEstado(Number(btn.dataset.avanzar), btn.dataset.destino));
  });
  actualizarCronometros();
}

function renderTicket(pedido) {
  const items = pedido.items
    .filter((it) => it.estado !== 'entregado') // no repetir lo que ya se sirvió antes de reabrirse
    .map((it) => {
      const opciones = it.opciones_seleccionadas || [];
      const detalle = opciones.length
        ? `<div style="font-size:12px;opacity:0.75;margin-left:12px">${opciones.map((o) => o.nombre).join(', ')}</div>`
        : '';
      if (it.cancelado) {
        return `<div class="item" style="color:#ff5c5c;text-decoration:line-through"><span>${it.cantidad}x ${it.producto_nombre} (cancelado)</span></div>`;
      }
      return `<div class="item"><span>${it.cantidad}x ${it.producto_nombre}</span></div>${detalle}`;
    })
    .join('');

  let boton = '';
  if (pedido.estado === 'recibido') {
    boton = `<button class="btn-avanzar" data-avanzar="${pedido.id}" data-destino="en_preparacion">Empezar a preparar</button>`;
  } else if (pedido.estado === 'en_preparacion') {
    boton = `<button class="btn-listo" data-avanzar="${pedido.id}" data-destino="listo">Marcar listo</button>`;
  } else if (pedido.estado === 'listo') {
    boton = `<button class="btn-entregar" data-avanzar="${pedido.id}" data-destino="entregado">Entregado</button>`;
  }

  const tieneHistorialPrevio = pedido.items.some((it) => it.estado === 'entregado');

  return `
    <div class="ticket ${pedido.estado}">
      <div class="top">
        <span>#${pedido.numero_dia ?? pedido.id} · ${pedido.tipo}</span>
        <span class="cronometro" data-creado="${pedido.creado_en}" data-listo="${pedido.listo_en || ''}">--:--</span>
      </div>
      ${tieneHistorialPrevio ? '<div style="font-size:11px;color:#facc15;margin-bottom:4px">🔄 Se agregó algo nuevo a este pedido</div>' : ''}
      <div class="items">${items}</div>
      ${pedido.cliente_nombre ? `<div class="cliente">${pedido.cliente_nombre} · ${pedido.cliente_telefono || ''}</div>` : ''}
      ${boton}
    </div>`;
}

function actualizarCronometros() {
  document.querySelectorAll('.cronometro').forEach((el) => {
    const creado = new Date(el.dataset.creado).getTime();
    const finCongelado = el.dataset.listo ? new Date(el.dataset.listo).getTime() : null;
    const finReferencia = finCongelado || Date.now();
    const totalSegundos = Math.max(0, Math.floor((finReferencia - creado) / 1000));
    const minutos = Math.floor(totalSegundos / 60);
    const segundos = totalSegundos % 60;
    el.textContent = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

    el.classList.remove('verde', 'amarillo', 'rojo');
    if (finCongelado) {
      el.classList.add('verde'); // ya está listo, no hace falta alarmar con color
    } else if (minutos >= UMBRAL_ROJO_MIN) {
      el.classList.add('rojo');
    } else if (minutos >= UMBRAL_AMARILLO_MIN) {
      el.classList.add('amarillo');
    } else {
      el.classList.add('verde');
    }
  });
}

async function avanzarEstado(pedidoId, destino) {
  await fetch(`/api/pedidos/${pedidoId}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: destino }),
  });
}

function sonarAviso() {
  try {
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    osc.connect(audio.destination);
    osc.frequency.value = 880;
    osc.start();
    setTimeout(() => osc.stop(), 200);
  } catch (e) {}
}

socket.on('nuevo_pedido', (pedido) => {
  pedidos.push(pedido);
  render();
  sonarAviso();
});

socket.on('pedido_actualizado', (pedidoActualizado) => {
  const sigueActivo = ['recibido', 'en_preparacion', 'listo'].includes(pedidoActualizado.estado) && !pedidoActualizado.cancelado;

  if (!sigueActivo) {
    pedidos = pedidos.filter((p) => p.id !== pedidoActualizado.id);
  } else {
    const idx = pedidos.findIndex((p) => p.id === pedidoActualizado.id);
    if (idx >= 0) {
      // Si cambiaron los productos del pedido (se agregó o canceló algo), avisa con sonido
      const itemsAntes = JSON.stringify((pedidos[idx].items || []).map((i) => [i.id, i.cancelado]));
      const itemsDespues = JSON.stringify((pedidoActualizado.items || []).map((i) => [i.id, i.cancelado]));
      pedidos[idx] = { ...pedidos[idx], ...pedidoActualizado };
      if (itemsAntes !== itemsDespues) sonarAviso();
      if (pedidoActualizado.estado === 'listo') cargarPromedio();
    } else {
      // El pedido no estaba en el tablero (ya se había entregado) y ahora se reabrió
      // porque le agregaron algo nuevo — lo regresamos al tablero con aviso.
      pedidos.push(pedidoActualizado);
      sonarAviso();
    }
  }
  render();
});

cargarSucursales();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
