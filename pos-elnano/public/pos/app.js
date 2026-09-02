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

function normalizarSlug(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function cargarInicial() {
  state.empleado = await fetch('/api/me').then((r) => (r.ok ? r.json() : null));
  aplicarPermisosUI();

  state.sucursales = await fetch('/api/sucursales').then((r) => r.json());
  state.categorias = await fetch('/api/categorias').then((r) => r.json());
  state.productos = await fetch('/api/productos').then((r) => r.json());

  const select = document.getElementById('sucursal-select');
  select.innerHTML = state.sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');

  // Elige la sucursal en este orden de prioridad:
  // 1) La que venga en el link (ej. /pos?sucursal=santa-maria)
  // 2) La última que se usó en este dispositivo (para no resetear a la primera al recargar)
  // 3) La primera de la lista, como respaldo
  const params = new URLSearchParams(window.location.search);
  const sucursalParam = params.get('sucursal');
  let sucursalElegida = null;

  if (sucursalParam) {
    sucursalElegida = state.sucursales.find(
      (s) => normalizarSlug(s.nombre) === sucursalParam.toLowerCase() || String(s.id) === sucursalParam
    );
  }
  if (!sucursalElegida) {
    const guardada = localStorage.getItem('elnano_sucursal_id');
    if (guardada) sucursalElegida = state.sucursales.find((s) => String(s.id) === guardada);
  }
  if (sucursalElegida) select.value = sucursalElegida.id;

  // Si el empleado tiene una sola sucursal asignada, se ignora cualquier otra elección
  // y se bloquea el selector para que no pueda cambiarse a la otra sucursal.
  if (state.empleado?.sucursal_id) {
    select.value = state.empleado.sucursal_id;
    select.disabled = true;
    select.title = 'Tu acceso está limitado a esta sucursal';
  }

  localStorage.setItem('elnano_sucursal_id', select.value);

  select.addEventListener('change', async () => {
    localStorage.setItem('elnano_sucursal_id', select.value);
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

  const pendientes = await fetch(`/api/pedidos?sucursal_id=${sucursalId}&pendiente=true`).then((r) => r.json());
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

  registrarPedidosEnCache(pedidos);

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
  conectarBotonesWhatsApp(cont);
}

const ESTADO_COCINA_LABEL = { recibido: '🟡 Recibido', en_preparacion: '🔵 En preparación', listo: '🟢 Listo', entregado: '✅ Entregado' };

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
  const badgeCocina = !pedido.cancelado
    ? `<span class="badge" style="background:#eee;color:#555">${ESTADO_COCINA_LABEL[pedido.estado] || pedido.estado}</span>`
    : '';

  return `
    <div class="pedido-row" data-id="${pedido.id}">
      <div class="pedido-row-top">
        <span class="pedido-row-id">#${pedido.numero_dia ?? pedido.id} <span class="badge badge-${pedido.tipo}">${tipoLabel}</span>${pedido.origen === 'web' ? ' <span class="badge" style="background:#e0f2ff;color:#0056b3">🌐 En línea</span>' : ''}</span>
        <span class="pedido-row-hora">${fechaCorta} · ${hora}</span>
      </div>
      <div class="pedido-row-cliente">
        👤 ${pedido.cliente_nombre || ''}
        ${pedido.cliente_telefono ? `<button class="btn-whatsapp-row" data-id="${pedido.id}" style="background:#25D366;color:white;border:none;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:bold;cursor:pointer;margin-left:6px">📱 WhatsApp</button>` : ''}
      </div>
      ${
        pedido.cliente_direccion
          ? `<div style="font-size:12px;color:#666;margin-bottom:4px">📍 ${pedido.cliente_direccion}${pedido.cliente_colonia ? ', ' + pedido.cliente_colonia : ''}</div>`
          : ''
      }
      <div class="pedido-row-items">${itemsTexto}</div>
      <div class="pedido-row-bottom">
        <span class="pedido-row-total">$${Number(pedido.total).toFixed(2)}</span>
        <span>${badgeCocina} ${badgeEstado}</span>
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
  const desde = document.getElementById('historial-fecha-desde').value || fechaNegocioActual();
  const hasta = document.getElementById('historial-fecha-hasta').value || desde;
  const corte = await fetch(`/api/corte?sucursal_id=${sucursalId}&fecha=${desde}&fecha_hasta=${hasta}`).then((r) => r.json());

  const tituloEl = document.querySelector('#resumen-toggle span:first-child');
  tituloEl.textContent = desde === hasta ? `📊 Resumen de caja — ${desde}` : `📊 Resumen de caja — ${desde} a ${hasta}`;

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
  ocultarBotonesRestringidosDelTicket();
}

async function abrirOverlayEditar(pedidoId) {
  const pedido = await fetch(`/api/pedidos/${pedidoId}`).then((r) => r.json());
  ticketState = { modo: 'editar', tipo: pedido.tipo, pedidoId: pedido.id, pedidoData: pedido, soloLectura: pedido.cancelado || pedido.finalizado };
  let sufijoTitulo = '';
  if (pedido.finalizado) sufijoTitulo = ' — finalizado';
  else if (pedido.pagado) sufijoTitulo = ' — cobrado';
  document.getElementById('overlay-titulo').textContent = `Pedido #${pedido.numero_dia ?? pedido.id}${sufijoTitulo}`;
  document.querySelector('.overlay-body').classList.remove('vista-productos');
  prepararCamposCliente();
  document.getElementById('ticket-cliente-nombre').value = pedido.cliente_nombre || '';
  document.getElementById('ticket-cliente-nombre').disabled = true;
  document.getElementById('ticket-cliente-telefono').value = pedido.cliente_telefono || '';
  document.getElementById('ticket-cliente-telefono').disabled = true;

  const direccionEl = document.getElementById('ticket-direccion-display');
  if (pedido.cliente_direccion || pedido.cliente_colonia) {
    direccionEl.textContent = `📍 ${pedido.cliente_direccion || ''}${pedido.cliente_colonia ? ', ' + pedido.cliente_colonia : ''}`;
    direccionEl.style.display = 'block';
  } else {
    direccionEl.style.display = 'none';
  }

  mostrarControlesTicket(!ticketState.soloLectura);
  document.getElementById('btn-mostrar-productos').style.display = ticketState.soloLectura ? 'none' : '';
  document.getElementById('btn-t-cancelar').textContent = 'Cerrar';
  document.getElementById('btn-t-aceptar').style.display = 'none';
  document.getElementById('btn-t-pago').style.display = ticketState.soloLectura ? 'none' : 'block';

  const bannerCancelado = document.getElementById('ticket-cancelado-banner');
  const accionesExtra = document.getElementById('ticket-acciones-extra');
  const btnCambiarMetodo = document.getElementById('btn-cambiar-metodo');
  const btnCancelarCompleto = document.getElementById('btn-cancelar-pedido-completo');
  const btnWhatsapp = document.getElementById('btn-whatsapp-ticket');

  bannerCancelado.style.display = pedido.cancelado ? 'block' : 'none';
  accionesExtra.style.display = pedido.cancelado ? 'none' : 'flex';
  btnCambiarMetodo.style.display = pedido.pagado && !pedido.cancelado ? 'block' : 'none';
  btnCancelarCompleto.style.display = pedido.cancelado ? 'none' : 'block';
  btnWhatsapp.style.display = pedido.cliente_telefono && !pedido.cancelado ? 'block' : 'none';
  btnWhatsapp.onclick = () => abrirWhatsAppCliente(pedido);

  const btnPedirResena = document.getElementById('btn-pedir-resena');
  btnPedirResena.style.display = pedido.cliente_telefono && pedido.pagado && !pedido.cancelado ? 'block' : 'none';
  btnPedirResena.onclick = () => pedirResena(pedido);

  const btnFinalizar = document.getElementById('btn-finalizar-pedido');
  btnFinalizar.style.display = !ticketState.soloLectura ? 'block' : 'none';
  btnFinalizar.onclick = () => finalizarPedido(pedido);

  if (pedido.cancelado) {
    document.getElementById('btn-t-pago').style.display = 'none';
  }

  state.categoriaActivaOverlay = state.categorias[0]?.id ?? null;
  renderCatSidebarOverlay();
  renderProductosOverlay();
  renderTicketPanel();
  document.getElementById('overlay-pedido').classList.add('abierto');
  ocultarBotonesRestringidosDelTicket();
}

document.getElementById('btn-cancelar-pedido-completo').addEventListener('click', async () => {
  if (!confirm(`¿Cancelar el pedido #${ticketState.pedidoData.numero_dia ?? ticketState.pedidoId} por completo? No se puede deshacer.`)) return;
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
  document.getElementById('ticket-cliente-encontrado').style.display = 'none';
  document.getElementById('ticket-direccion-display').style.display = 'none';

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
  const tabTodos = `
    <div class="cat-sidebar-item ${state.categoriaActivaOverlay === 'todos' ? 'active' : ''}" data-id="todos">
      <div>🍴</div>
      <div>Todos</div>
    </div>`;
  cont.innerHTML =
    tabTodos +
    state.categorias
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
      state.categoriaActivaOverlay = el.dataset.id === 'todos' ? 'todos' : Number(el.dataset.id);
      document.getElementById('buscador-producto').value = '';
      renderCatSidebarOverlay();
      renderProductosOverlay();
    });
  });
}

document.getElementById('buscador-producto').addEventListener('input', renderProductosOverlay);

function visualProductoTile(producto, categoriaNombre) {
  if (producto.imagen) {
    return `<img src="${producto.imagen}" style="width:100%;height:56px;object-fit:cover;border-radius:8px;margin-bottom:6px" />`;
  }
  return `<div class="emoji">${CATEGORIA_EMOJI[categoriaNombre] || '🍴'}</div>`;
}

function renderProductosOverlay() {
  const cont = document.getElementById('productos-grid-overlay');
  const busqueda = document.getElementById('buscador-producto').value.trim().toLowerCase();

  const lista = busqueda
    ? state.productos.filter((p) => p.nombre.toLowerCase().includes(busqueda))
    : state.categoriaActivaOverlay === 'todos'
    ? state.productos
    : state.productos.filter((p) => p.categoria_id === state.categoriaActivaOverlay);

  const categoriaPorId = {};
  state.categorias.forEach((c) => (categoriaPorId[c.id] = c.nombre));

  cont.innerHTML = lista
    .map(
      (p) => `
      <div class="prod-tile" data-id="${p.id}">
        ${visualProductoTile(p, categoriaPorId[p.categoria_id])}
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

async function refrescarPedidoEditando() {
  ticketState.pedidoData = await fetch(`/api/pedidos/${ticketState.pedidoId}`).then((r) => r.json());
}

// ---------- Panel del ticket (común a ambos modos) ----------

function renderTicketPanel() {
  const cont = document.getElementById('ticket-items');
  let items, total, subtotalProductos, envio;

  if (ticketState.modo === 'nuevo') {
    items = ticketState.carrito;
    subtotalProductos = items.reduce((sum, it) => sum + it.precio * it.cantidad, 0);
    envio = ticketState.costoEnvio || 0;
    total = subtotalProductos + envio;

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
    subtotalProductos = itemsActivos.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0);
    envio = Number(ticketState.pedidoData.costo_envio) || 0;

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

  const descuentoLealtad = ticketState.modo === 'editar' ? Number(ticketState.pedidoData.descuento_lealtad) || 0 : 0;

  document.getElementById('ticket-desglose').innerHTML = `
    <div style="display:flex;justify-content:space-between">
      <span>Subtotal productos</span><span>$${subtotalProductos.toFixed(2)}</span>
    </div>
    ${
      envio > 0
        ? `<div style="display:flex;justify-content:space-between;color:#1a7d3a">
            <span>🛵 Costo de envío</span><span>$${envio.toFixed(2)}</span>
          </div>`
        : ''
    }
    ${
      descuentoLealtad > 0
        ? `<div style="display:flex;justify-content:space-between;color:#a97800">
            <span>🎁 Descuento por puntos</span><span>−$${descuentoLealtad.toFixed(2)}</span>
          </div>`
        : ''
    }`;
  document.getElementById('ticket-total').textContent = `$${total.toFixed(2)}`;
  actualizarZonaLealtad();
}

// ---------- Lealtad: mostrar puntos y canjear ----------

let recompensasDisponiblesCache = null;

function actualizarZonaLealtad() {
  const cont = document.getElementById('ticket-lealtad-info');
  const btnCanjear = document.getElementById('btn-canjear-lealtad');
  const btnQuitar = document.getElementById('btn-quitar-canje');

  if (ticketState.modo !== 'editar' || !ticketState.pedidoData.cliente_id || ticketState.soloLectura) {
    cont.style.display = 'none';
    return;
  }

  const pedido = ticketState.pedidoData;
  const puntos = Number(pedido.cliente_puntos) || 0;
  const tieneCanje = Number(pedido.descuento_lealtad) > 0;

  cont.style.display = 'block';
  document.getElementById('ticket-lealtad-texto').innerHTML = tieneCanje
    ? `🎁 Este pedido ya tiene un canje aplicado (−$${Number(pedido.descuento_lealtad).toFixed(2)}). El cliente tiene ${puntos} punto(s) restantes.`
    : `⭐ Este cliente tiene <strong>${puntos} punto(s)</strong> acumulados.`;

  btnCanjear.style.display = tieneCanje ? 'none' : 'block';
  btnQuitar.style.display = tieneCanje ? 'block' : 'none';
  ocultarBotonesRestringidosDelTicket();
}

document.getElementById('btn-canjear-lealtad').addEventListener('click', async () => {
  if (!recompensasDisponiblesCache) {
    recompensasDisponiblesCache = await fetch('/api/recompensas').then((r) => r.json());
  }
  const puntos = Number(ticketState.pedidoData.cliente_puntos) || 0;
  const disponibles = recompensasDisponiblesCache.filter((r) => r.puntos_requeridos <= puntos);

  if (!disponibles.length) {
    alert('El cliente no tiene puntos suficientes para ninguna recompensa todavía.');
    return;
  }

  const html = `
    <div class="modal-overlay" id="modal-overlay-canje">
      <div class="modal-box">
        <h3>Canjear puntos</h3>
        <div style="font-size:13px;color:#888;margin-bottom:10px">El cliente tiene ${puntos} punto(s)</div>
        ${disponibles
          .map(
            (r) => `
          <div class="modal-opcion" data-id="${r.id}">
            <span>${r.nombre}</span>
            <span class="precio">${r.puntos_requeridos} pts · −$${Number(r.monto_descuento).toFixed(2)}</span>
          </div>`
          )
          .join('')}
        <button class="btn-cancelar-modal" id="btn-cerrar-canje">Cancelar</button>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;

  document.getElementById('modal-overlay-canje').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay-canje') document.getElementById('modal-container').innerHTML = '';
  });
  document.getElementById('btn-cerrar-canje').addEventListener('click', () => {
    document.getElementById('modal-container').innerHTML = '';
  });
  document.querySelectorAll('#modal-overlay-canje .modal-opcion').forEach((el) => {
    el.addEventListener('click', async () => {
      const resp = await fetch(`/api/pedidos/${ticketState.pedidoId}/canjear-recompensa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recompensa_id: el.dataset.id }),
      });
      document.getElementById('modal-container').innerHTML = '';
      if (!resp.ok) {
        const err = await resp.json();
        alert(err.error || 'No se pudo canjear');
        return;
      }
      await refrescarPedidoEditando();
      renderTicketPanel();
    });
  });
});

document.getElementById('btn-quitar-canje').addEventListener('click', async () => {
  if (!confirm('¿Quitar el canje aplicado a este pedido? Se le regresan los puntos al cliente.')) return;
  await fetch(`/api/pedidos/${ticketState.pedidoId}/quitar-canje`, { method: 'POST' });
  await refrescarPedidoEditando();
  renderTicketPanel();
});

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
    const yaTienePagos = ticketState.pedidoData.pagos && ticketState.pedidoData.pagos.length > 0;
    abrirModalCobroDirecto(ticketState.pedidoData, yaTienePagos);
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
          opcionesElegidas.push({
            id: seleccion[g.id].id,
            grupo: g.nombre,
            nombre: seleccion[g.id].nombre,
            precio: Number(seleccion[g.id].precio),
            tipo: 'variante',
            multiplicador: Number(seleccion[g.id].multiplicador) || 1,
          });
        }
        if (g.tipo === 'extra') {
          seleccion[g.id].forEach((op) => {
            opcionesElegidas.push({ id: op.id, grupo: g.nombre, nombre: op.nombre, precio: Number(op.precio), tipo: 'extra' });
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
        <h3>Cobrar pedido #${pedidoEnCobro.numero_dia ?? pedidoEnCobro.id}</h3>
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
document.getElementById('btn-abrir-compra-registro').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-compra-registro').classList.add('abierto');
  cargarHistorialCompras();
});
document.getElementById('btn-cerrar-compra-registro').addEventListener('click', () => document.getElementById('overlay-compra-registro').classList.remove('abierto'));

document.getElementById('btn-abrir-lealtad').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-lealtad').classList.add('abierto');
  cargarRecompensasAdmin();
});
document.getElementById('btn-cerrar-lealtad').addEventListener('click', () => document.getElementById('overlay-lealtad').classList.remove('abierto'));

document.getElementById('btn-abrir-resenas').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-resenas').classList.add('abierto');
  cargarResenas();
});
document.getElementById('btn-cerrar-resenas').addEventListener('click', () => document.getElementById('overlay-resenas').classList.remove('abierto'));

document.getElementById('btn-abrir-clientes').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-clientes').classList.add('abierto');
  document.getElementById('clientes-buscar').value = '';
  cargarClientes();
});
document.getElementById('btn-cerrar-clientes').addEventListener('click', () => document.getElementById('overlay-clientes').classList.remove('abierto'));

document.getElementById('btn-abrir-reparto').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-reparto').classList.add('abierto');
  document.getElementById('reparto-fecha').value = fechaNegocioActual();
  cargarReparto();
});
document.getElementById('btn-cerrar-reparto').addEventListener('click', () => document.getElementById('overlay-reparto').classList.remove('abierto'));

document.getElementById('btn-abrir-importar-recetas').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-importar-recetas').classList.add('abierto');
});
document.getElementById('btn-cerrar-importar-recetas').addEventListener('click', () => document.getElementById('overlay-importar-recetas').classList.remove('abierto'));

document.getElementById('btn-abrir-importar').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-importar').classList.add('abierto');
});
document.getElementById('btn-cerrar-importar').addEventListener('click', () => document.getElementById('overlay-importar').classList.remove('abierto'));

document.getElementById('btn-abrir-conteo').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-conteo').classList.add('abierto');
  cargarConteo();
});
document.getElementById('btn-cerrar-conteo').addEventListener('click', () => document.getElementById('overlay-conteo').classList.remove('abierto'));

document.getElementById('btn-abrir-compras').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-compras').classList.add('abierto');
});
document.getElementById('btn-cerrar-compras').addEventListener('click', () => document.getElementById('overlay-compras').classList.remove('abierto'));

document.getElementById('btn-abrir-menu-admin').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-menu-admin').classList.add('abierto');
  cargarMenuAdmin();
});
document.getElementById('btn-cerrar-menu-admin').addEventListener('click', async () => {
  document.getElementById('overlay-menu-admin').classList.remove('abierto');
  // Recarga la lista "normal" (sin ocultos) para que la toma de pedidos no se vea afectada
  state.categorias = await fetch('/api/categorias').then((r) => r.json());
  state.productos = await fetch('/api/productos').then((r) => r.json());
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
        <td class="num" style="color:${r.ajusteEnvio < 0 ? '#b8232f' : r.ajusteEnvio > 0 ? '#1a7d3a' : '#999'}">${r.ajusteEnvio !== 0 ? (r.ajusteEnvio > 0 ? '+' : '') + '$' + r.ajusteEnvio.toFixed(2) : '—'}</td>
        <td class="num"><strong>$${r.neto.toFixed(2)}</strong></td>
      </tr>`
    )
    .join('');

  const notaEnvio = document.getElementById('corte-nota-envio');
  if (corteActual.envioNoEfectivo > 0) {
    notaEnvio.style.display = 'block';
    notaEnvio.innerHTML = `🛵 <strong>$${corteActual.envioNoEfectivo.toFixed(2)}</strong> de envío se pagó en efectivo a repartidores de pedidos cobrados por tarjeta/transferencia. Ya está restado de lo que debe haber en <strong>Efectivo</strong>, y sumado como pendiente de traspasar en <strong>Tarjeta/Transferencia</strong> — pasa ese monto de la cuenta a la caja cuando puedas para que cuadren ambas.`;
  } else {
    notaEnvio.style.display = 'none';
  }

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

document.getElementById('btn-ir-kds').addEventListener('click', () => {
  const sucursalActual = state.sucursales.find((s) => String(s.id) === document.getElementById('sucursal-select').value);
  const slug = sucursalActual ? normalizarSlug(sucursalActual.nombre) : '';
  window.location.href = slug ? `/kds?sucursal=${slug}` : '/kds';
});

document.getElementById('btn-cerrar-sesion').addEventListener('click', async () => {
  if (!confirm('¿Cerrar sesión?')) return;
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

cargarInicial();

// ==================== PERMISOS SEGÚN PUESTO ====================

const DRAWER_SOLO_ENCARGADO = [
  'btn-abrir-compra-registro', 'btn-abrir-importar', 'btn-abrir-conteo', 'btn-abrir-compras',
  'btn-abrir-lealtad', 'btn-abrir-resenas', 'btn-abrir-reparto', 'btn-abrir-importar-recetas',
  'btn-abrir-menu-admin', 'btn-abrir-envios', 'btn-abrir-empleados',
];
const DRAWER_CAJERO_O_ENCARGADO = ['btn-abrir-corte'];

function aplicarPermisosUI() {
  const puesto = state.empleado?.puesto;
  const drawerUsuario = document.getElementById('drawer-usuario');
  if (state.empleado) {
    drawerUsuario.textContent = `👤 ${state.empleado.nombre} · ${state.empleado.puesto}`;
  }
  if (!puesto || puesto === 'encargado') return; // el encargado ve todo

  DRAWER_SOLO_ENCARGADO.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (puesto === 'mesero') {
    DRAWER_CAJERO_O_ENCARGADO.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }
}

// Esconde los botones del ticket que un mesero no debe usar (cobrar, cancelar, finalizar,
// cambiar método, canjear puntos) — se llama cada vez que se abre o refresca un ticket.
function ocultarBotonesRestringidosDelTicket() {
  if (state.empleado?.puesto !== 'mesero') return;
  ['btn-t-pago', 'btn-finalizar-pedido', 'btn-cancelar-pedido-completo', 'btn-cambiar-metodo', 'btn-canjear-lealtad', 'btn-quitar-canje'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// ==================== EMPLEADOS ====================

document.getElementById('nuevo-empleado-pin').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
});

document.getElementById('btn-abrir-empleados').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-empleados').classList.add('abierto');
  document.getElementById('nuevo-empleado-sucursal').innerHTML =
    '<option value="">Todas (encargado)</option>' + state.sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');
  cargarEmpleados();
});
document.getElementById('btn-cerrar-empleados').addEventListener('click', () => document.getElementById('overlay-empleados').classList.remove('abierto'));

document.getElementById('btn-agregar-empleado').addEventListener('click', async () => {
  const nombre = document.getElementById('nuevo-empleado-nombre').value.trim();
  const puesto = document.getElementById('nuevo-empleado-puesto').value;
  const pin = document.getElementById('nuevo-empleado-pin').value;
  const sucursal_id = document.getElementById('nuevo-empleado-sucursal').value || null;
  if (!nombre || pin.length !== 4) {
    alert('Falta el nombre o el PIN debe ser de 4 dígitos');
    return;
  }
  const resp = await fetch('/api/empleados', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, puesto, pin, sucursal_id }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    alert(err.error || 'No se pudo agregar');
    return;
  }
  document.getElementById('nuevo-empleado-nombre').value = '';
  document.getElementById('nuevo-empleado-pin').value = '';
  cargarEmpleados();
});

async function cargarEmpleados() {
  const empleados = await fetch('/api/empleados').then((r) => r.json());
  document.getElementById('empleados-tabla-body').innerHTML = empleados
    .map(
      (e) => `
    <tr style="opacity:${e.activo ? '1' : '0.5'}">
      <td><input type="text" class="empleado-nombre-edit" data-id="${e.id}" value="${e.nombre}" style="width:100%;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td>
        <select class="empleado-puesto-edit" data-id="${e.id}" style="padding:6px;border-radius:6px;border:1px solid #ddd">
          <option value="mesero" ${e.puesto === 'mesero' ? 'selected' : ''}>Mesero</option>
          <option value="cajero" ${e.puesto === 'cajero' ? 'selected' : ''}>Cajero</option>
          <option value="encargado" ${e.puesto === 'encargado' ? 'selected' : ''}>Encargado</option>
        </select>
      </td>
      <td>
        <select class="empleado-sucursal-edit" data-id="${e.id}" style="padding:6px;border-radius:6px;border:1px solid #ddd">
          <option value="">Todas</option>
          ${state.sucursales.map((s) => `<option value="${s.id}" ${String(e.sucursal_id) === String(s.id) ? 'selected' : ''}>${s.nombre}</option>`).join('')}
        </select>
      </td>
      <td><input type="text" inputmode="numeric" class="empleado-pin-edit" data-id="${e.id}" value="${e.pin}" maxlength="4" style="width:60px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:center" /></td>
      <td style="white-space:nowrap">
        <button class="btn-eliminar-fila" data-guardar-empleado="${e.id}" title="Guardar">💾</button>
        <button class="btn-eliminar-fila" data-toggle-empleado="${e.id}" data-activo="${e.activo}" title="${e.activo ? 'Desactivar' : 'Activar'}">${e.activo ? '👁️' : '🚫'}</button>
      </td>
      <td><button class="btn-eliminar-fila" data-borrar-empleado="${e.id}" title="Borrar">🗑️</button></td>
    </tr>`
    )
    .join('') || '<tr><td colspan="6" style="text-align:center;color:#999">Sin empleados todavía — se puede usar el PIN maestro mientras tanto</td></tr>';

  document.querySelectorAll('.empleado-pin-edit').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9]/g, '').slice(0, 4);
    });
  });
  document.querySelectorAll('[data-guardar-empleado]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.guardarEmpleado;
      const nombre = document.querySelector(`.empleado-nombre-edit[data-id="${id}"]`).value.trim();
      const puesto = document.querySelector(`.empleado-puesto-edit[data-id="${id}"]`).value;
      const pin = document.querySelector(`.empleado-pin-edit[data-id="${id}"]`).value;
      const sucursal_id = document.querySelector(`.empleado-sucursal-edit[data-id="${id}"]`).value || null;
      const resp = await fetch(`/api/empleados/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, puesto, pin, sucursal_id }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        alert(err.error || 'No se pudo guardar');
      }
      cargarEmpleados();
    });
  });
  document.querySelectorAll('[data-toggle-empleado]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const activo = btn.dataset.activo === 'true';
      await fetch(`/api/empleados/${btn.dataset.toggleEmpleado}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !activo }),
      });
      cargarEmpleados();
    });
  });
  document.querySelectorAll('[data-borrar-empleado]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este empleado? Ya no va a poder entrar con su PIN.')) return;
      await fetch(`/api/empleados/${btn.dataset.borrarEmpleado}`, { method: 'DELETE' });
      cargarEmpleados();
    });
  });
}

// ==================== LEALTAD: RECOMPENSAS ====================

document.querySelectorAll('#nueva-recompensa-puntos, #nueva-recompensa-monto').forEach((el) => {
  el.addEventListener('input', () => {
    el.value = el.value.replace(/[^0-9.]/g, '');
  });
});

document.getElementById('btn-agregar-recompensa').addEventListener('click', async () => {
  const nombre = document.getElementById('nueva-recompensa-nombre').value.trim();
  const puntos_requeridos = document.getElementById('nueva-recompensa-puntos').value;
  const monto_descuento = document.getElementById('nueva-recompensa-monto').value;
  if (!nombre || !puntos_requeridos || !monto_descuento) {
    alert('Falta el nombre, los puntos o el monto de descuento');
    return;
  }
  await fetch('/api/recompensas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, puntos_requeridos, monto_descuento }),
  });
  document.getElementById('nueva-recompensa-nombre').value = '';
  document.getElementById('nueva-recompensa-puntos').value = '';
  document.getElementById('nueva-recompensa-monto').value = '';
  cargarRecompensasAdmin();
});

async function cargarRecompensasAdmin() {
  const recompensas = await fetch('/api/recompensas?todas=true').then((r) => r.json());
  recompensasDisponiblesCache = null; // invalida el caché usado en el ticket, para que tome cambios nuevos

  document.getElementById('recompensas-tabla-body').innerHTML =
    recompensas
      .map(
        (r) => `
    <tr style="opacity:${r.activo ? '1' : '0.5'}">
      <td><input type="text" class="recompensa-nombre-edit" data-id="${r.id}" value="${r.nombre}" style="width:100%;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td class="num"><input type="text" inputmode="decimal" class="recompensa-puntos-edit" data-id="${r.id}" value="${r.puntos_requeridos}" style="width:60px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
      <td class="num"><input type="text" inputmode="decimal" class="recompensa-monto-edit" data-id="${r.id}" value="${r.monto_descuento}" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
      <td style="white-space:nowrap">
        <button class="btn-eliminar-fila" data-guardar-recompensa="${r.id}" title="Guardar">💾</button>
        <button class="btn-eliminar-fila" data-toggle-recompensa="${r.id}" data-activo="${r.activo}" title="${r.activo ? 'Desactivar' : 'Activar'}">${r.activo ? '👁️' : '🚫'}</button>
      </td>
      <td><button class="btn-eliminar-fila" data-borrar-recompensa="${r.id}" title="Borrar">🗑️</button></td>
    </tr>`
      )
      .join('') || '<tr><td colspan="5" style="text-align:center;color:#999">Sin recompensas todavía</td></tr>';

  document.querySelectorAll('.recompensa-puntos-edit, .recompensa-monto-edit').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
    });
  });
  document.querySelectorAll('[data-guardar-recompensa]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.guardarRecompensa;
      const nombre = document.querySelector(`.recompensa-nombre-edit[data-id="${id}"]`).value.trim();
      const puntos_requeridos = document.querySelector(`.recompensa-puntos-edit[data-id="${id}"]`).value;
      const monto_descuento = document.querySelector(`.recompensa-monto-edit[data-id="${id}"]`).value;
      await fetch(`/api/recompensas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, puntos_requeridos, monto_descuento }),
      });
      cargarRecompensasAdmin();
    });
  });
  document.querySelectorAll('[data-toggle-recompensa]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const activo = btn.dataset.activo === 'true';
      await fetch(`/api/recompensas/${btn.dataset.toggleRecompensa}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !activo }),
      });
      cargarRecompensasAdmin();
    });
  });
  document.querySelectorAll('[data-borrar-recompensa]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar esta recompensa?')) return;
      await fetch(`/api/recompensas/${btn.dataset.borrarRecompensa}`, { method: 'DELETE' });
      cargarRecompensasAdmin();
    });
  });
}

// ==================== RESEÑAS ====================

document.getElementById('btn-guardar-google-url').addEventListener('click', async () => {
  const sucursal_id = document.getElementById('sucursal-select').value;
  const google_maps_url = document.getElementById('resena-google-url').value.trim();
  if (!google_maps_url) {
    alert('Pega el link de Google Maps primero');
    return;
  }
  await fetch(`/api/sucursales/${sucursal_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ google_maps_url }),
  });
  alert('Guardado');
});

async function cargarResenas() {
  const sucursalId = document.getElementById('sucursal-select').value;

  const sucursalActual = state.sucursales.find((s) => String(s.id) === String(sucursalId));
  document.getElementById('resena-google-url').value = sucursalActual?.google_maps_url || '';

  const resenas = await fetch(`/api/resenas?sucursal_id=${sucursalId}`).then((r) => r.json());

  const resumenEl = document.getElementById('resenas-resumen');
  if (!resenas.length) {
    resumenEl.innerHTML = '<p style="color:#999;font-size:13px">Sin reseñas todavía</p>';
  } else {
    const promedio = resenas.reduce((s, r) => s + r.calificacion, 0) / resenas.length;
    resumenEl.innerHTML = `
      <div class="resumen-total">
        <span>Promedio (${resenas.length} reseña${resenas.length === 1 ? '' : 's'})</span>
        <span>${'⭐'.repeat(Math.round(promedio))} ${promedio.toFixed(1)}</span>
      </div>`;
  }

  document.getElementById('resenas-lista').innerHTML =
    resenas
      .map(
        (r) => `
      <div style="background:white;border-radius:10px;padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:#888;margin-bottom:6px">
          <span>${'⭐'.repeat(r.calificacion)}${'☆'.repeat(5 - r.calificacion)} ${r.cliente_nombre ? '· ' + escapeHtml(r.cliente_nombre) : ''}</span>
          <span>${new Date(r.creado_en).toLocaleDateString('es-MX')}</span>
        </div>
        ${r.comentario ? `<div style="font-size:14px">${escapeHtml(r.comentario)}</div>` : '<div style="font-size:13px;color:#bbb">Sin comentario</div>'}
      </div>`
      )
      .join('') || '';
}

// ==================== CATÁLOGO DE CLIENTES ====================

let clientesTimeout = null;
document.getElementById('clientes-buscar').addEventListener('input', () => {
  clearTimeout(clientesTimeout);
  clientesTimeout = setTimeout(cargarClientes, 300);
});

async function cargarClientes() {
  const buscar = document.getElementById('clientes-buscar').value.trim();
  const url = buscar ? `/api/clientes?buscar=${encodeURIComponent(buscar)}` : '/api/clientes?buscar=';
  const clientes = await fetch(url).then((r) => r.json());
  renderClientes(clientes);
}

function renderClientes(clientes) {
  document.getElementById('clientes-tabla-body').innerHTML =
    clientes
      .map(
        (c) => `
    <tr>
      <td><input type="text" class="cliente-nombre-edit" data-id="${c.id}" value="${c.nombre || ''}" style="width:100%;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td><input type="text" class="cliente-telefono-edit" data-id="${c.id}" value="${c.telefono || ''}" style="width:110px;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td><input type="text" class="cliente-direccion-edit" data-id="${c.id}" value="${c.direccion || ''}" style="width:100%;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td><input type="text" class="cliente-colonia-edit" data-id="${c.id}" value="${c.colonia || ''}" style="width:100px;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td class="num" style="font-weight:bold;color:#a97800">⭐ ${c.puntos || 0}</td>
      <td style="white-space:nowrap">
        <button class="btn-eliminar-fila" data-guardar-cliente="${c.id}" title="Guardar">💾</button>
        <button class="btn-eliminar-fila" data-borrar-cliente="${c.id}" title="Borrar">🗑️</button>
      </td>
    </tr>`
      )
      .join('') || '<tr><td colspan="6" style="text-align:center;color:#999">Sin clientes encontrados</td></tr>';

  document.querySelectorAll('[data-guardar-cliente]').forEach((btn) => {
    btn.addEventListener('click', () => guardarClienteAdmin(Number(btn.dataset.guardarCliente)));
  });
  document.querySelectorAll('[data-borrar-cliente]').forEach((btn) => {
    btn.addEventListener('click', () => borrarClienteAdmin(Number(btn.dataset.borrarCliente)));
  });
}

async function guardarClienteAdmin(clienteId) {
  const nombre = document.querySelector(`.cliente-nombre-edit[data-id="${clienteId}"]`).value.trim();
  const telefono = document.querySelector(`.cliente-telefono-edit[data-id="${clienteId}"]`).value.trim();
  const direccion = document.querySelector(`.cliente-direccion-edit[data-id="${clienteId}"]`).value.trim();
  const colonia = document.querySelector(`.cliente-colonia-edit[data-id="${clienteId}"]`).value.trim();

  const resp = await fetch(`/api/clientes/${clienteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, telefono, direccion, colonia }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    alert(err.error || 'No se pudo guardar');
  }
  cargarClientes();
}

async function borrarClienteAdmin(clienteId) {
  if (!confirm('¿Borrar este cliente del catálogo?')) return;
  const resp = await fetch(`/api/clientes/${clienteId}`, { method: 'DELETE' });
  if (!resp.ok) {
    const err = await resp.json();
    alert(err.error || 'No se pudo borrar');
  }
  cargarClientes();
}

// ---------- Autocompletar cliente al escribir el teléfono en un pedido nuevo ----------

let telefonoTimeout = null;
document.getElementById('ticket-cliente-telefono').addEventListener('input', () => {
  clearTimeout(telefonoTimeout);
  document.getElementById('ticket-cliente-encontrado').style.display = 'none';
  if (ticketState && ticketState.modo !== 'nuevo') return; // solo autocompleta al crear, no al editar uno ya existente
  telefonoTimeout = setTimeout(buscarClientePorTelefono, 400);
});

async function buscarClientePorTelefono() {
  const telefono = document.getElementById('ticket-cliente-telefono').value.trim();
  if (telefono.length < 8) return;

  const clientes = await fetch(`/api/clientes?telefono=${encodeURIComponent(telefono)}`).then((r) => r.json());
  if (!clientes.length) return;

  const cliente = clientes[0];
  document.getElementById('ticket-cliente-nombre').value = cliente.nombre || '';
  if (cliente.direccion) document.getElementById('ticket-cliente-direccion').value = cliente.direccion;
  if (cliente.colonia) {
    const selectColonia = document.getElementById('ticket-cliente-colonia');
    if ([...selectColonia.options].some((op) => op.value === cliente.colonia)) {
      selectColonia.value = cliente.colonia;
      selectColonia.dispatchEvent(new Event('change'));
    }
  }
  document.getElementById('ticket-cliente-encontrado').style.display = 'block';
}

// ==================== REPARTO DE UTILIDADES ====================

document.getElementById('reparto-monto').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^0-9.]/g, '');
});

document.getElementById('btn-agregar-reparto').addEventListener('click', async () => {
  const fecha = document.getElementById('reparto-fecha').value;
  const socio = document.getElementById('reparto-socio').value.trim();
  const monto = document.getElementById('reparto-monto').value;
  const metodo_pago = document.getElementById('reparto-metodo').value;
  const nota = document.getElementById('reparto-nota').value.trim();

  if (!fecha || !socio || !monto) {
    alert('Falta la fecha, el socio o el monto');
    return;
  }

  await fetch('/api/distribuciones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, socio, monto, metodo_pago, nota }),
  });

  document.getElementById('reparto-socio').value = '';
  document.getElementById('reparto-monto').value = '';
  document.getElementById('reparto-nota').value = '';
  cargarReparto();
});

async function cargarReparto() {
  const distribuciones = await fetch('/api/distribuciones').then((r) => r.json());

  // Resumen por socio, para ver de un vistazo si van parejos en el reparto
  const totalesPorSocio = {};
  distribuciones.forEach((d) => {
    totalesPorSocio[d.socio] = (totalesPorSocio[d.socio] || 0) + Number(d.monto);
  });
  const socios = Object.keys(totalesPorSocio);
  const totalGeneral = socios.reduce((s, nombre) => s + totalesPorSocio[nombre], 0);

  const resumenEl = document.getElementById('reparto-resumen');
  if (!socios.length) {
    resumenEl.innerHTML = '<p style="padding:0 12px;color:#999;font-size:13px">Sin repartos registrados todavía</p>';
  } else {
    resumenEl.innerHTML = socios
      .map((nombre) => {
        const monto = totalesPorSocio[nombre];
        const porcentaje = totalGeneral ? ((monto / totalGeneral) * 100).toFixed(1) : '0';
        return `
        <div class="resumen-total">
          <span>${escapeHtml(nombre)} (${porcentaje}%)</span>
          <span>$${monto.toFixed(2)}</span>
        </div>`;
      })
      .join('');
  }

  document.getElementById('reparto-tabla-body').innerHTML =
    distribuciones
      .map(
        (d) => `
      <tr>
        <td>${d.fecha}</td>
        <td>${escapeHtml(d.socio)}</td>
        <td class="num">$${Number(d.monto).toFixed(2)}</td>
        <td>${METODO_LABELS[d.metodo_pago] || ''}</td>
        <td><button class="btn-eliminar-fila" data-id="${d.id}">🗑️</button></td>
      </tr>`
      )
      .join('') || '<tr><td colspan="5" style="text-align:center;color:#999">Sin repartos todavía</td></tr>';

  document.querySelectorAll('#reparto-tabla-body .btn-eliminar-fila').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este reparto?')) return;
      await fetch(`/api/distribuciones/${btn.dataset.id}`, { method: 'DELETE' });
      cargarReparto();
    });
  });
}

// ==================== IMPORTAR RECETAS (CSV) ====================

document.getElementById('btn-importar-recetas-csv').addEventListener('click', async () => {
  const input = document.getElementById('recetas-archivo');
  const progreso = document.getElementById('recetas-progreso');
  const resultado = document.getElementById('recetas-resultado');
  resultado.innerHTML = '';

  if (!input.files.length) {
    alert('Elige un archivo CSV primero');
    return;
  }

  const texto = await input.files[0].text();
  const filas = parsearCSV(texto);

  if (!filas.length) {
    progreso.textContent = 'El archivo está vacío o no se pudo leer.';
    return;
  }

  const columnasRequeridas = ['producto', 'insumo', 'cantidad'];
  const columnasFaltantes = columnasRequeridas.filter((c) => !(c in filas[0]));
  if (columnasFaltantes.length) {
    progreso.textContent = `Faltan columnas en el CSV: ${columnasFaltantes.join(', ')}`;
    return;
  }

  const btn = document.getElementById('btn-importar-recetas-csv');
  btn.disabled = true;
  progreso.textContent = `Importando ${filas.length} fila(s)...`;

  try {
    const resp = await fetch('/api/recetas/importar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filas }),
    });
    const data = await resp.json();

    progreso.textContent = '';
    btn.disabled = false;

    if (!resp.ok) {
      resultado.innerHTML = `<p style="color:#b8232f">${escapeHtml(data.error || 'No se pudo importar')}</p>`;
      return;
    }

    resultado.innerHTML = `
      <div style="background:white;border-radius:10px;padding:14px;margin-bottom:10px">
        <div style="font-size:16px;font-weight:bold;color:#1a7d3a">✅ ${data.recetasGuardadas} receta(s) guardadas</div>
        ${data.errores.length ? `<div style="margin-top:8px;color:#b8232f;font-size:13px">⚠️ ${data.errores.length} fila(s) con problemas:</div>` : ''}
      </div>
      ${
        data.errores.length
          ? `<div style="background:white;border-radius:10px;padding:12px;max-height:300px;overflow-y:auto;font-size:12px;color:#b8232f;line-height:1.6">
              ${data.errores.map((e) => `• ${escapeHtml(e)}`).join('<br>')}
            </div>`
          : ''
      }`;
  } catch (err) {
    progreso.textContent = '';
    btn.disabled = false;
    resultado.innerHTML = '<p style="color:#b8232f">No se pudo conectar, revisa tu internet e intenta de nuevo.</p>';
  }
});

// ==================== TIEMPO REAL: refresca sola cuando llega un pedido (ej. de la web) ====================

const socketPos = io();
let sonidoAvisoWebListo = false;

function unirseASalaSucursal() {
  const sucursalId = document.getElementById('sucursal-select').value;
  if (sucursalId) socketPos.emit('join_sucursal', sucursalId);
}
socketPos.on('connect', unirseASalaSucursal);
document.getElementById('sucursal-select').addEventListener('change', unirseASalaSucursal);

function sonarAvisoPos() {
  try {
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    osc.connect(audio.destination);
    osc.frequency.value = 660;
    osc.start();
    setTimeout(() => osc.stop(), 180);
  } catch (e) {}
}

socketPos.on('nuevo_pedido', (pedido) => {
  sonarAvisoPos();
  cargarPedidosYContar();
  if (document.getElementById('overlay-historial').classList.contains('abierto')) cargarHistorial();
});

socketPos.on('pedido_actualizado', () => {
  cargarPedidosYContar();
  if (document.getElementById('overlay-historial').classList.contains('abierto')) cargarHistorial();
});

// ==================== REGISTRAR COMPRA (con lectura de ticket) ====================

let compraItemsState = [];
let insumosParaCompraCache = null;

document.getElementById('btn-leer-ticket').addEventListener('click', leerTicketCompra);
document.getElementById('btn-compra-manual').addEventListener('click', empezarCompraManual);
document.getElementById('btn-agregar-fila-compra').addEventListener('click', () => {
  compraItemsState.push({ descripcion: '', insumo_id: null, cantidad: 1, costo_unitario: 0 });
  renderTablaCompra();
});
document.getElementById('btn-guardar-compra').addEventListener('click', guardarCompra);

// Reduce el tamaño de la foto antes de mandarla (las fotos de celular pueden pesar
// varios MB o tener resolución muy alta, y hay un límite de tamaño para las imágenes
// que recibe Claude). Usa createImageBitmap cuando está disponible porque es mucho
// más eficiente en memoria que cargar la foto completa antes de comprimirla.
async function comprimirImagenABase64(archivo, maxDimension, calidad) {
  function escalar(width, height) {
    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round(height * (maxDimension / width));
        width = maxDimension;
      } else {
        width = Math.round(width * (maxDimension / height));
        height = maxDimension;
      }
    }
    return { width, height };
  }

  if (window.createImageBitmap) {
    try {
      const bitmap = await createImageBitmap(archivo);
      const { width, height } = escalar(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', calidad).split(',')[1];
    } catch (err) {
      console.warn('createImageBitmap falló, probando con el método alterno:', err);
    }
  }

  // Método alterno para navegadores que no soportan createImageBitmap (o si falló)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const { width, height } = escalar(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', calidad).split(',')[1]);
      };
      img.onerror = () => reject(new Error('El navegador no pudo abrir esta imagen'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo (puede estar dañado o ser muy pesado)'));
    reader.readAsDataURL(archivo);
  });
}

async function leerTicketCompra() {
  const input = document.getElementById('compra-foto');
  const progreso = document.getElementById('compra-progreso');
  if (!input.files.length) {
    alert('Elige o toma una foto del ticket primero');
    return;
  }

  const btn = document.getElementById('btn-leer-ticket');
  btn.disabled = true;
  progreso.textContent = '🧠 Leyendo el ticket, un momento...';

  try {
    const archivo = input.files[0];
    const base64 = await comprimirImagenABase64(archivo, 1600, 0.82);

    const resp = await fetch('/api/compras/leer-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagen_base64: base64, media_type: 'image/jpeg' }),
    });
    const data = await resp.json();

    if (!resp.ok) {
      progreso.textContent = '';
      alert((data.error || 'No se pudo leer el ticket') + (data.detalle ? '\n\nDetalle: ' + data.detalle : ''));
      return;
    }

    insumosParaCompraCache = await fetch('/api/insumos').then((r) => r.json());

    compraItemsState = (data.items || []).map((it) => ({
      descripcion: it.descripcion,
      insumo_id: it.insumo_id_sugerido,
      cantidad: it.cantidad || 1,
      costo_unitario: it.precio_unitario || 0,
    }));

    document.getElementById('compra-proveedor').value = data.proveedor || '';
    document.getElementById('compra-fecha').value = data.fecha || fechaNegocioActual();
    document.getElementById('compra-form-detalle').style.display = 'block';
    progreso.textContent = compraItemsState.length
      ? `Se leyeron ${compraItemsState.length} producto(s) — revisa que el insumo de cada fila esté correcto antes de guardar.`
      : 'No se detectaron productos en la foto. Agrega las filas a mano.';
    renderTablaCompra();
  } catch (err) {
    progreso.textContent = '';
    alert('No se pudo procesar la imagen: ' + (err.message || 'intenta de nuevo.'));
  } finally {
    btn.disabled = false;
  }
}

async function empezarCompraManual() {
  insumosParaCompraCache = await fetch('/api/insumos').then((r) => r.json());
  compraItemsState = [{ descripcion: '', insumo_id: null, cantidad: 1, costo_unitario: 0 }];
  document.getElementById('compra-proveedor').value = '';
  document.getElementById('compra-fecha').value = fechaNegocioActual();
  document.getElementById('compra-form-detalle').style.display = 'block';
  document.getElementById('compra-progreso').textContent = '';
  renderTablaCompra();
}

function renderTablaCompra() {
  document.getElementById('compra-items-tabla-body').innerHTML = compraItemsState
    .map(
      (it, i) => `
    <tr>
      <td style="font-size:12px;color:#888;max-width:120px">${escapeHtml(it.descripcion || '')}</td>
      <td>
        <select class="compra-insumo-select" data-idx="${i}" style="padding:6px;border-radius:6px;border:1px solid #ddd">
          <option value="">Selecciona...</option>
          ${insumosParaCompraCache
            .map((ins) => `<option value="${ins.id}" ${ins.id === it.insumo_id ? 'selected' : ''}>${ins.nombre} (${ins.unidad})</option>`)
            .join('')}
        </select>
      </td>
      <td class="num"><input type="text" inputmode="decimal" class="compra-cantidad" data-idx="${i}" value="${it.cantidad}" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
      <td class="num"><input type="text" inputmode="decimal" class="compra-costo" data-idx="${i}" value="${it.costo_unitario}" style="width:80px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
      <td><button class="btn-eliminar-fila" data-quitar="${i}">🗑️</button></td>
    </tr>`
    )
    .join('');

  document.querySelectorAll('.compra-insumo-select').forEach((el) => {
    el.addEventListener('change', () => {
      compraItemsState[Number(el.dataset.idx)].insumo_id = el.value ? Number(el.value) : null;
    });
  });
  document.querySelectorAll('.compra-cantidad, .compra-costo').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
      const idx = Number(el.dataset.idx);
      if (el.classList.contains('compra-cantidad')) compraItemsState[idx].cantidad = el.value;
      else compraItemsState[idx].costo_unitario = el.value;
      actualizarTotalCompraPreview();
    });
  });
  document.querySelectorAll('[data-quitar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      compraItemsState.splice(Number(btn.dataset.quitar), 1);
      renderTablaCompra();
      actualizarTotalCompraPreview();
    });
  });

  actualizarTotalCompraPreview();
}

function actualizarTotalCompraPreview() {
  const total = compraItemsState.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.costo_unitario) || 0), 0);
  document.getElementById('compra-total-preview').textContent = `$${total.toFixed(2)}`;
}

async function guardarCompra() {
  const sucursal_id = document.getElementById('sucursal-select').value;
  const proveedor = document.getElementById('compra-proveedor').value.trim();
  const fecha = document.getElementById('compra-fecha').value || fechaNegocioActual();

  const itemsValidos = compraItemsState.filter((it) => it.insumo_id && Number(it.cantidad) > 0);
  if (!itemsValidos.length) {
    alert('Asigna el insumo y la cantidad de al menos una fila antes de guardar.');
    return;
  }

  const btn = document.getElementById('btn-guardar-compra');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const resp = await fetch('/api/compras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sucursal_id,
      proveedor,
      fecha,
      items: itemsValidos.map((it) => ({
        insumo_id: it.insumo_id,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        costo_unitario: it.costo_unitario,
      })),
    }),
  });

  btn.disabled = false;
  btn.textContent = 'Guardar compra';

  if (!resp.ok) {
    const err = await resp.json();
    alert(err.error || 'No se pudo guardar la compra');
    return;
  }

  compraItemsState = [];
  document.getElementById('compra-form-detalle').style.display = 'none';
  document.getElementById('compra-foto').value = '';
  document.getElementById('compra-progreso').textContent = '✅ Compra guardada, se sumó al inventario.';
  cargarHistorialCompras();
}

async function cargarHistorialCompras() {
  const sucursalId = document.getElementById('sucursal-select').value;
  const compras = await fetch(`/api/compras?sucursal_id=${sucursalId}`).then((r) => r.json());
  const cont = document.getElementById('historial-compras');

  if (!compras.length) {
    cont.innerHTML = '<p style="color:#999;font-size:13px">Sin compras registradas todavía</p>';
    return;
  }

  cont.innerHTML = compras
    .map((c) => {
      const items = c.items
        .map((it) => `<div style="font-size:13px;padding:2px 0">${it.insumo_nombre}: ${Number(it.cantidad)} ${it.unidad} — $${Number(it.subtotal).toFixed(2)}</div>`)
        .join('');
      return `
        <div style="background:white;border-radius:10px;padding:12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:13px;color:#888;margin-bottom:6px">
            <span>${c.fecha}${c.proveedor ? ' · ' + escapeHtml(c.proveedor) : ''}</span>
            <span style="font-weight:bold;color:#333">$${Number(c.total).toFixed(2)}</span>
          </div>
          ${items}
        </div>`;
    })
    .join('');
}

// ==================== IMPORTAR HISTORIAL (CSV) ====================

const COLUMNAS_IMPORTAR = [
  'pedido_externo', 'fecha', 'hora', 'sucursal', 'cliente_nombre',
  'tipo', 'metodo_pago', 'producto', 'variante', 'cantidad', 'precio_unitario',
];

// Parser de CSV sencillo, soporta campos entre comillas con comas adentro
function parsearCSV(texto) {
  const lineas = texto.split(/\r\n|\n/).filter((l) => l.trim() !== '');
  if (!lineas.length) return [];

  function parsearLinea(linea) {
    const campos = [];
    let actual = '';
    let entreComillas = false;
    for (let i = 0; i < linea.length; i++) {
      const ch = linea[i];
      if (ch === '"') {
        entreComillas = !entreComillas;
      } else if (ch === ',' && !entreComillas) {
        campos.push(actual);
        actual = '';
      } else {
        actual += ch;
      }
    }
    campos.push(actual);
    return campos.map((c) => c.trim());
  }

  const encabezado = parsearLinea(lineas[0]).map((h) => h.toLowerCase());
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const valores = parsearLinea(lineas[i]);
    const fila = {};
    encabezado.forEach((col, idx) => {
      fila[col] = valores[idx] !== undefined ? valores[idx] : '';
    });
    filas.push(fila);
  }
  return filas;
}

document.getElementById('btn-importar-csv').addEventListener('click', async () => {
  const input = document.getElementById('importar-archivo');
  const progreso = document.getElementById('importar-progreso');
  const resultado = document.getElementById('importar-resultado');
  resultado.innerHTML = '';

  if (!input.files.length) {
    alert('Elige un archivo CSV primero');
    return;
  }

  const texto = await input.files[0].text();
  const filas = parsearCSV(texto);

  if (!filas.length) {
    progreso.textContent = 'El archivo está vacío o no se pudo leer.';
    return;
  }

  const columnasFaltantes = COLUMNAS_IMPORTAR.filter((c) => !(c in filas[0]));
  if (columnasFaltantes.length) {
    progreso.textContent = `Faltan columnas en el CSV: ${columnasFaltantes.join(', ')}`;
    return;
  }

  const TAMANO_LOTE = 300;
  const lotes = [];
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    lotes.push(filas.slice(i, i + TAMANO_LOTE));
  }

  const btn = document.getElementById('btn-importar-csv');
  btn.disabled = true;

  let totalCreados = 0;
  let todosLosErrores = [];

  for (let i = 0; i < lotes.length; i++) {
    progreso.textContent = `Importando lote ${i + 1} de ${lotes.length} (${filas.length} filas en total)...`;
    try {
      const resp = await fetch('/api/importar-historico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filas: lotes[i] }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        todosLosErrores.push(data.error || `Error en el lote ${i + 1}`);
        continue;
      }
      totalCreados += data.pedidosCreados;
      todosLosErrores = todosLosErrores.concat(data.errores || []);
    } catch (err) {
      todosLosErrores.push(`No se pudo enviar el lote ${i + 1} (revisa tu conexión)`);
    }
  }

  btn.disabled = false;
  progreso.textContent = '';

  resultado.innerHTML = `
    <div style="background:white;border-radius:10px;padding:14px;margin-bottom:10px">
      <div style="font-size:16px;font-weight:bold;color:#1a7d3a">✅ ${totalCreados} pedido(s) importados</div>
      ${todosLosErrores.length ? `<div style="margin-top:8px;color:#b8232f;font-size:13px">⚠️ ${todosLosErrores.length} fila(s) con problemas:</div>` : ''}
    </div>
    ${
      todosLosErrores.length
        ? `<div style="background:white;border-radius:10px;padding:12px;max-height:300px;overflow-y:auto;font-size:12px;color:#b8232f;line-height:1.6">
            ${todosLosErrores.map((e) => `• ${escapeHtml(e)}`).join('<br>')}
          </div>`
        : ''
    }`;

  cargarPedidosYContar();
});

// ==================== CONTEO DE INVENTARIO ====================

async function cargarConteo() {
  const sucursalId = document.getElementById('sucursal-select').value;
  const insumos = await fetch(`/api/insumos?sucursal_id=${sucursalId}`).then((r) => r.json());

  document.getElementById('conteo-tabla-body').innerHTML =
    insumos
      .map(
        (i) => `
    <tr>
      <td>${i.nombre}</td>
      <td class="num">${Number(i.stock_actual).toFixed(2)} ${i.unidad}</td>
      <td class="num"><input type="text" inputmode="decimal" class="conteo-contado" data-id="${i.id}" data-teorico="${i.stock_actual}" placeholder="—" style="width:80px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
      <td class="num diferencia-celda" data-id="${i.id}" style="color:#999">—</td>
    </tr>`
      )
      .join('') || '<tr><td colspan="4" style="text-align:center;color:#999">Sin insumos todavía — agrégalos en Menú → Insumos</td></tr>';

  document.querySelectorAll('.conteo-contado').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
      const celda = document.querySelector(`.diferencia-celda[data-id="${el.dataset.id}"]`);
      if (el.value === '') {
        celda.textContent = '—';
        celda.style.color = '#999';
        return;
      }
      const diferencia = Number(el.value) - Number(el.dataset.teorico);
      celda.textContent = (diferencia > 0 ? '+' : '') + diferencia.toFixed(2);
      celda.style.color = Math.abs(diferencia) < 0.01 ? '#1a7d3a' : '#b8232f';
    });
  });

  cargarHistorialConteos();
}

document.getElementById('btn-guardar-conteo').addEventListener('click', async () => {
  const sucursal_id = document.getElementById('sucursal-select').value;
  const conteos = [];
  document.querySelectorAll('.conteo-contado').forEach((el) => {
    if (el.value !== '') conteos.push({ insumo_id: Number(el.dataset.id), contado: el.value });
  });

  if (!conteos.length) {
    alert('No capturaste ningún conteo todavía');
    return;
  }
  if (!confirm(`¿Guardar el conteo de ${conteos.length} insumo(s)? Esto ajusta el stock del sistema a lo que capturaste.`)) return;

  const btn = document.getElementById('btn-guardar-conteo');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const resp = await fetch('/api/conteos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sucursal_id, fecha: fechaNegocioActual(), conteos }),
  });

  btn.disabled = false;
  btn.textContent = 'Guardar conteo';

  if (!resp.ok) {
    const err = await resp.json();
    alert(err.error || 'No se pudo guardar el conteo');
    return;
  }

  cargarConteo();
});

async function cargarHistorialConteos() {
  const sucursalId = document.getElementById('sucursal-select').value;
  const conteos = await fetch(`/api/conteos?sucursal_id=${sucursalId}`).then((r) => r.json());
  const cont = document.getElementById('historial-conteos');

  if (!conteos.length) {
    cont.innerHTML = '<p style="color:#999;font-size:13px">Sin conteos registrados todavía</p>';
    return;
  }

  cont.innerHTML = conteos
    .map((c) => {
      const fechaHora = new Date(c.creado_en).toLocaleString('es-MX');
      const conDiferencia = c.resumen.filter((r) => Math.abs(r.diferencia) >= 0.01);
      const detalle = conDiferencia.length
        ? conDiferencia
            .map(
              (r) =>
                `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
                  <span>${r.nombre}</span>
                  <span style="color:${r.diferencia > 0 ? '#1a7d3a' : '#b8232f'}">${r.diferencia > 0 ? '+' : ''}${Number(r.diferencia).toFixed(2)} ${r.unidad}</span>
                </div>`
            )
            .join('')
        : '<div style="font-size:13px;color:#1a7d3a">✅ Sin diferencias</div>';

      return `
        <div style="background:white;border-radius:10px;padding:12px;margin-bottom:8px">
          <div style="font-size:12px;color:#888;margin-bottom:6px">${fechaHora} · ${c.resumen.length} insumo(s) contados</div>
          ${detalle}
        </div>`;
    })
    .join('');
}

// ==================== PLANEACIÓN DE COMPRAS ====================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('btn-generar-compras').addEventListener('click', generarPlanCompras);

async function generarPlanCompras() {
  const sucursal_id = document.getElementById('sucursal-select').value;
  const dias = document.getElementById('compras-dias').value || 7;
  const cont = document.getElementById('compras-resultado');
  const btn = document.getElementById('btn-generar-compras');

  btn.disabled = true;
  btn.textContent = 'Pensando...';
  cont.innerHTML = '<p style="text-align:center;padding:30px;color:#888">Analizando consumo e inventario, un momento...</p>';

  try {
    const resp = await fetch('/api/plan-compras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sucursal_id, dias }),
    });
    const data = await resp.json();

    if (!resp.ok) {
      cont.innerHTML = `<p style="color:#b8232f;padding:0 12px">${escapeHtml(data.error || 'No se pudo generar la sugerencia')}</p>`;
      return;
    }

    const tablaHtml = data.resumen.length
      ? `<table class="tabla-simple">
          <thead><tr><th>Insumo</th><th class="num">Consumo (${dias} días)</th><th class="num">Stock actual</th></tr></thead>
          <tbody>
            ${data.resumen
              .map(
                (r) => `
              <tr>
                <td>${escapeHtml(r.nombre)}</td>
                <td class="num">${Number(r.consumo).toFixed(2)} ${escapeHtml(r.unidad)}</td>
                <td class="num">${Number(r.stock_actual).toFixed(2)} ${escapeHtml(r.unidad)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`
      : '';

    cont.innerHTML = `
      ${tablaHtml}
      <div style="background:white;margin:0 12px 16px;padding:16px;border-radius:10px;white-space:pre-wrap;font-size:14px;line-height:1.6">
        <strong>Sugerencia de Claude:</strong><br><br>${escapeHtml(data.sugerencia)}
      </div>`;
  } catch (err) {
    cont.innerHTML = '<p style="color:#b8232f;padding:0 12px">No se pudo conectar. Revisa tu internet e intenta otra vez.</p>';
  } finally {
    btn.disabled = false;
    btn.textContent = '🧠 Generar sugerencia';
  }
}

// ==================== MENÚ: PRODUCTOS E INSUMOS ====================

document.querySelectorAll('[data-submenu]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-submenu]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const esProductos = btn.dataset.submenu === 'productos';
    document.getElementById('vista-menu-productos').style.display = esProductos ? 'block' : 'none';
    document.getElementById('vista-menu-insumos').style.display = esProductos ? 'none' : 'block';
    if (!esProductos) cargarInsumosAdmin();
  });
});

async function cargarMenuAdmin() {
  await recargarCategoriasYProductos();
  renderSelectCategoriasAdmin();
  renderCategoriasAdmin();
  renderProductosAdmin();
}

async function recargarCategoriasYProductos() {
  state.categorias = await fetch('/api/categorias').then((r) => r.json());
  state.productos = await fetch('/api/productos?todos=true').then((r) => r.json());
}

function renderSelectCategoriasAdmin() {
  document.getElementById('nuevo-prod-categoria').innerHTML = state.categorias
    .map((c) => `<option value="${c.id}">${c.nombre}</option>`)
    .join('');
}

function renderCategoriasAdmin() {
  document.getElementById('categorias-admin-tabla-body').innerHTML = state.categorias
    .map(
      (c) => `
    <tr>
      <td><input type="text" class="categoria-nombre-edit" data-id="${c.id}" value="${c.nombre}" style="width:100%;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td style="white-space:nowrap">
        <button class="btn-eliminar-fila" data-guardar-categoria="${c.id}" title="Guardar">💾</button>
        <button class="btn-eliminar-fila" data-borrar-categoria="${c.id}" title="Borrar">🗑️</button>
      </td>
    </tr>`
    )
    .join('');

  document.querySelectorAll('[data-guardar-categoria]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nombre = document.querySelector(`.categoria-nombre-edit[data-id="${btn.dataset.guardarCategoria}"]`).value.trim();
      await fetch(`/api/categorias/${btn.dataset.guardarCategoria}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre }),
      });
      await recargarCategoriasYProductos();
      renderSelectCategoriasAdmin();
      renderCategoriasAdmin();
      renderProductosAdmin();
    });
  });
  document.querySelectorAll('[data-borrar-categoria]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar esta categoría?')) return;
      const resp = await fetch(`/api/categorias/${btn.dataset.borrarCategoria}`, { method: 'DELETE' });
      if (!resp.ok) {
        const err = await resp.json();
        alert(err.error || 'No se pudo borrar');
        return;
      }
      await recargarCategoriasYProductos();
      renderSelectCategoriasAdmin();
      renderCategoriasAdmin();
      renderProductosAdmin();
    });
  });
}

document.getElementById('btn-agregar-categoria').addEventListener('click', async () => {
  const nombre = document.getElementById('nueva-categoria-nombre').value.trim();
  if (!nombre) return;
  await fetch('/api/categorias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre }),
  });
  document.getElementById('nueva-categoria-nombre').value = '';
  await recargarCategoriasYProductos();
  renderSelectCategoriasAdmin();
  renderCategoriasAdmin();
  renderProductosAdmin();
});

document.getElementById('nuevo-prod-precio').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^0-9.]/g, '');
});

document.getElementById('btn-agregar-producto-admin').addEventListener('click', async () => {
  const nombre = document.getElementById('nuevo-prod-nombre').value.trim();
  const categoria_id = document.getElementById('nuevo-prod-categoria').value;
  const precio = document.getElementById('nuevo-prod-precio').value;
  if (!nombre || !categoria_id || !precio) {
    alert('Falta el nombre, categoría o precio');
    return;
  }
  await fetch('/api/productos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, categoria_id, precio }),
  });
  document.getElementById('nuevo-prod-nombre').value = '';
  document.getElementById('nuevo-prod-precio').value = '';
  await recargarCategoriasYProductos();
  renderProductosAdmin();
});

function renderProductosAdmin() {
  const categoriaPorId = {};
  state.categorias.forEach((c) => (categoriaPorId[c.id] = c.nombre));

  document.getElementById('productos-admin-tabla-body').innerHTML = state.productos
    .map(
      (p) => `
    <tr style="opacity:${p.disponible ? '1' : '0.5'}">
      <td>
        ${
          p.imagen
            ? `<img src="${p.imagen}" class="prod-thumb-img" data-id="${p.id}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;cursor:pointer" title="Cambiar foto" />`
            : `<button class="btn-eliminar-fila prod-thumb-btn" data-id="${p.id}" title="Subir foto" style="font-size:20px">📷</button>`
        }
        <input type="file" accept="image/*" class="prod-imagen-input" data-id="${p.id}" style="display:none" />
      </td>
      <td><input type="text" class="prod-admin-nombre" data-id="${p.id}" value="${p.nombre}" style="width:100%;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td>
        <select class="prod-admin-categoria" data-id="${p.id}" style="padding:6px;border-radius:6px;border:1px solid #ddd">
          ${state.categorias.map((c) => `<option value="${c.id}" ${c.id === p.categoria_id ? 'selected' : ''}>${c.nombre}</option>`).join('')}
        </select>
      </td>
      <td class="num"><input type="text" inputmode="decimal" class="prod-admin-precio" data-id="${p.id}" value="${p.precio}" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
      <td style="white-space:nowrap">
        <button class="btn-eliminar-fila" data-guardar="${p.id}" title="Guardar">💾</button>
        <button class="btn-eliminar-fila" data-toggle="${p.id}" title="${p.disponible ? 'Ocultar del menú' : 'Mostrar en el menú'}">${p.disponible ? '👁️' : '🚫'}</button>
        <button class="btn-eliminar-fila" data-receta="${p.id}" title="Receta">📋</button>
      </td>
    </tr>`
    )
    .join('');

  document.querySelectorAll('.prod-thumb-img, .prod-thumb-btn').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelector(`.prod-imagen-input[data-id="${el.dataset.id}"]`).click();
    });
  });
  document.querySelectorAll('.prod-imagen-input').forEach((input) => {
    input.addEventListener('change', () => subirImagenProducto(Number(input.dataset.id), input));
  });

  document.querySelectorAll('[data-guardar]').forEach((btn) => {
    btn.addEventListener('click', () => guardarProductoAdmin(Number(btn.dataset.guardar)));
  });
  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => toggleDisponibleAdmin(Number(btn.dataset.toggle)));
  });
  document.querySelectorAll('[data-receta]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalReceta(Number(btn.dataset.receta)));
  });
  document.querySelectorAll('.prod-admin-precio').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
    });
  });
}

async function subirImagenProducto(productoId, inputFile) {
  if (!inputFile.files.length) return;
  try {
    const dataUrl = await comprimirImagenADataURL(inputFile.files[0], 500, 0.78);
    await fetch(`/api/productos/${productoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagen: dataUrl }),
    });
    await recargarCategoriasYProductos();
    renderProductosAdmin();
  } catch (err) {
    alert('No se pudo subir la imagen: ' + (err.message || 'intenta de nuevo'));
  }
}

// Igual que comprimirImagenABase64, pero regresa el data URL completo
// (con el "data:image/jpeg;base64," incluido) para usarlo directo en <img src>.
async function comprimirImagenADataURL(archivo, maxDimension, calidad) {
  function escalar(width, height) {
    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round(height * (maxDimension / width));
        width = maxDimension;
      } else {
        width = Math.round(width * (maxDimension / height));
        height = maxDimension;
      }
    }
    return { width, height };
  }

  if (window.createImageBitmap) {
    try {
      const bitmap = await createImageBitmap(archivo);
      const { width, height } = escalar(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', calidad);
    } catch (err) {
      console.warn('createImageBitmap falló, probando con el método alterno:', err);
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const { width, height } = escalar(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.onerror = () => reject(new Error('El navegador no pudo abrir esta imagen'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(archivo);
  });
}

async function guardarProductoAdmin(productoId) {
  const nombre = document.querySelector(`.prod-admin-nombre[data-id="${productoId}"]`).value.trim();
  const categoria_id = document.querySelector(`.prod-admin-categoria[data-id="${productoId}"]`).value;
  const precio = document.querySelector(`.prod-admin-precio[data-id="${productoId}"]`).value;
  await fetch(`/api/productos/${productoId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, categoria_id, precio }),
  });
  await recargarCategoriasYProductos();
  renderProductosAdmin();
}

async function toggleDisponibleAdmin(productoId) {
  const producto = state.productos.find((p) => p.id === productoId);
  if (producto.disponible) {
    if (!confirm(`¿Ocultar "${producto.nombre}" del menú? Ya no se podrá pedir, pero se conserva en el historial.`)) return;
    await fetch(`/api/productos/${productoId}`, { method: 'DELETE' });
  } else {
    await fetch(`/api/productos/${productoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disponible: true }),
    });
  }
  await recargarCategoriasYProductos();
  renderProductosAdmin();
}

// ---------- Receta (insumos por producto) ----------

let insumosCatalogoCache = null;

async function abrirModalReceta(productoId) {
  const producto = state.productos.find((p) => p.id === productoId);
  insumosCatalogoCache = await fetch('/api/insumos').then((r) => r.json());
  const receta = await fetch(`/api/productos/${productoId}/receta`).then((r) => r.json());
  renderModalReceta(producto, receta);
}

function renderModalReceta(producto, receta) {
  const grupos = producto.grupos_modificadores || [];
  const gruposHtml = grupos
    .map(
      (g) => `
      <div class="modal-grupo" style="border:1px solid #eee;border-radius:8px;padding:10px;margin-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div class="modal-grupo-titulo" style="margin-bottom:0">${g.nombre} — ${g.tipo === 'variante' ? 'variante' : 'extra'}</div>
          <button class="btn-eliminar-fila btn-borrar-grupo" data-grupo-id="${g.id}" title="Borrar todo este grupo">🗑️ Grupo</button>
        </div>
        ${g.opciones
          .map(
            (op) => `
          <div class="editar-item-row" style="align-items:center">
            <input type="text" class="opcion-nombre-edit" data-opcion-id="${op.id}" value="${op.nombre}" style="flex:1;padding:5px;border-radius:6px;border:1px solid #ddd;margin-right:6px" />
            <span style="display:flex;align-items:center;gap:6px">
              $<input type="text" inputmode="decimal" class="opcion-precio-edit" data-opcion-id="${op.id}" value="${op.precio}" style="width:55px;padding:5px;border-radius:6px;border:1px solid #ddd;text-align:center" />
              ${
                g.tipo === 'variante'
                  ? `<input type="text" inputmode="decimal" class="opcion-multiplicador" data-opcion-id="${op.id}" value="${op.multiplicador ?? 1}" title="Multiplicador (piezas)" style="width:36px;padding:5px;border-radius:6px;border:1px solid #ddd;text-align:center" />`
                  : ''
              }
              <button class="btn-eliminar-fila btn-guardar-opcion" data-opcion-id="${op.id}" title="Guardar">💾</button>
              <button class="btn-eliminar-fila btn-insumos-opcion" data-opcion-id="${op.id}" title="Insumos extra">🧪</button>
              <button class="btn-eliminar-fila btn-borrar-opcion" data-opcion-id="${op.id}" title="Borrar opción">🗑️</button>
            </span>
          </div>`
          )
          .join('')}
        <div style="display:flex;gap:6px;margin-top:8px">
          <input type="text" class="nueva-opcion-nombre" data-grupo-id="${g.id}" placeholder="Nueva opción" style="flex:1;padding:6px;border-radius:6px;border:1px dashed #ccc" />
          <input type="text" inputmode="decimal" class="nueva-opcion-precio" data-grupo-id="${g.id}" placeholder="Precio" style="width:60px;padding:6px;border-radius:6px;border:1px dashed #ccc" />
          <button class="btn-eliminar-fila btn-agregar-opcion" data-grupo-id="${g.id}">+ Agregar</button>
        </div>
      </div>`
    )
    .join('');

  const html = `
    <div class="modal-overlay" id="modal-overlay-receta">
      <div class="modal-box">
        <h3>Receta y variantes — ${producto.nombre}</h3>
        <div style="font-size:12px;color:#888;margin-bottom:10px">Insumos que se gastan al vender <strong>1 pieza/unidad base</strong> (si el producto tiene variantes tipo "Orden", multiplícalo abajo, no aquí)</div>
        <div id="receta-items">
          ${
            receta
              .map(
                (r) => `
            <div class="editar-item-row">
              <span>${r.insumo_nombre} — ${Number(r.cantidad)} ${r.unidad}</span>
              <button data-insumo-id="${r.insumo_id}">×</button>
            </div>`
              )
              .join('') || '<p style="color:#999;font-size:13px">Sin insumos asignados todavía</p>'
          }
        </div>
        <div class="modal-grupo">
          <div class="modal-grupo-titulo">Agregar insumo a la receta base</div>
          <div style="display:flex;gap:8px">
            <select id="receta-insumo-select" style="flex:1;padding:8px;border-radius:6px;border:1px solid #ddd">
              ${insumosCatalogoCache.map((i) => `<option value="${i.id}">${i.nombre} (${i.unidad})</option>`).join('')}
            </select>
            <input type="text" inputmode="decimal" id="receta-cantidad" placeholder="Cantidad" style="width:90px;padding:8px;border-radius:6px;border:1px solid #ddd" />
          </div>
          <button class="btn-agregar" id="btn-agregar-insumo-receta" style="width:100%;margin-top:8px;padding:10px;border-radius:8px;border:none">+ Agregar a la receta</button>
        </div>

        <h3 style="margin-top:18px;font-size:15px">Variantes y extras</h3>
        ${gruposHtml || '<p style="color:#999;font-size:13px">Este producto no tiene variantes ni extras todavía</p>'}

        <div class="modal-grupo" style="border:1px dashed #ccc;border-radius:8px;padding:10px;margin-top:10px">
          <div class="modal-grupo-titulo">Agregar grupo nuevo (ej. "Presentación", "Extras")</div>
          <input type="text" id="nuevo-grupo-nombre" placeholder="Nombre del grupo" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ddd;margin-bottom:6px" />
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <select id="nuevo-grupo-tipo" style="flex:1;padding:8px;border-radius:6px;border:1px solid #ddd">
              <option value="variante">Variante (elige 1, reemplaza el precio)</option>
              <option value="extra">Extra (elige varios, se suma al precio)</option>
            </select>
            <label style="font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="nuevo-grupo-obligatorio" checked /> Obligatorio</label>
          </div>
          <button class="btn-agregar" id="btn-agregar-grupo" style="width:100%;padding:10px;border-radius:8px;border:none">+ Agregar grupo</button>
        </div>

        <button class="btn-cancelar-modal" id="btn-cerrar-receta">Cerrar</button>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;

  document.getElementById('modal-overlay-receta').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay-receta') document.getElementById('modal-container').innerHTML = '';
  });
  document.getElementById('btn-cerrar-receta').addEventListener('click', () => {
    document.getElementById('modal-container').innerHTML = '';
  });
  document.getElementById('receta-cantidad').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9.]/g, '');
  });
  document.querySelectorAll('#receta-items button[data-insumo-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/productos/${producto.id}/receta/${btn.dataset.insumoId}`, { method: 'DELETE' });
      const recetaNueva = await fetch(`/api/productos/${producto.id}/receta`).then((r) => r.json());
      renderModalReceta(producto, recetaNueva);
    });
  });
  document.getElementById('btn-agregar-insumo-receta').addEventListener('click', async () => {
    const insumo_id = document.getElementById('receta-insumo-select').value;
    const cantidad = document.getElementById('receta-cantidad').value;
    if (!insumo_id || !cantidad) {
      alert('Falta elegir el insumo o la cantidad');
      return;
    }
    await fetch(`/api/productos/${producto.id}/receta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insumo_id, cantidad }),
    });
    const recetaNueva = await fetch(`/api/productos/${producto.id}/receta`).then((r) => r.json());
    renderModalReceta(producto, recetaNueva);
  });

  // ---- Variantes y extras ----
  document.querySelectorAll('.opcion-multiplicador, .opcion-precio-edit').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
    });
  });
  document.querySelectorAll('.btn-guardar-opcion').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.opcionId;
      const nombre = document.querySelector(`.opcion-nombre-edit[data-opcion-id="${id}"]`).value.trim();
      const precio = document.querySelector(`.opcion-precio-edit[data-opcion-id="${id}"]`).value;
      const multEl = document.querySelector(`.opcion-multiplicador[data-opcion-id="${id}"]`);
      const body = { nombre, precio };
      if (multEl) body.multiplicador = multEl.value || 1;
      await fetch(`/api/opciones/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await refrescarProductoYRenderReceta(producto.id);
    });
  });
  document.querySelectorAll('.btn-borrar-opcion').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar esta opción?')) return;
      await fetch(`/api/opciones/${btn.dataset.opcionId}`, { method: 'DELETE' });
      await refrescarProductoYRenderReceta(producto.id);
    });
  });
  document.querySelectorAll('.btn-borrar-grupo').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este grupo completo, con todas sus opciones?')) return;
      await fetch(`/api/grupos/${btn.dataset.grupoId}`, { method: 'DELETE' });
      await refrescarProductoYRenderReceta(producto.id);
    });
  });
  document.querySelectorAll('.btn-agregar-opcion').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const grupoId = btn.dataset.grupoId;
      const nombre = document.querySelector(`.nueva-opcion-nombre[data-grupo-id="${grupoId}"]`).value.trim();
      const precio = document.querySelector(`.nueva-opcion-precio[data-grupo-id="${grupoId}"]`).value;
      if (!nombre || !precio) {
        alert('Falta el nombre o el precio de la opción');
        return;
      }
      await fetch(`/api/grupos/${grupoId}/opciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, precio }),
      });
      await refrescarProductoYRenderReceta(producto.id);
    });
  });
  document.querySelectorAll('.btn-insumos-opcion').forEach((btn) => {
    btn.addEventListener('click', () => {
      const opcionId = Number(btn.dataset.opcionId);
      let opcion = null;
      grupos.forEach((g) => {
        const encontrada = g.opciones.find((o) => o.id === opcionId);
        if (encontrada) opcion = encontrada;
      });
      abrirModalInsumosOpcion(producto, opcion);
    });
  });
  document.getElementById('btn-agregar-grupo').addEventListener('click', async () => {
    const nombre = document.getElementById('nuevo-grupo-nombre').value.trim();
    const tipo = document.getElementById('nuevo-grupo-tipo').value;
    const obligatorio = document.getElementById('nuevo-grupo-obligatorio').checked;
    if (!nombre) {
      alert('Falta el nombre del grupo');
      return;
    }
    await fetch(`/api/productos/${producto.id}/grupos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, tipo, obligatorio }),
    });
    await refrescarProductoYRenderReceta(producto.id);
  });
}

async function refrescarProductoYRenderReceta(productoId) {
  await recargarCategoriasYProductos();
  const productoActualizado = state.productos.find((p) => p.id === productoId);
  const recetaActual = await fetch(`/api/productos/${productoId}/receta`).then((r) => r.json());
  renderModalReceta(productoActualizado, recetaActual);
}

// ---------- Insumos extra por opción de variante/extra ----------

async function abrirModalInsumosOpcion(producto, opcion) {
  const insumosOpcion = await fetch(`/api/opciones/${opcion.id}/insumos`).then((r) => r.json());
  renderModalInsumosOpcion(producto, opcion, insumosOpcion);
}

function renderModalInsumosOpcion(producto, opcion, insumosOpcion) {
  const html = `
    <div class="modal-overlay" id="modal-overlay-insumos-opcion">
      <div class="modal-box">
        <h3>Insumos extra — ${opcion.nombre}</h3>
        <div style="font-size:12px;color:#888;margin-bottom:10px">Se suman aparte de la receta base cuando eligen esta opción</div>
        <div id="insumos-opcion-items">
          ${
            insumosOpcion
              .map(
                (r) => `
            <div class="editar-item-row">
              <span>${r.insumo_nombre} — ${Number(r.cantidad)} ${r.unidad}</span>
              <button data-insumo-id="${r.insumo_id}">×</button>
            </div>`
              )
              .join('') || '<p style="color:#999;font-size:13px">Sin insumos extra para esta opción</p>'
          }
        </div>
        <div class="modal-grupo">
          <div class="modal-grupo-titulo">Agregar insumo extra</div>
          <div style="display:flex;gap:8px">
            <select id="insumo-opcion-select" style="flex:1;padding:8px;border-radius:6px;border:1px solid #ddd">
              ${insumosCatalogoCache.map((i) => `<option value="${i.id}">${i.nombre} (${i.unidad})</option>`).join('')}
            </select>
            <input type="text" inputmode="decimal" id="insumo-opcion-cantidad" placeholder="Cantidad" style="width:90px;padding:8px;border-radius:6px;border:1px solid #ddd" />
          </div>
          <button class="btn-agregar" id="btn-agregar-insumo-opcion" style="width:100%;margin-top:8px;padding:10px;border-radius:8px;border:none">+ Agregar</button>
        </div>
        <button class="btn-cancelar-modal" id="btn-volver-receta">← Volver a la receta</button>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;

  document.getElementById('modal-overlay-insumos-opcion').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay-insumos-opcion') document.getElementById('modal-container').innerHTML = '';
  });
  document.getElementById('btn-volver-receta').addEventListener('click', () => abrirModalReceta(producto.id));
  document.getElementById('insumo-opcion-cantidad').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9.]/g, '');
  });
  document.querySelectorAll('#insumos-opcion-items button[data-insumo-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/opciones/${opcion.id}/insumos/${btn.dataset.insumoId}`, { method: 'DELETE' });
      const nueva = await fetch(`/api/opciones/${opcion.id}/insumos`).then((r) => r.json());
      renderModalInsumosOpcion(producto, opcion, nueva);
    });
  });
  document.getElementById('btn-agregar-insumo-opcion').addEventListener('click', async () => {
    const insumo_id = document.getElementById('insumo-opcion-select').value;
    const cantidad = document.getElementById('insumo-opcion-cantidad').value;
    if (!insumo_id || !cantidad) {
      alert('Falta elegir el insumo o la cantidad');
      return;
    }
    await fetch(`/api/opciones/${opcion.id}/insumos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insumo_id, cantidad }),
    });
    const nueva = await fetch(`/api/opciones/${opcion.id}/insumos`).then((r) => r.json());
    renderModalInsumosOpcion(producto, opcion, nueva);
  });
}

// ---------- Insumos (catálogo + stock por sucursal) ----------

async function cargarInsumosAdmin() {
  const sucursalId = document.getElementById('sucursal-select').value;
  const insumos = await fetch(`/api/insumos?sucursal_id=${sucursalId}`).then((r) => r.json());
  insumosCatalogoCache = insumos;
  renderInsumosAdmin(insumos);
}

function renderInsumosAdmin(insumos) {
  document.getElementById('insumos-tabla-body').innerHTML = insumos
    .map(
      (i) => `
    <tr>
      <td><input type="text" class="insumo-nombre" data-id="${i.id}" value="${i.nombre}" style="width:100%;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td><input type="text" class="insumo-unidad" data-id="${i.id}" value="${i.unidad}" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td class="num"><input type="text" inputmode="decimal" class="insumo-costo" data-id="${i.id}" value="${i.costo_unitario}" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
      <td class="num"><input type="text" inputmode="decimal" class="insumo-stock" data-id="${i.id}" value="${i.stock_actual}" style="width:80px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
      <td style="white-space:nowrap">
        <button class="btn-eliminar-fila" data-guardar-insumo="${i.id}" title="Guardar">💾</button>
        <button class="btn-eliminar-fila" data-borrar-insumo="${i.id}" title="Borrar">🗑️</button>
      </td>
    </tr>`
    )
    .join('') || '<tr><td colspan="5" style="text-align:center;color:#999">Sin insumos todavía</td></tr>';

  document.querySelectorAll('.insumo-costo, .insumo-stock').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
    });
  });
  document.querySelectorAll('[data-guardar-insumo]').forEach((btn) => {
    btn.addEventListener('click', () => guardarInsumoAdmin(Number(btn.dataset.guardarInsumo)));
  });
  document.querySelectorAll('[data-borrar-insumo]').forEach((btn) => {
    btn.addEventListener('click', () => borrarInsumoAdmin(Number(btn.dataset.borrarInsumo)));
  });
}

document.getElementById('nuevo-insumo-costo').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^0-9.]/g, '');
});

document.getElementById('btn-agregar-insumo').addEventListener('click', async () => {
  const nombre = document.getElementById('nuevo-insumo-nombre').value.trim();
  const unidad = document.getElementById('nuevo-insumo-unidad').value.trim();
  const costo_unitario = document.getElementById('nuevo-insumo-costo').value || 0;
  if (!nombre || !unidad) {
    alert('Falta el nombre o la unidad');
    return;
  }
  const resp = await fetch('/api/insumos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, unidad, costo_unitario }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    alert(err.error || 'No se pudo agregar el insumo');
    return;
  }
  document.getElementById('nuevo-insumo-nombre').value = '';
  document.getElementById('nuevo-insumo-unidad').value = '';
  document.getElementById('nuevo-insumo-costo').value = '';
  cargarInsumosAdmin();
});

async function guardarInsumoAdmin(insumoId) {
  const nombre = document.querySelector(`.insumo-nombre[data-id="${insumoId}"]`).value.trim();
  const unidad = document.querySelector(`.insumo-unidad[data-id="${insumoId}"]`).value.trim();
  const costo_unitario = document.querySelector(`.insumo-costo[data-id="${insumoId}"]`).value;
  const stock_actual = document.querySelector(`.insumo-stock[data-id="${insumoId}"]`).value;
  const sucursal_id = document.getElementById('sucursal-select').value;

  await fetch(`/api/insumos/${insumoId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, unidad, costo_unitario }),
  });
  await fetch(`/api/insumos/${insumoId}/stock`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sucursal_id, stock_actual }),
  });
  cargarInsumosAdmin();
}

async function borrarInsumoAdmin(insumoId) {
  if (!confirm('¿Borrar este insumo? También se quitará de las recetas que lo usen.')) return;
  await fetch(`/api/insumos/${insumoId}`, { method: 'DELETE' });
  insumosCatalogoCache = null;
  cargarInsumosAdmin();
}

// ==================== HISTORIAL DE PEDIDOS ====================

let filtroHistorial = 'todos';

document.getElementById('historial-fecha-desde').value = fechaNegocioActual();
document.getElementById('historial-fecha-hasta').value = fechaNegocioActual();
document.getElementById('btn-buscar-historial').addEventListener('click', () => {
  cargarHistorial();
  if (document.getElementById('resumen-toggle').classList.contains('abierto')) cargarResumenCaja();
});

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
  registrarPedidosEnCache(pedidos);
  cont.innerHTML = pedidos.map((p) => renderPedidoRow(p)).join('');
  cont.querySelectorAll('.pedido-row').forEach((el) => {
    el.addEventListener('click', () => abrirOverlayEditar(Number(el.dataset.id)));
  });
  conectarBotonesWhatsApp(cont);
}

// ==================== CONTACTAR CLIENTE POR WHATSAPP ====================

const pedidosCache = {};

function registrarPedidosEnCache(pedidos) {
  pedidos.forEach((p) => {
    pedidosCache[p.id] = p;
  });
}

function conectarBotonesWhatsApp(contenedor) {
  contenedor.querySelectorAll('.btn-whatsapp-row').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pedido = pedidosCache[Number(btn.dataset.id)];
      if (pedido) abrirWhatsAppCliente(pedido);
    });
  });
}

function construirMensajeWhatsApp(pedido) {
  const itemsActivos = (pedido.items || []).filter((it) => !it.cancelado);
  const itemsTexto = itemsActivos
    .map((it) => {
      const opciones = (it.opciones_seleccionadas || []).map((o) => o.nombre).join(', ');
      return `• ${it.cantidad}x ${it.producto_nombre}${opciones ? ` (${opciones})` : ''}`;
    })
    .join('\n');

  const subtotal = itemsActivos.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0);
  const envio = Number(pedido.costo_envio) || 0;
  const tipoLabel = TIPO_LABELS[pedido.tipo] || pedido.tipo;

  let mensaje = `Hola ${pedido.cliente_nombre || ''}, este es el resumen de tu pedido #${pedido.numero_dia ?? pedido.id} en El Nano:\n\n`;
  mensaje += `👤 Nombre: ${pedido.cliente_nombre || ''}\n`;
  mensaje += `📞 Teléfono: ${pedido.cliente_telefono || ''}\n`;
  if (pedido.tipo === 'domicilio') {
    mensaje += `📍 Dirección: ${pedido.cliente_direccion || '(pendiente de confirmar)'}${pedido.cliente_colonia ? ', ' + pedido.cliente_colonia : ''}\n`;
  }
  mensaje += `🧾 Tipo de pedido: ${tipoLabel}\n`;
  mensaje += `\nProductos:\n${itemsTexto}\n`;
  mensaje += `\nSubtotal productos: $${subtotal.toFixed(2)}`;
  if (envio > 0) {
    mensaje += `\n🛵 Costo de envío: $${envio.toFixed(2)}`;
  }
  mensaje += `\nTotal: $${Number(pedido.total).toFixed(2)}`;

  if (pedido.tipo === 'domicilio' && !pedido.cliente_direccion) {
    mensaje += `\n\n¿Nos confirmas tu dirección completa para el envío?`;
  } else {
    mensaje += `\n\n¿Todo correcto?`;
  }
  return mensaje;
}

async function finalizarPedido(pedido) {
  const avisoPago = pedido.pagado ? '' : '\n\n⚠️ Este pedido todavía no está cobrado — ¿de verdad quieres finalizarlo sin cobrar?';
  if (!confirm(`¿Finalizar el pedido #${pedido.numero_dia ?? pedido.id}? Ya no se podrá editar después.${avisoPago}`)) return;

  await fetch(`/api/pedidos/${pedido.id}/finalizar`, { method: 'PATCH' });

  cerrarOverlayPedido();
}

async function pedirResena(pedido) {
  const boton = document.getElementById('btn-pedir-resena');
  boton.disabled = true;
  try {
    const { token } = await fetch(`/api/pedidos/${pedido.id}/generar-link-resena`, { method: 'POST' }).then((r) => r.json());
    const url = `${window.location.origin}/resena?token=${token}`;

    let numero = (pedido.cliente_telefono || '').replace(/\D/g, '');
    if (numero.length === 10) numero = '52' + numero;

    const mensaje = `¡Hola ${pedido.cliente_nombre || ''}! Gracias por tu pedido #${pedido.numero_dia ?? pedido.id} en El Nano 🌮 ¿Nos regalas 30 segundos para contarnos qué tal estuvo?\n\n${url}`;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, '_blank');
  } catch (err) {
    alert('No se pudo generar el link de reseña, intenta de nuevo.');
  } finally {
    boton.disabled = false;
  }
}

function abrirWhatsAppCliente(pedido) {
  if (!pedido.cliente_telefono) {
    alert('Este pedido no tiene teléfono registrado.');
    return;
  }
  let numero = pedido.cliente_telefono.replace(/\D/g, '');
  if (numero.length === 10) numero = '52' + numero; // agrega código de país de México si hace falta
  const mensaje = construirMensajeWhatsApp(pedido);
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, '_blank');
}

// Registra el service worker para que Android/Chrome ofrezca "Instalar app"
// y así abra en pantalla completa, sin la barra del navegador.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
