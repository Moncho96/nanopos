let pedidos = [];
let sucursalId = null;
const socket = io();

async function cargarSucursales() {
  const sucursales = await fetch('/api/sucursales').then((r) => r.json());
  const select = document.getElementById('sucursal-select');
  select.innerHTML = sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');
  sucursalId = Number(select.value);
  select.addEventListener('change', () => {
    sucursalId = Number(select.value);
    socket.emit('join_sucursal', sucursalId);
    cargarPedidos();
  });
  socket.emit('join_sucursal', sucursalId);
  cargarPedidos();
}

async function cargarPedidos() {
  pedidos = await fetch(`/api/pedidos?sucursal_id=${sucursalId}`).then((r) => r.json());
  // solo interesa lo que sigue activo en cocina
  pedidos = pedidos.filter((p) => ['recibido', 'en_preparacion', 'listo'].includes(p.estado));
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
}

function renderTicket(pedido) {
  const hora = new Date(pedido.creado_en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const items = pedido.items
    .map((it) => {
      const opciones = it.opciones_seleccionadas || [];
      const detalle = opciones.length
        ? `<div style="font-size:12px;opacity:0.75;margin-left:12px">${opciones.map((o) => o.nombre).join(', ')}</div>`
        : '';
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

  return `
    <div class="ticket ${pedido.estado}">
      <div class="top">
        <span>#${pedido.id} · ${pedido.tipo}</span>
        <span>${hora}</span>
      </div>
      <div class="items">${items}</div>
      ${pedido.cliente_nombre ? `<div class="cliente">${pedido.cliente_nombre} · ${pedido.cliente_telefono || ''}</div>` : ''}
      ${boton}
    </div>`;
}

async function avanzarEstado(pedidoId, destino) {
  await fetch(`/api/pedidos/${pedidoId}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: destino }),
  });
}

socket.on('nuevo_pedido', (pedido) => {
  pedidos.push(pedido);
  render();
  // sonido simple para avisar de pedido nuevo
  try {
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    osc.connect(audio.destination);
    osc.frequency.value = 880;
    osc.start();
    setTimeout(() => osc.stop(), 200);
  } catch (e) {}
});

socket.on('pedido_actualizado', (pedidoActualizado) => {
  if (pedidoActualizado.estado === 'entregado' || pedidoActualizado.estado === 'cancelado') {
    pedidos = pedidos.filter((p) => p.id !== pedidoActualizado.id);
  } else {
    const idx = pedidos.findIndex((p) => p.id === pedidoActualizado.id);
    if (idx >= 0) pedidos[idx] = { ...pedidos[idx], ...pedidoActualizado };
  }
  render();
});

cargarSucursales();
