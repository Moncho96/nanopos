const TIPO_LABELS = { mesa: 'Mesa', para_llevar: 'Para llevar', domicilio: 'Domicilio' };
const METODO_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Dividido' };
const CATEGORIA_EMOJI = {
  'Bistec y Gueros': '🌮',
  'Volcanes y Piratas': '🌋',
  'Burritos y Tortas': '🌯',
  Combos: '🍽️',
  Complementos: '🍟',
  'Nano Smash': '🍔',
};

const CORTE_CUTOFF_HORAS = 6; // debe coincidir con CORTE_CUTOFF_HORAS en server.js

// El "día de negocio" no cambia a medianoche: si todavía es antes de la hora de
// corte (ej. antes de las 6am), sigue contando como el día anterior — así una
// venta de la 1am de un turno que empezó a las 6pm no se va al día siguiente.
function fechaNegocioActual() {
  const ahora = new Date();
  if (ahora.getHours() < CORTE_CUTOFF_HORAS) {
    ahora.setDate(ahora.getDate() - 1);
  }
  const y = ahora.getFullYear();
  const m = String(ahora.getMonth() + 1).padStart(2, '0');
  const d = String(ahora.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const state = {
  sucursales: [],
  categorias: [],
  productos: [],
  envios: [],
  categoriaActivaOverlay: null,
};

let tipoActivo = 'todos';
let ticketState = null; // ver abrirOverlayNuevo / abrirOverlayEditar

// ==================== CARGA INICIAL ====================

async function cargarInicial() {
  state.sucursales = await fetch('/api/sucursales').then((r) => r.json());
  state.categorias = await fetch('/api/categorias').then((r) => r.json());
  state.productos = await fetch('/api/productos').then((r) => r.json());

  const select = document.getElementById('sucursal-select');
  select.innerHTML = state.sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');
  select.addEventListener('change', async () => {
    state.envios = await fetch(`/api/envios?sucursal_id=${select.value}`).then((r) => r.json());
    cargarPedidosYContar();
  });

  state.categoriaActivaOverlay = state.categorias[0]?.id ?? null;
  state.envios = await fetch(`/api/envios?sucursal_id=${select.value}`).then((r) => r.json());

  cargarPedidosYContar();
}

// ==================== TABS DE TIPO ====================

document.querySelectorAll('.tipo-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    tipoActivo = btn.dataset.tipo;
    document.querySelectorAll('.tipo-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    cargarPedidosYContar();
  });
});

// ==================== LISTA DE PEDIDOS (solo pendientes, no cancelados) ====================

async function cargarPedidosYContar() {
  const sucursalId = document.getElementById('sucursal-select').value;
  if (!sucursalId) return;

  const pendientes = await fetch(`/api/pedidos?sucursal_id=${sucursalId}&pagado=false&cancelado=false`).then((r) => r.json());
  const counts = { mesa: 0, para_llevar: 0, domicilio: 0 };
  pendientes.forEach((p) => {
    if (counts[p.tipo] !== undefined) counts[p.tipo]++;
  });
  document.getElementById('count-mesa').textContent = counts.mesa;
  document.getElementById('count-para_llevar').textContent = counts.para_llevar;
  document.getElementById('count-domicilio').textContent = counts.domicilio;
  document.getElementById('count-todos').textContent = pendientes.length;

  const pedidos = tipoActivo === 'todos' ? pendientes : pendientes.filter((p) => p.tipo === tipoActivo);
  renderListaPedidos(pedidos);
}

function renderListaPedidos(pedidos) {
  const cont = document.getElementById('lista-pedidos');
  const sinPedidos = document.getElementById('sin-pedidos');

  if (!pedidos.length) {
    cont.innerHTML = '';
    sinPedidos.style.display = 'block';
    return;
  }
  sinPedidos.style.display = 'none';

  cont.innerHTML = pedidos.map((p) => renderPedidoRow(p)).join('');
  cont.querySelectorAll('.pedido-row').forEach((el) => {
    el.addEventListener('click', () => abrirOverlayEditar(Number(el.dataset.id)));
  });
}

function renderPedidoRow(pedido) {
  const hora = new Date(pedido.creado_en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const fechaCorta = new Date(pedido.creado_en).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  const itemsTexto = (pedido.items || [])
    .filter((it) => !it.cancelado)
    .map((it) => `${it.cantidad}x ${it.producto_nombre}`)
    .join(', ');
  const tipoLabel = TIPO_LABELS[pedido.tipo] || pedido.tipo;

  let badgeEstado;
  if (pedido.cancelado) {
    badgeEstado = `<span class="badge badge-pendiente" style="background:#eee;color:#888">❌ Cancelado</span>`;
  } else if (pedido.pagado) {
    badgeEstado = `<span class="badge badge-pagado">✅ ${METODO_LABELS[pedido.metodo_pago] || pedido.metodo_pago}</span>`;
  } else {
    badgeEstado = `<span class="badge badge-pendiente">⏳ Por cobrar</span>`;
  }

  return `
    <div class="pedido-row" data-id="${pedido.id}">
      <div class="pedido-row-top">
        <span class="pedido-row-id">#${pedido.id} <span class="badge badge-${pedido.tipo}">${tipoLabel}</span></span>
        <span class="pedido-row-hora">${fechaCorta} · ${hora}</span>
      </div>
      <div class="pedido-row-cliente">👤 ${pedido.cliente_nombre || ''}</div>
      <div class="pedido-row-items">${itemsTexto}</div>
      <div class="pedido-row-bottom">
        <span class="pedido-row-total">$${Number(pedido.total).toFixed(2)}</span>
        ${badgeEstado}
      </div>
    </div>`;
}

// ==================== RESUMEN DE CAJA PLEGABLE ====================

document.getElementById('resumen-toggle').addEventListener('click', () => {
  const toggle = document.getElementById('resumen-toggle');
  const panel = document.getElementById('resumen-panel');
  const abierto = toggle.classList.toggle('abierto');
  panel.style.display = abierto ? 'block' : 'none';
  if (abierto) cargarResumenCaja();
});

async function cargarResumenCaja() {
  const sucursalId = document.getElementById('sucursal-select').value;
  const hoy = fechaNegocioActual();
  const corte = await fetch(`/api/corte?sucursal_id=${sucursalId}&fecha=${hoy}`).then((r) => r.json());

  const panel = document.getElementById('resumen-panel');
  panel.innerHTML =
    corte.resumen
      .map(
        (r) => `
      <div class="resumen-fila">
        <span class="metodo">${METODO_LABELS[r.metodo]}</span>
        <span class="valor">$${r.ventas.toFixed(2)}</span>
      </div>`
      )
      .join('') +
    `<div class="resumen-total-linea"><span>Total (${corte.pedidosCobrados} pedidos)</span><span>$${corte.totalVentas.toFixed(2)}</span></div>`;
}

// ==================== MENÚ "+ NUEVO PEDIDO" ====================

document.getElementById('btn-nuevo-pedido').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('nuevo-pedido-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', () => {
  document.getElementById('nuevo-pedido-menu').style.display = 'none';
});
document.querySelectorAll('#nuevo-pedido-menu button').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('nuevo-pedido-menu').style.display = 'none';
    abrirOverlayNuevo(btn.dataset.tipo);
  });
});

// ==================== OVERLAY: NUEVO / EDITAR PEDIDO ====================

function abrirOverlayNuevo(tipo) {
  ticketState = { modo: 'nuevo', tipo, pedidoId: null, carrito: [], costoEnvio: 0, soloLectura: false };
  document.getElementById('overlay-titulo').textContent = 'Nuevo pedido — ' + TIPO_LABELS[tipo];
  document.querySelector('.overlay-body').classList.remove('vista-productos');
  prepararCamposCliente();
  mostrarControlesTicket(true);
  document.getElementById('btn-mostrar-productos').style.display = '';
  document.getElementById('btn-t-cancelar').textContent = 'Cancelar';
  document.getElementById('btn-t-aceptar').style.display = 'block';
  document.getElementById('btn-t-pago').style.display = 'block';
  state.categoriaActivaOverlay = state.categorias[0]?.id ?? null;
  renderCatSidebarOverlay();
  renderProductosOverlay();
  renderTicketPanel();
  document.getElementById('overlay-pedido').classList.add('abierto');
}

async function abrirOverlayEditar(pedidoId) {
  const pedido = await fetch(`/api/pedidos/${pedidoId}`).then((r) => r.json());
  ticketState = { modo: 'editar', tipo: pedido.tipo, pedidoId: pedido.id, pedidoData: pedido, soloLectura: pedido.pagado || pedido.cancelado };
  document.getElementById('overlay-titulo').textContent = `Pedido #${pedido.id}` + (pedido.pagado ? ' — cobrado' : '');
  document.querySelector('.overlay-body').classList.remove('vista-productos');
  prepararCamposCliente();
  document.getElementById('ticket-cliente-nombre').value = pedido.cliente_nombre || '';
  document.getElementById('ticket-cliente-nombre').disabled = true;
  document.getElementById('ticket-cliente-telefono').value = pedido.cliente_telefono || '';
  document.getElementById('ticket-cliente-telefono').disabled = true;

  mostrarControlesTicket(!ticketState.soloLectura);
  document.getElementById('btn-mostrar-productos').style.display = ticketState.soloLectura ? 'none' : '';
  document.getElementById('btn-t-cancelar').textContent = 'Cerrar';
  document.getElementById('btn-t-aceptar').style.display = 'none';
  document.getElementById('btn-t-pago').style.display = ticketState.soloLectura ? 'none' : 'block';

  const bannerCancelado = document.getElementById('ticket-cancelado-banner');
  const accionesExtra = document.getElementById('ticket-acciones-extra');
  const btnCambiarMetodo = document.getElementById('btn-cambiar-metodo');
  const btnCancelarCompleto = document.getElementById('btn-cancelar-pedido-completo');

  bannerCancelado.style.display = pedido.cancelado ? 'block' : 'none';
  accionesExtra.style.display = pedido.cancelado ? 'none' : 'flex';
  btnCambiarMetodo.style.display = pedido.pagado && !pedido.cancelado ? 'block' : 'none';
  btnCancelarCompleto.style.display = pedido.cancelado ? 'none' : 'block';

  if (pedido.cancelado) {
    document.getElementById('btn-t-pago').style.display = 'none';
  }

  state.categoriaActivaOverlay = state.categorias[0]?.id ?? null;
  renderCatSidebarOverlay();
  renderProductosOverlay();
  renderTicketPanel();
  document.getElementById('overlay-pedido').classList.add('abierto');
}

document.getElementById('btn-cancelar-pedido-completo').addEventListener('click', async () => {
  if (!confirm(`¿Cancelar el pedido #${ticketState.pedidoId} por completo? No se puede deshacer.`)) return;
  await fetch(`/api/pedidos/${ticketState.pedidoId}/cancelar`, { method: 'PATCH' });
  ticketState = null;
  document.getElementById('overlay-pedido').classList.remove('abierto');
  cargarPedidosYContar();
  if (document.getElementById('overlay-historial').classList.contains('abierto')) cargarHistorial();
});

document.getElementById('btn-cambiar-metodo').addEventListener('click', () => {
  const pedido = ticketState.pedidoData;
  document.getElementById('overlay-pedido').classList.remove('abierto');
  abrirModalCobroDirecto(pedido, true);
});

function mostrarControlesTicket(mostrar) {
  const sidebar = document.getElementById('cat-sidebar');
  const area = document.querySelector('.productos-area');
  if (mostrar) {
    // Sin estilo en línea: deja que el CSS (y el responsivo de móvil) decida cuándo mostrarlos
    sidebar.style.display = '';
    area.style.display = '';
  } else {
    // Pedido ya cobrado: ocultarlos siempre, sin importar el tamaño de pantalla
    sidebar.style.display = 'none';
    area.style.display = 'none';
  }
}

function prepararCamposCliente() {
  document.getElementById('ticket-cliente-nombre').disabled = false;
  document.getElementById('ticket-cliente-telefono').disabled = false;
  document.getElementById('ticket-cliente-nombre').value = '';
  document.getElementById('ticket-cliente-telefono').value = '';
  document.getElementById('ticket-cliente-direccion').value = '';

  const esDomicilioNuevo = ticketState.modo === 'nuevo' && ticketState.tipo === 'domicilio';
  document.getElementById('ticket-cliente-direccion').style.display = esDomicilioNuevo ? 'block' : 'none';
  document.getElementById('ticket-cliente-colonia').style.display = esDomicilioNuevo ? 'block' : 'none';
  document.getElementById('ticket-envio-info').style.display = 'none';

  if (esDomicilioNuevo) renderColoniaOptionsTicket();
}

function renderColoniaOptionsTicket() {
  const sel = document.getElementById('ticket-cliente-colonia');
  if (!state.envios.length) {
    sel.innerHTML = '<option value="">Sin colonias registradas — agrégalas en el menú ☰</option>';
    return;
  }
  sel.innerHTML =
    '<option value="">Selecciona colonia</option>' +
    state.envios.map((e) => `<option value="${e.colonia}">${e.colonia} — $${Number(e.costo).toFixed(2)}</option>`).join('');
}

document.getElementById('ticket-cliente-colonia').addEventListener('change', () => {
  const infoEl = document.getElementById('ticket-envio-info');
  const coloniaEscrita = document.getElementById('ticket-cliente-colonia').value;
  const match = state.envios.find((e) => e.colonia === coloniaEscrita);
  if (match) {
    ticketState.costoEnvio = Number(match.costo);
    infoEl.textContent = `🚚 Envío: $${ticketState.costoEnvio.toFixed(2)}`;
    infoEl.style.display = 'block';
  } else {
    ticketState.costoEnvio = 0;
    infoEl.style.display = 'none';
  }
  renderTicketPanel();
});

document.getElementById('btn-cerrar-overlay').addEventListener('click', cerrarOverlayPedido);
document.getElementById('btn-t-cancelar').addEventListener('click', cerrarOverlayPedido);

function cerrarOverlayPedido() {
  if (ticketState && ticketState.modo === 'nuevo' && ticketState.carrito.length) {
    if (!confirm('Vas a perder los productos agregados. ¿Cerrar de todas formas?')) return;
  }
  document.getElementById('overlay-pedido').classList.remove('abierto');
  ticketState = null;
  cargarPedidosYContar();
  if (document.getElementById('overlay-historial').classList.contains('abierto')) cargarHistorial();
}

// ---------- Categorías y productos dentro del overlay ----------

function renderCatSidebarOverlay() {
  const cont = document.getElementById('cat-sidebar');
  cont.innerHTML = state.categorias
    .map(
      (c) => `
      <div class="cat-sidebar-item ${c.id === state.categoriaActivaOverlay ? 'active' : ''}" data-id="${c.id}">
        <div>${CATEGORIA_EMOJI[c.nombre] || '🍴'}</div>
        <div>${c.nombre}</div>
      </div>`
    )
    .join('');
  cont.querySelectorAll('.cat-sidebar-item').forEach((el) => {
    el.addEventListener('click', () => {
      state.categoriaActivaOverlay = Number(el.dataset.id);
      document.getElementById('buscador-producto').value = '';
      renderCatSidebarOverlay();
      renderProductosOverlay();
    });
  });
}

document.getElementById('buscador-producto').addEventListener('input', renderProductosOverlay);

function renderProductosOverlay() {
  const cont = document.getElementById('productos-grid-overlay');
  const busqueda = document.getElementById('buscador-producto').value.trim().toLowerCase();

  const lista = busqueda
    ? state.productos.filter((p) => p.nombre.toLowerCase().includes(busqueda))
    : state.productos.filter((p) => p.categoria_id === state.categoriaActivaOverlay);

  const categoriaPorId = {};
  state.categorias.forEach((c) => (categoriaPorId[c.id] = c.nombre));

  cont.innerHTML = lista
    .map(
      (p) => `
      <div class="prod-tile" data-id="${p.id}">
        <div class="emoji">${CATEGORIA_EMOJI[categoriaPorId[p.categoria_id]] || '🍴'}</div>
        <div class="nombre">${p.nombre}</div>
        <div class="precio">$${Number(p.precio).toFixed(2)}</div>
      </div>`
    )
    .join('');

  cont.querySelectorAll('.prod-tile').forEach((el) => {
    el.addEventListener('click', () => manejarClickProducto(Number(el.dataset.id)));
  });
}

function manejarClickProducto(productoId) {
  const producto = state.productos.find((p) => p.id === productoId);
  const grupos = producto.grupos_modificadores || [];

  const onAgregar = ticketState.modo === 'nuevo' ? agregarAlCarritoTicket : agregarItemAEditar;

  if (grupos.length === 0) {
    onAgregar({
      producto_id: producto.id,
      nombre: producto.nombre,
      precio: Number(producto.precio),
      cantidad: 1,
      opciones_seleccionadas: [],
    });
  } else {
    abrirModalModificadores(producto, grupos, onAgregar);
  }
}

// ---------- Carrito local (modo "nuevo") ----------

function agregarAlCarritoTicket(item) {
  const clave = item.producto_id + '|' + JSON.stringify(item.opciones_seleccionadas);
  const existente = ticketState.carrito.find((it) => it._clave === clave);
  if (existente) existente.cantidad += item.cantidad;
  else ticketState.carrito.push({ ...item, _clave: clave });
  document.getElementById('modal-container').innerHTML = '';
  renderTicketPanel();
}

function quitarDelCarritoTicket(clave) {
  const item = ticketState.carrito.find((it) => it._clave === clave);
  if (!item) return;
  item.cantidad -= 1;
  if (item.cantidad <= 0) ticketState.carrito = ticketState.carrito.filter((it) => it._clave !== clave);
  renderTicketPanel();
}

// ---------- Edición en vivo (modo "editar") ----------

async function agregarItemAEditar(item) {
  await fetch(`/api/pedidos/${ticketState.pedidoId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: item.precio,
      opciones_seleccionadas: item.opciones_seleccionadas,
    }),
  });
  ticketState.pedidoData = await fetch(`/api/pedidos/${ticketState.pedidoId}`).then((r) => r.json());
  document.getElementById('modal-container').innerHTML = '';
  renderTicketPanel();
}

async function cancelarItemEditar(itemId) {
  await fetch(`/api/pedido_items/${itemId}/cancelar`, { method: 'PATCH' });
  ticketState.pedidoData = await fetch(`/api/pedidos/${ticketState.pedidoId}`).then((r) => r.json());
  renderTicketPanel();
}

// ---------- Panel del ticket (común a ambos modos) ----------

function renderTicketPanel() {
  const cont = document.getElementById('ticket-items');
  let items, total;

  if (ticketState.modo === 'nuevo') {
    items = ticketState.carrito;
    const totalProductos = items.reduce((sum, it) => sum + it.precio * it.cantidad, 0);
    total = totalProductos + (ticketState.costoEnvio || 0);

    cont.innerHTML =
      items
        .map((it) => {
          const detalle = it.opciones_seleccionadas.map((o) => o.nombre).join(', ');
          return `
        <div class="ticket-item">
          <div class="ticket-item-top">
            <span>${it.cantidad}x ${it.nombre}${detalle ? `<br><small>${detalle}</small>` : ''}</span>
            <span>$${(it.precio * it.cantidad).toFixed(2)}<button data-clave="${it._clave}">×</button></span>
          </div>
        </div>`;
        })
        .join('') || '<p style="color:#999;font-size:13px;text-align:center;margin-top:20px">Agrega productos del menú</p>';

    cont.querySelectorAll('button[data-clave]').forEach((btn) => {
      btn.addEventListener('click', () => quitarDelCarritoTicket(btn.dataset.clave));
    });
  } else {
    const itemsActivos = ticketState.pedidoData.items.filter((it) => !it.cancelado);
    total = Number(ticketState.pedidoData.total);

    cont.innerHTML =
      itemsActivos
        .map((it) => {
          const detalle = (it.opciones_seleccionadas || []).map((o) => o.nombre).join(', ');
          return `
        <div class="ticket-item">
          <div class="ticket-item-top">
            <span>${it.cantidad}x ${it.producto_nombre}${detalle ? `<br><small>${detalle}</small>` : ''}</span>
            <span>$${(it.cantidad * it.precio_unitario).toFixed(2)}${
              ticketState.soloLectura ? '' : `<button data-item-id="${it.id}">×</button>`
            }</span>
          </div>
        </div>`;
        })
        .join('') || '<p style="color:#999;font-size:13px;text-align:center;margin-top:20px">Sin productos</p>';

    cont.querySelectorAll('button[data-item-id]').forEach((btn) => {
      btn.addEventListener('click', () => cancelarItemEditar(Number(btn.dataset.itemId)));
    });
  }

  document.getElementById('ticket-total').textContent = `$${total.toFixed(2)}`;
}

// ---------- Botones Aceptar / Pago ----------

document.getElementById('btn-t-aceptar').addEventListener('click', async () => {
  const pedido = await crearPedidoDesdeTicket();
  if (pedido) {
    ticketState = null;
    document.getElementById('overlay-pedido').classList.remove('abierto');
    cargarPedidosYContar();
  }
});

document.getElementById('btn-t-pago').addEventListener('click', async () => {
  if (ticketState.modo === 'nuevo') {
    const pedido = await crearPedidoDesdeTicket();
    if (pedido) {
      document.getElementById('overlay-pedido').classList.remove('abierto');
      abrirModalCobroDirecto(pedido);
    }
  } else {
    document.getElementById('overlay-pedido').classList.remove('abierto');
    abrirModalCobroDirecto(ticketState.pedidoData);
  }
});

async function crearPedidoDesdeTicket() {
  const statusEl = document.getElementById('ticket-status');
  const nombre = document.getElementById('ticket-cliente-nombre').value.trim();
  if (!nombre) {
    statusEl.textContent = '⚠️ El nombre del cliente es obligatorio.';
    return null;
  }
  if (!ticketState.carrito.length) {
    statusEl.textContent = '⚠️ Agrega al menos un producto.';
    return null;
  }

  const sucursal_id = Number(document.getElementById('sucursal-select').value);
  const telefono = document.getElementById('ticket-cliente-telefono').value.trim();
  const direccion = document.getElementById('ticket-cliente-direccion').value.trim();
  const colonia = document.getElementById('ticket-cliente-colonia').value;

  let cliente_id = null;
  if (telefono) {
    const cliente = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, telefono, direccion, colonia }),
    }).then((r) => r.json());
    cliente_id = cliente.id;
  }

  const items = ticketState.carrito.map((it) => ({
    producto_id: it.producto_id,
    cantidad: it.cantidad,
    precio_unitario: it.precio,
    opciones_seleccionadas: it.opciones_seleccionadas,
  }));

  statusEl.textContent = 'Enviando...';
  const resp = await fetch('/api/pedidos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sucursal_id,
      cliente_id,
      cliente_nombre: nombre,
      tipo: ticketState.tipo,
      items,
      costo_envio: ticketState.costoEnvio || 0,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    statusEl.textContent = '❌ ' + (err.error || 'No se pudo enviar el pedido');
    return null;
  }
  return resp.json();
}

// ==================== MODAL DE MODIFICADORES ====================

document.getElementById('btn-mostrar-productos').addEventListener('click', () => {
  document.querySelector('.overlay-body').classList.add('vista-productos');
});
document.getElementById('btn-volver-ticket').addEventListener('click', () => {
  document.querySelector('.overlay-body').classList.remove('vista-productos');
});

function abrirModalModificadores(producto, grupos, onAgregar) {
  onAgregar =
    onAgregar ||
    function (item) {
      agregarAlCarritoTicket(item);
    };

  const seleccion = {};
  grupos.forEach((g) => {
    seleccion[g.id] = g.tipo === 'extra' ? [] : g.obligatorio ? g.opciones[0] : null;
  });
  let cantidad = 1;

  function calcularPrecio() {
    let precio = Number(producto.precio);
    grupos.forEach((g) => {
      if (g.tipo === 'variante' && seleccion[g.id]) precio = Number(seleccion[g.id].precio);
      if (g.tipo === 'extra') seleccion[g.id].forEach((op) => { precio += Number(op.precio); });
    });
    return precio;
  }

  function render() {
    const precioUnit = calcularPrecio();
    const html = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-box">
          <h3>${producto.nombre}</h3>
          ${grupos
            .map(
              (g) => `
            <div class="modal-grupo">
              <div class="modal-grupo-titulo">${g.nombre}${g.tipo === 'variante' ? ' (elige uno)' : ' (opcional)'}</div>
              ${g.opciones
                .map((op) => {
                  const isSelected =
                    g.tipo === 'variante' ? seleccion[g.id] && seleccion[g.id].id === op.id : seleccion[g.id].some((s) => s.id === op.id);
                  return `
                  <div class="modal-opcion ${isSelected ? 'selected' : ''}" data-grupo="${g.id}" data-opcion="${op.id}">
                    <span>${op.nombre}</span>
                    <span class="precio">${g.tipo === 'extra' ? '+' : ''}$${Number(op.precio).toFixed(2)}</span>
                  </div>`;
                })
                .join('')}
            </div>`
            )
            .join('')}
          <div class="modal-cantidad">
            <button id="modal-menos">−</button>
            <span id="modal-cant" style="font-size:18px;min-width:24px;text-align:center">${cantidad}</span>
            <button id="modal-mas">+</button>
          </div>
          <div class="modal-botones">
            <button class="btn-cancelar" id="modal-cancelar">Cancelar</button>
            <button class="btn-agregar" id="modal-agregar">Agregar · $${(precioUnit * cantidad).toFixed(2)}</button>
          </div>
        </div>
      </div>`;
    document.getElementById('modal-container').innerHTML = html;

    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') cerrar();
    });
    document.getElementById('modal-cancelar').addEventListener('click', cerrar);
    document.getElementById('modal-menos').addEventListener('click', () => {
      if (cantidad > 1) cantidad -= 1;
      render();
    });
    document.getElementById('modal-mas').addEventListener('click', () => {
      cantidad += 1;
      render();
    });
    document.querySelectorAll('.modal-opcion').forEach((el) => {
      el.addEventListener('click', () => {
        const grupoId = Number(el.dataset.grupo);
        const opcionId = Number(el.dataset.opcion);
        const grupo = grupos.find((g) => g.id === grupoId);
        const opcion = grupo.opciones.find((o) => o.id === opcionId);
        if (grupo.tipo === 'variante') {
          seleccion[grupoId] = opcion;
        } else {
          const arr = seleccion[grupoId];
          const idx = arr.findIndex((o) => o.id === opcionId);
          if (idx >= 0) arr.splice(idx, 1);
          else arr.push(opcion);
        }
        render();
      });
    });
    document.getElementById('modal-agregar').addEventListener('click', () => {
      const opcionesElegidas = [];
      grupos.forEach((g) => {
        if (g.tipo === 'variante' && seleccion[g.id]) {
          opcionesElegidas.push({ grupo: g.nombre, nombre: seleccion[g.id].nombre, precio: Number(seleccion[g.id].precio), tipo: 'variante' });
        }
        if (g.tipo === 'extra') {
          seleccion[g.id].forEach((op) => {
            opcionesElegidas.push({ grupo: g.nombre, nombre: op.nombre, precio: Number(op.precio), tipo: 'extra' });
          });
        }
      });
      onAgregar({
        producto_id: producto.id,
        nombre: producto.nombre,
        precio: calcularPrecio(),
        cantidad,
        opciones_seleccionadas: opcionesElegidas,
      });
    });
  }

  function cerrar() {
    document.getElementById('modal-container').innerHTML = '';
  }

  render();
}

// ==================== MODAL DE COBRO (dividir pagos + cambio) ====================

let pagosEnCurso = [];
let pedidoEnCobro = null;

function abrirModalCobroDirecto(pedido, esCambio) {
  pedidoEnCobro = pedido;
  if (esCambio && pedido.pagos && pedido.pagos.length) {
    pagosEnCurso = pedido.pagos.map((p) => ({ metodo: p.metodo, monto: Number(p.monto).toFixed(2) }));
  } else {
    pagosEnCurso = [{ metodo: 'efectivo', monto: Number(pedido.total).toFixed(2) }];
  }
  renderModalCobro();
}

function renderModalCobro() {
  const activeEl = document.activeElement;
  let focoGuardado = null;
  if (activeEl && activeEl.dataset && activeEl.dataset.idx !== undefined && activeEl.classList.contains('pago-monto')) {
    focoGuardado = { idx: activeEl.dataset.idx, inicio: activeEl.selectionStart, fin: activeEl.selectionEnd };
  }

  const total = Number(pedidoEnCobro.total);

  let restanteAcumulado = total;
  const filasCalculadas = pagosEnCurso.map((p) => {
    const entrada = Number(p.monto) || 0;
    const aplicado = Math.min(entrada, Math.max(restanteAcumulado, 0));
    const cambio = p.metodo === 'efectivo' ? Number((entrada - aplicado).toFixed(2)) : 0;
    restanteAcumulado = Number((restanteAcumulado - aplicado).toFixed(2));
    return { ...p, aplicado, cambio };
  });

  const asignado = filasCalculadas.reduce((sum, f) => sum + f.aplicado, 0);
  const restante = Number((total - asignado).toFixed(2));
  const completo = Math.abs(restante) < 0.01;

  const filas = filasCalculadas
    .map(
      (p, i) => `
    <div style="border:1px solid #ddd;border-radius:8px;padding:10px;margin-bottom:8px">
      <div style="display:flex;gap:8px;margin-bottom:4px">
        <select data-idx="${i}" class="pago-metodo" style="flex:1;padding:8px;border-radius:6px;border:1px solid #ddd">
          <option value="efectivo" ${p.metodo === 'efectivo' ? 'selected' : ''}>💵 Efectivo</option>
          <option value="tarjeta" ${p.metodo === 'tarjeta' ? 'selected' : ''}>💳 Tarjeta</option>
          <option value="transferencia" ${p.metodo === 'transferencia' ? 'selected' : ''}>📱 Transferencia</option>
        </select>
        <input type="text" inputmode="decimal" data-idx="${i}" class="pago-monto" value="${p.monto}" style="width:110px;padding:8px;border-radius:6px;border:1px solid #ddd" />
        ${pagosEnCurso.length > 1 ? `<button data-idx="${i}" class="pago-quitar" style="border:none;background:none;color:#b8232f;font-size:18px">×</button>` : ''}
      </div>
      <div style="font-size:12px;color:#888">${p.metodo === 'efectivo' ? '¿Cuánto te dio el cliente?' : 'Monto a cobrar por este método'}</div>
      ${p.cambio > 0 ? `<div style="text-align:right;margin-top:4px;font-weight:bold;color:#1a7d3a">Cambio a dar: $${p.cambio.toFixed(2)}</div>` : ''}
    </div>`
    )
    .join('');

  const html = `
    <div class="modal-overlay" id="modal-overlay-cobro">
      <div class="modal-box">
        <h3>Cobrar pedido #${pedidoEnCobro.id}</h3>
        <div class="total-modal">Total: $${total.toFixed(2)}</div>
        ${filas}
        <button id="btn-dividir" class="btn-cancelar-modal" style="border:1px dashed #ccc;border-radius:8px;color:#555;margin-bottom:10px">+ Dividir con otro método</button>
        <div style="text-align:right;font-size:14px;margin-bottom:12px;color:${completo ? '#1a7d3a' : '#b8232f'}">
          ${completo ? '✅ Cubre el total' : `Faltan $${restante.toFixed(2)}`}
        </div>
        <button class="btn-agregar" id="btn-confirmar-cobro" style="width:100%;padding:14px;border-radius:8px;border:none;font-weight:bold" ${!completo ? 'disabled' : ''}>
          Confirmar cobro
        </button>
        <button class="btn-cancelar-modal" id="modal-cancelar-cobro">Cancelar</button>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;

  document.getElementById('modal-overlay-cobro').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay-cobro') cerrarModalCobro();
  });
  document.getElementById('modal-cancelar-cobro').addEventListener('click', cerrarModalCobro);

  document.querySelectorAll('.pago-metodo').forEach((el) => {
    el.addEventListener('change', () => {
      pagosEnCurso[Number(el.dataset.idx)].metodo = el.value;
      renderModalCobro();
    });
  });
  document.querySelectorAll('.pago-monto').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
      pagosEnCurso[Number(el.dataset.idx)].monto = el.value;
      renderModalCobro();
    });
  });
  document.querySelectorAll('.pago-quitar').forEach((el) => {
    el.addEventListener('click', () => {
      pagosEnCurso.splice(Number(el.dataset.idx), 1);
      renderModalCobro();
    });
  });
  const btnDividir = document.getElementById('btn-dividir');
  if (btnDividir) {
    btnDividir.addEventListener('click', () => {
      const restanteParaNuevaFila = Number((total - asignado).toFixed(2));
      pagosEnCurso.push({ metodo: 'tarjeta', monto: restanteParaNuevaFila > 0 ? restanteParaNuevaFila.toFixed(2) : '0.00' });
      renderModalCobro();
    });
  }
  const btnConfirmar = document.getElementById('btn-confirmar-cobro');
  if (btnConfirmar && !btnConfirmar.disabled) {
    btnConfirmar.addEventListener('click', () => confirmarCobro(filasCalculadas));
  }

  if (focoGuardado) {
    const el = document.querySelector(`.pago-monto[data-idx="${focoGuardado.idx}"]`);
    if (el) {
      el.focus();
      el.setSelectionRange(focoGuardado.inicio, focoGuardado.fin);
    }
  }
}

function cerrarModalCobro() {
  document.getElementById('modal-container').innerHTML = '';
  pedidoEnCobro = null;
  pagosEnCurso = [];
}

async function confirmarCobro(filasCalculadas) {
  const pagos = filasCalculadas.map((p) => ({
    metodo: p.metodo,
    monto: p.aplicado,
    recibido: p.metodo === 'efectivo' ? Number(p.monto) || 0 : null,
  }));

  const btn = document.getElementById('btn-confirmar-cobro');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const resp = await fetch(`/api/pedidos/${pedidoEnCobro.id}/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pagos }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      alert('No se pudo registrar el cobro: ' + (err.error || 'error desconocido'));
      btn.disabled = false;
      btn.textContent = 'Confirmar cobro';
      return;
    }
    cerrarModalCobro();
    cargarPedidosYContar();
    if (document.getElementById('overlay-historial').classList.contains('abierto')) cargarHistorial();
  } catch (err) {
    alert('No se pudo registrar el cobro, revisa tu conexión.');
    btn.disabled = false;
    btn.textContent = 'Confirmar cobro';
  }
}

// ==================== MENÚ LATERAL (Corte / Envíos) ====================

document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('drawer-overlay').classList.add('abierto'));
document.getElementById('drawer-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'drawer-overlay') document.getElementById('drawer-overlay').classList.remove('abierto');
});
document.getElementById('btn-abrir-historial').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-historial').classList.add('abierto');
  cargarHistorial();
});
document.getElementById('btn-abrir-corte').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-corte').classList.add('abierto');
  cargarCorte();
});
document.getElementById('btn-abrir-envios').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-envios').classList.add('abierto');
  cargarEnvios();
});
document.getElementById('btn-cerrar-historial').addEventListener('click', () => document.getElementById('overlay-historial').classList.remove('abierto'));
document.getElementById('btn-cerrar-corte').addEventListener('click', () => document.getElementById('overlay-corte').classList.remove('abierto'));
document.getElementById('btn-cerrar-envios').addEventListener('click', () => document.getElementById('overlay-envios').classList.remove('abierto'));

// ==================== CORTE DE CAJA ====================

document.getElementById('corte-fecha').value = fechaNegocioActual();
document.getElementById('btn-cargar-corte').addEventListener('click', cargarCorte);
document.getElementById('btn-agregar-gasto').addEventListener('click', agregarGasto);
document.getElementById('gasto-monto').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^0-9.]/g, '');
});

let corteActual = null;
let corteCerradoActual = null;

async function cargarCorte() {
  const sucursalId = document.getElementById('sucursal-select').value;
  const fecha = document.getElementById('corte-fecha').value;
  if (!fecha) return;

  corteActual = await fetch(`/api/corte?sucursal_id=${sucursalId}&fecha=${fecha}`).then((r) => r.json());
  corteCerradoActual = await fetch(`/api/corte/cerrado?sucursal_id=${sucursalId}&fecha=${fecha}`).then((r) => r.json());

  document.getElementById('corte-tabla-body').innerHTML = corteActual.resumen
    .map(
      (r) => `
      <tr>
        <td>${METODO_LABELS[r.metodo]}</td>
        <td class="num">$${r.ventas.toFixed(2)}</td>
        <td class="num">$${r.gastos.toFixed(2)}</td>
        <td class="num"><strong>$${r.neto.toFixed(2)}</strong></td>
      </tr>`
    )
    .join('');

  document.getElementById('corte-pedidos-cobrados').textContent = `Pedidos cobrados: ${corteActual.pedidosCobrados}`;
  document.getElementById('corte-total-envios').textContent = `$${corteActual.totalEnvios.toFixed(2)}`;
  document.getElementById('corte-total-neto').textContent = `$${corteActual.totalNeto.toFixed(2)}`;

  const banner = document.getElementById('corte-cerrado-banner');
  const formGasto = document.getElementById('btn-agregar-gasto').closest('.form-inline');
  if (corteCerradoActual) {
    const hora = new Date(corteCerradoActual.cerrado_en).toLocaleString('es-MX');
    banner.style.display = 'block';
    banner.textContent = `✅ Corte cerrado el ${hora}. Diferencia total: $${Number(corteCerradoActual.diferencia).toFixed(2)}`;
    formGasto.style.display = 'none';
  } else {
    banner.style.display = 'none';
    formGasto.style.display = 'flex';
  }

  const gastos = await fetch(`/api/gastos?sucursal_id=${sucursalId}&fecha=${fecha}`).then((r) => r.json());
  document.getElementById('gastos-tabla-body').innerHTML =
    gastos
      .map(
        (g) => `
      <tr>
        <td>${g.descripcion}</td>
        <td>${METODO_LABELS[g.metodo_pago]}</td>
        <td class="num">$${Number(g.monto).toFixed(2)}</td>
        <td>${corteCerradoActual ? '' : `<button class="btn-eliminar-fila" data-id="${g.id}">🗑️</button>`}</td>
      </tr>`
      )
      .join('') || '<tr><td colspan="4" style="text-align:center;color:#999">Sin gastos ese día</td></tr>';

  document.querySelectorAll('#gastos-tabla-body .btn-eliminar-fila').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/gastos/${btn.dataset.id}`, { method: 'DELETE' });
      cargarCorte();
    });
  });

  renderCuadreCaja();
}

async function agregarGasto() {
  const sucursal_id = document.getElementById('sucursal-select').value;
  const descripcion = document.getElementById('gasto-descripcion').value.trim();
  const monto = document.getElementById('gasto-monto').value;
  const metodo_pago = document.getElementById('gasto-metodo').value;
  if (!descripcion || !monto) {
    alert('Falta la descripción o el monto del gasto');
    return;
  }
  await fetch('/api/gastos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sucursal_id, descripcion, monto, metodo_pago }),
  });
  document.getElementById('gasto-descripcion').value = '';
  document.getElementById('gasto-monto').value = '';
  cargarCorte();
}

function renderCuadreCaja() {
  const cont = document.getElementById('cuadre-caja');

  if (corteCerradoActual) {
    const filas = corteCerradoActual.resumen
      .map(
        (r) => `
      <tr>
        <td>${METODO_LABELS[r.metodo]}</td>
        <td class="num">$${Number(r.neto).toFixed(2)}</td>
        <td class="num">$${Number(r.contado).toFixed(2)}</td>
        <td class="num" style="color:${Math.abs(r.diferencia) < 0.01 ? '#1a7d3a' : '#b8232f'}">$${Number(r.diferencia).toFixed(2)}</td>
      </tr>`
      )
      .join('');
    cont.innerHTML = `
      <table class="tabla-simple">
        <thead><tr><th>Método</th><th class="num">Debía haber</th><th class="num">Contado</th><th class="num">Diferencia</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>`;
    return;
  }

  cont.innerHTML = `
    <table class="tabla-simple">
      <thead><tr><th>Método</th><th class="num">Debe haber</th><th class="num">Contado</th></tr></thead>
      <tbody>
        ${corteActual.resumen
          .map(
            (r) => `
          <tr>
            <td>${METODO_LABELS[r.metodo]}</td>
            <td class="num">$${r.neto.toFixed(2)}</td>
            <td class="num"><input type="text" inputmode="decimal" class="input-contado" data-metodo="${r.metodo}" placeholder="0.00" style="width:90px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
    <button id="btn-cerrar-corte-accion" class="btn-nuevo-pedido" style="margin:0 12px 16px;width:calc(100% - 24px);background:#1a7d3a">Cerrar corte</button>`;

  document.querySelectorAll('.input-contado').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
    });
  });
  document.getElementById('btn-cerrar-corte-accion').addEventListener('click', cerrarCorte);
}

async function cerrarCorte() {
  const sucursal_id = document.getElementById('sucursal-select').value;
  const fecha = document.getElementById('corte-fecha').value;
  const contado = {};
  document.querySelectorAll('.input-contado').forEach((el) => {
    contado[el.dataset.metodo] = Number(el.value) || 0;
  });

  if (!confirm('¿Cerrar el corte del día? Ya no vas a poder registrar más gastos para esta fecha.')) return;

  const btn = document.getElementById('btn-cerrar-corte-accion');
  btn.disabled = true;
  btn.textContent = 'Cerrando...';

  await fetch('/api/corte/cerrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sucursal_id, fecha, contado }),
  });

  cargarCorte();
}

// ==================== ENVÍOS POR COLONIA ====================

document.getElementById('btn-agregar-envio').addEventListener('click', agregarEnvio);
document.getElementById('envio-costo').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^0-9.]/g, '');
});

async function cargarEnvios() {
  const sucursalId = document.getElementById('sucursal-select').value;
  state.envios = await fetch(`/api/envios?sucursal_id=${sucursalId}`).then((r) => r.json());
  renderEnvios();
}

function renderEnvios() {
  document.getElementById('envios-tabla-body').innerHTML =
    state.envios
      .map(
        (e) => `
      <tr>
        <td>${e.colonia}</td>
        <td class="num">$${Number(e.costo).toFixed(2)}</td>
        <td><button class="btn-eliminar-fila" data-id="${e.id}">🗑️</button></td>
      </tr>`
      )
      .join('') || '<tr><td colspan="3" style="text-align:center;color:#999">Sin colonias registradas</td></tr>';

  document.querySelectorAll('#envios-tabla-body .btn-eliminar-fila').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/envios/${btn.dataset.id}`, { method: 'DELETE' });
      cargarEnvios();
    });
  });
}

async function agregarEnvio() {
  const sucursal_id = document.getElementById('sucursal-select').value;
  const colonia = document.getElementById('envio-colonia').value.trim();
  const costo = document.getElementById('envio-costo').value;
  if (!colonia || !costo) {
    alert('Falta la colonia o el costo');
    return;
  }
  await fetch('/api/envios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sucursal_id, colonia, costo }),
  });
  document.getElementById('envio-colonia').value = '';
  document.getElementById('envio-costo').value = '';
  cargarEnvios();
}

cargarInicial();

// ==================== HISTORIAL DE PEDIDOS ====================

let filtroHistorial = 'todos';

document.getElementById('historial-fecha-desde').value = fechaNegocioActual();
document.getElementById('historial-fecha-hasta').value = fechaNegocioActual();
document.getElementById('btn-buscar-historial').addEventListener('click', cargarHistorial);

document.querySelectorAll('[data-filtro-hist]').forEach((btn) => {
  btn.addEventListener('click', () => {
    filtroHistorial = btn.dataset.filtroHist;
    document.querySelectorAll('[data-filtro-hist]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    cargarHistorial();
  });
});

async function cargarHistorial() {
  const sucursalId = document.getElementById('sucursal-select').value;
  const desde = document.getElementById('historial-fecha-desde').value;
  const hasta = document.getElementById('historial-fecha-hasta').value;

  let url = `/api/pedidos?sucursal_id=${sucursalId}`;
  if (desde) url += `&fecha_desde=${desde}`;
  if (hasta) url += `&fecha_hasta=${hasta}`;
  if (filtroHistorial === 'pendientes') url += '&pagado=false&cancelado=false';
  if (filtroHistorial === 'cobrados') url += '&pagado=true&cancelado=false';
  if (filtroHistorial === 'cancelados') url += '&cancelado=true';

  const pedidos = await fetch(url).then((r) => r.json());

  const cont = document.getElementById('lista-historial');
  const sinHistorial = document.getElementById('sin-historial');
  if (!pedidos.length) {
    cont.innerHTML = '';
    sinHistorial.style.display = 'block';
    return;
  }
  sinHistorial.style.display = 'none';
  cont.innerHTML = pedidos.map((p) => renderPedidoRow(p)).join('');
  cont.querySelectorAll('.pedido-row').forEach((el) => {
    el.addEventListener('click', () => abrirOverlayEditar(Number(el.dataset.id)));
  });
}
