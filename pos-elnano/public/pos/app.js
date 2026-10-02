const TIPO_LABELS = { mesa: 'Mesa', para_llevar: 'Para llevar', domicilio: 'Domicilio' };

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


// ==================== MODO OSCURO ====================
function aplicarModoOscuro(activo) {
  document.body.classList.toggle('dark', activo);
  document.getElementById('btn-modo-oscuro').textContent = activo ? '☀️' : '🌙';
}
aplicarModoOscuro(localStorage.getItem('elnano_modo_oscuro') === 'true');
document.getElementById('btn-modo-oscuro').addEventListener('click', () => {
  const activo = !document.body.classList.contains('dark');
  aplicarModoOscuro(activo);
  localStorage.setItem('elnano_modo_oscuro', activo);
});

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

  // El menú (categorías/productos) es independiente por sucursal, así que se carga
  // hasta aquí, ya con la sucursal resuelta.
  state.categorias = await fetch(`/api/categorias?sucursal_id=${select.value}`).then((r) => r.json());
  state.productos = await fetch(`/api/productos?sucursal_id=${select.value}`).then((r) => r.json());

  select.addEventListener('change', async () => {
    localStorage.setItem('elnano_sucursal_id', select.value);
    state.envios = await fetch(`/api/envios?sucursal_id=${select.value}`).then((r) => r.json());
    state.categorias = await fetch(`/api/categorias?sucursal_id=${select.value}`).then((r) => r.json());
    state.productos = await fetch(`/api/productos?sucursal_id=${select.value}`).then((r) => r.json());
    state.categoriaActivaOverlay = state.categorias[0]?.id ?? null;
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
  const badgeRepartidor =
    pedido.tipo === 'domicilio' && pedido.repartidor_nombre
      ? `<span class="badge" style="background:${pedido.entrega_liquidada ? '#d4edda' : '#e7f3ff'};color:${pedido.entrega_liquidada ? '#1a7d3a' : '#0056b3'}">🛵 ${escapeHtml(pedido.repartidor_nombre)}${pedido.entrega_liquidada ? ' ✅' : ''}</span>`
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
        <span>${badgeRepartidor} ${badgeCocina} ${badgeEstado}</span>
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

  const btnCambiarTipo = document.getElementById('btn-cambiar-tipo');
  btnCambiarTipo.style.display = !ticketState.soloLectura ? 'block' : 'none';
  btnCambiarTipo.onclick = () => abrirModalCambiarTipo(pedido);

  actualizarZonaEnvio(pedido);

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
  abrirModalModificadores(producto, grupos, onAgregar);
}

// ---------- Carrito local (modo "nuevo") ----------

function agregarAlCarritoTicket(item) {
  const clave = item.producto_id + '|' + JSON.stringify(item.opciones_seleccionadas) + '|' + (item.notas || '');
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
      notas: item.notas || null,
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
            <span>${it.cantidad}x ${it.nombre}${detalle ? `<br><small>${detalle}</small>` : ''}${it.notas ? `<br><small style="color:#a97800">📝 ${escapeHtml(it.notas)}</small>` : ''}</span>
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
            <span>${it.cantidad}x ${it.producto_nombre}${detalle ? `<br><small>${detalle}</small>` : ''}${it.notas ? `<br><small style="color:#a97800">📝 ${escapeHtml(it.notas)}</small>` : ''}</span>
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
    notas: it.notas || null,
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

const etiquetasCache = {};
let repartidoresCache = null;

async function abrirModalModificadores(producto, grupos, onAgregar) {
  onAgregar =
    onAgregar ||
    function (item) {
      agregarAlCarritoTicket(item);
    };

  if (!etiquetasCache[producto.categoria_id]) {
    etiquetasCache[producto.categoria_id] = await fetch(`/api/etiquetas?categoria_id=${producto.categoria_id}`).then((r) => r.json());
  }
  const etiquetas = etiquetasCache[producto.categoria_id];
  const etiquetasElegidas = new Set();
  let comentarioLibre = '';

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
          <div class="modal-grupo">
              <div class="modal-grupo-titulo">Comentarios (opcional)</div>
              ${etiquetas
                .map(
                  (et) => `
                <div class="modal-opcion etiqueta-chip ${etiquetasElegidas.has(et.id) ? 'selected' : ''}" data-etiqueta="${et.id}">
                  <span>${escapeHtml(et.texto)}</span>
                </div>`
                )
                .join('')}
              <input type="text" id="modal-comentario-libre" placeholder="Otro comentario..." value="${comentarioLibre}" style="width:100%;padding:9px;border-radius:8px;border:1px solid #ddd;margin-top:6px" />
            </div>
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
    document.querySelectorAll('.etiqueta-chip').forEach((el) => {
      el.addEventListener('click', () => {
        const etId = Number(el.dataset.etiqueta);
        comentarioLibre = document.getElementById('modal-comentario-libre').value; // no perder lo escrito
        if (etiquetasElegidas.has(etId)) etiquetasElegidas.delete(etId);
        else etiquetasElegidas.add(etId);
        render();
      });
    });
    document.getElementById('modal-comentario-libre').addEventListener('input', (e) => {
      comentarioLibre = e.target.value;
    });
    document.querySelectorAll('.modal-opcion:not(.etiqueta-chip)').forEach((el) => {
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
        notas:
          [...etiquetasElegidas]
            .map((id) => etiquetas.find((et) => et.id === id)?.texto)
            .filter(Boolean)
            .concat(document.getElementById('modal-comentario-libre').value.trim() ? [document.getElementById('modal-comentario-libre').value.trim()] : [])
            .join(', ') || null,
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


document.getElementById('btn-cerrar-historial').addEventListener('click', () => document.getElementById('overlay-historial').classList.remove('abierto'));


document.getElementById('btn-cerrar-corte').addEventListener('click', () => document.getElementById('overlay-corte').classList.remove('abierto'));


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

  editandoCorteExistente = false;
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

let editandoCorteExistente = false;

function renderCuadreCaja() {
  const cont = document.getElementById('cuadre-caja');

  if (corteCerradoActual && !editandoCorteExistente) {
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
      </table>
      <div class="resumen-total" style="color:#5a2ca0"><span>🛵 Ventas DiDi (manual)</span><span>$${Number(corteCerradoActual.ventas_didi || 0).toFixed(2)}</span></div>
      <button id="btn-editar-corte-cerrado" style="margin:0 12px 16px;width:calc(100% - 24px);padding:12px;border-radius:8px;border:1px solid #0056b3;background:white;color:#0056b3;font-weight:700;cursor:pointer">✏️ Editar este corte (por si se capturó mal)</button>`;

    document.getElementById('btn-editar-corte-cerrado').addEventListener('click', () => {
      editandoCorteExistente = true;
      renderCuadreCaja();
    });
    return;
  }

  // Si se está corrigiendo un corte ya cerrado, los campos se prellenan con lo que ya
  // se había capturado, en vez de empezar en blanco.
  const contadoPrevio = {};
  let ventasDidiPrevio = '';
  if (corteCerradoActual) {
    corteCerradoActual.resumen.forEach((r) => {
      contadoPrevio[r.metodo] = r.contado;
    });
    ventasDidiPrevio = corteCerradoActual.ventas_didi || '';
  }

  cont.innerHTML = `
    ${editandoCorteExistente ? '<div style="margin:0 12px 10px;padding:10px;background:#fff3cd;color:#7a5c00;border-radius:8px;font-size:13px">✏️ Corrigiendo un corte que ya estaba cerrado — al guardar, reemplaza lo que había antes.</div>' : ''}
    <table class="tabla-simple">
      <thead><tr><th>Método</th><th class="num">Debe haber</th><th class="num">Contado</th></tr></thead>
      <tbody>
        ${corteActual.resumen
          .map(
            (r) => `
          <tr>
            <td>${METODO_LABELS[r.metodo]}</td>
            <td class="num">$${r.neto.toFixed(2)}</td>
            <td class="num"><input type="text" inputmode="decimal" class="input-contado" data-metodo="${r.metodo}" placeholder="0.00" value="${contadoPrevio[r.metodo] ?? ''}" style="width:90px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:right" /></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
    <div style="display:flex;align-items:center;gap:8px;margin:0 12px 16px;padding:12px;background:#f3ecfa;border-radius:10px">
      <span style="font-size:13px;color:#5a2ca0;font-weight:600;flex:1">🛵 Ventas DiDi de hoy (captúralo tú, no está integrado todavía)</span>
      <input type="text" inputmode="decimal" id="input-ventas-didi" placeholder="0.00" value="${ventasDidiPrevio}" style="width:100px;padding:8px;border-radius:6px;border:1px solid #ddd;text-align:right" />
    </div>
    <button id="btn-cerrar-corte-accion" class="btn-nuevo-pedido" style="margin:0 12px 16px;width:calc(100% - 24px);background:#1a7d3a">${editandoCorteExistente ? 'Guardar corrección' : 'Cerrar corte'}</button>
    ${editandoCorteExistente ? '<button id="btn-cancelar-edicion-corte" style="margin:0 12px 16px;width:calc(100% - 24px);padding:10px;border-radius:8px;border:1px solid #999;background:white;color:#555;cursor:pointer">Cancelar</button>' : ''}`;

  document.getElementById('input-ventas-didi').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9.]/g, '');
  });
  document.querySelectorAll('.input-contado').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
    });
  });
  document.getElementById('btn-cerrar-corte-accion').addEventListener('click', cerrarCorte);
  if (editandoCorteExistente) {
    document.getElementById('btn-cancelar-edicion-corte').addEventListener('click', () => {
      editandoCorteExistente = false;
      renderCuadreCaja();
    });
  }
}

async function cerrarCorte() {
  const sucursal_id = document.getElementById('sucursal-select').value;
  const fecha = document.getElementById('corte-fecha').value;
  const contado = {};
  document.querySelectorAll('.input-contado').forEach((el) => {
    contado[el.dataset.metodo] = Number(el.value) || 0;
  });
  const ventas_didi = Number(document.getElementById('input-ventas-didi').value) || 0;

  const mensajeConfirmacion = editandoCorteExistente
    ? '¿Guardar la corrección de este corte? Reemplaza los montos contados que había antes.'
    : '¿Cerrar el corte del día? Ya no vas a poder registrar más gastos para esta fecha.';
  if (!confirm(mensajeConfirmacion)) return;

  const btn = document.getElementById('btn-cerrar-corte-accion');
  btn.disabled = true;
  btn.textContent = editandoCorteExistente ? 'Guardando...' : 'Cerrando...';

  await fetch('/api/corte/cerrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sucursal_id, fecha, contado, ventas_didi }),
  });

  editandoCorteExistente = false;
  cargarCorte();
}

// ==================== PERMISOS SEGÚN PUESTO ====================

const DRAWER_SOLO_ENCARGADO = [];
const DRAWER_CAJERO_O_ENCARGADO = ['btn-abrir-corte', 'btn-ir-admin'];

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

// ==================== TIEMPO REAL: refresca sola cuando llega un pedido (ej. de la web) ====================

const socketPos = io();
let sonidoAvisoWebListo = false;

function unirseASalaSucursal() {
  const sucursalId = document.getElementById('sucursal-select').value;
  if (sucursalId) socketPos.emit('join_sucursal', sucursalId);
}
socketPos.on('connect', unirseASalaSucursal);
document.getElementById('sucursal-select').addEventListener('change', unirseASalaSucursal);

// Los navegadores bloquean el sonido hasta que el usuario toca algo en la página — se
// desbloquea solo, en la primera interacción, para que la campanita sí suene de verdad
// cuando llegue un pedido después.
let audioCtxPos = null;
function obtenerAudioContextPos() {
  if (!audioCtxPos) audioCtxPos = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtxPos.state === 'suspended') audioCtxPos.resume();
  return audioCtxPos;
}
document.addEventListener('click', () => obtenerAudioContextPos(), { once: true });

function reproducirCampanitaPos() {
  try {
    const ctx = obtenerAudioContextPos();
    const ahora = ctx.currentTime;
    [{ freq: 880, inicio: 0 }, { freq: 660, inicio: 0.16 }].forEach(({ freq, inicio }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ahora + inicio);
      gain.gain.exponentialRampToValueAtTime(0.22, ahora + inicio + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ahora + inicio + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ahora + inicio);
      osc.stop(ahora + inicio + 0.4);
    });
  } catch (e) {}
}

// Mientras haya pedidos nuevos sin "Aceptar", la campanita se repite cada pocos segundos
// (nada agresivo, pero sí constante) hasta que alguien la reconoce.
let pedidosNuevosSinAceptar = [];
let intervaloCampanitaPos = null;

function renderBannerNuevoPedido() {
  const banner = document.getElementById('banner-nuevo-pedido');
  if (!pedidosNuevosSinAceptar.length) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'flex';
  const n = pedidosNuevosSinAceptar.length;
  document.getElementById('banner-nuevo-pedido-texto').textContent =
    n === 1
      ? `🔔 Nuevo pedido #${pedidosNuevosSinAceptar[0].numero_dia ?? pedidosNuevosSinAceptar[0].id}`
      : `🔔 ${n} pedidos nuevos`;
}

function avisarNuevoPedidoPos(pedido) {
  pedidosNuevosSinAceptar.push(pedido);
  renderBannerNuevoPedido();
  reproducirCampanitaPos();
  if (!intervaloCampanitaPos) {
    intervaloCampanitaPos = setInterval(reproducirCampanitaPos, 4000);
  }
}

document.getElementById('btn-aceptar-nuevo-pedido').addEventListener('click', () => {
  pedidosNuevosSinAceptar = [];
  renderBannerNuevoPedido();
  if (intervaloCampanitaPos) {
    clearInterval(intervaloCampanitaPos);
    intervaloCampanitaPos = null;
  }
});

socketPos.on('nuevo_pedido', (pedido) => {
  avisarNuevoPedidoPos(pedido);
  cargarPedidosYContar();
  if (document.getElementById('overlay-historial').classList.contains('abierto')) cargarHistorial();
});

socketPos.on('pedido_actualizado', () => {
  cargarPedidosYContar();
  if (document.getElementById('overlay-historial').classList.contains('abierto')) cargarHistorial();
});

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

async function actualizarZonaEnvio(pedido) {
  const cont = document.getElementById('ticket-envio-domicilio');
  if (pedido.tipo !== 'domicilio' || pedido.cancelado) {
    cont.style.display = 'none';
    return;
  }
  cont.style.display = 'block';

  const zonaSinAsignar = document.getElementById('envio-domicilio-sin-asignar');
  const zonaAsignado = document.getElementById('envio-domicilio-asignado');

  if (pedido.repartidor_id) {
    zonaSinAsignar.style.display = 'none';
    zonaAsignado.style.display = 'block';
    const cambioTxt = pedido.cambio_entregado != null ? ` · cambio entregado: $${Number(pedido.cambio_entregado).toFixed(2)}` : '';
    document.getElementById('envio-asignado-texto').innerHTML = pedido.entrega_liquidada
      ? `✅ <strong>Liquidado</strong> — se lo llevó ${escapeHtml(pedido.repartidor_nombre || '')}${cambioTxt}`
      : `🛵 Se lo llevó <strong>${escapeHtml(pedido.repartidor_nombre || '')}</strong>${cambioTxt} — sigue en la calle`;
    const btnLiquidar = document.getElementById('btn-liquidar-entrega');
    btnLiquidar.style.display = pedido.entrega_liquidada || ticketState.soloLectura || state.empleado?.puesto === 'mesero' ? 'none' : 'block';
    btnLiquidar.onclick = async () => {
      const registrarGasto = pedido.costo_envio > 0 ? confirm(`¿Registrar automáticamente un gasto de $${Number(pedido.costo_envio).toFixed(2)} por el pago del envío a ${pedido.repartidor_nombre}?`) : false;
      await fetch(`/api/pedidos/${pedido.id}/liquidar-entrega`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrar_gasto_envio: registrarGasto }),
      });
      await refrescarPedidoEditando();
      actualizarZonaEnvio(ticketState.pedidoData);
    };
    return;
  }

  zonaAsignado.style.display = 'none';
  if (ticketState.soloLectura) {
    zonaSinAsignar.style.display = 'none';
    return;
  }
  zonaSinAsignar.style.display = 'block';

  if (!repartidoresCache) {
    repartidoresCache = await fetch('/api/repartidores').then((r) => r.json());
  }
  document.getElementById('envio-repartidor-select').innerHTML =
    '<option value="">Elige repartidor</option>' + repartidoresCache.map((r) => `<option value="${r.id}">${r.nombre}</option>`).join('');

  const pagaConInput = document.getElementById('envio-paga-con');
  const cambioSpan = document.getElementById('envio-cambio-calculado');
  pagaConInput.oninput = () => {
    const monto = Number(pagaConInput.value) || 0;
    const cambio = monto - Number(pedido.total);
    cambioSpan.textContent = monto && cambio >= 0 ? `Cambio: $${cambio.toFixed(2)}` : '';
  };

  document.getElementById('btn-enviar-whatsapp-grupo').onclick = () => {
    const mensaje = construirMensajeEnvioGrupo(pedido, Number(pagaConInput.value) || 0);
    window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
  };

  document.getElementById('btn-asignar-repartidor').onclick = async () => {
    const repartidorId = document.getElementById('envio-repartidor-select').value;
    if (!repartidorId) {
      alert('Elige un repartidor primero');
      return;
    }
    await fetch(`/api/pedidos/${pedido.id}/asignar-repartidor`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repartidor_id: repartidorId, monto_recibido_cliente: Number(pagaConInput.value) || null }),
    });
    await refrescarPedidoEditando();
    actualizarZonaEnvio(ticketState.pedidoData);
  };
}

function construirMensajeEnvioGrupo(pedido, pagaCon) {
  const itemsActivos = (pedido.items || []).filter((it) => !it.cancelado);
  const itemsTexto = itemsActivos
    .map((it) => {
      const opciones = (it.opciones_seleccionadas || []).map((o) => o.nombre).join(', ');
      const nota = it.notas ? ` [${it.notas}]` : '';
      return `• ${it.cantidad}x ${it.producto_nombre}${opciones ? ` (${opciones})` : ''}${nota}`;
    })
    .join('\n');

  let mensaje = `🛵 PEDIDO A DOMICILIO #${pedido.numero_dia ?? pedido.id}\n\n`;
  mensaje += `👤 ${pedido.cliente_nombre || ''}\n`;
  mensaje += `📞 ${pedido.cliente_telefono || ''}\n`;
  mensaje += `📍 ${pedido.cliente_direccion || ''}${pedido.cliente_colonia ? ', ' + pedido.cliente_colonia : ''}\n\n`;
  mensaje += `${itemsTexto}\n\n`;
  mensaje += `Total: $${Number(pedido.total).toFixed(2)}`;
  if (pagaCon > 0) {
    const cambio = Math.max(0, pagaCon - Number(pedido.total));
    mensaje += `\n💵 Paga con: $${pagaCon.toFixed(2)} — dar $${cambio.toFixed(2)} de cambio`;
  }
  return mensaje;
}

async function abrirModalCambiarTipo(pedido) {
  const envios = await fetch(`/api/envios?sucursal_id=${pedido.sucursal_id}`).then((r) => r.json());

  const html = `
    <div class="modal-overlay" id="modal-overlay-tipo">
      <div class="modal-box">
        <h3>Cambiar tipo de pedido</h3>
        <div style="font-size:13px;color:#888;margin-bottom:10px">Actual: ${TIPO_LABELS[pedido.tipo] || pedido.tipo}</div>
        <div class="modal-grupo">
          <div class="modal-opcion" data-tipo="mesa">🍽️ En el local (mesa)</div>
          <div class="modal-opcion" data-tipo="para_llevar">🥡 Para llevar</div>
          <div class="modal-opcion" data-tipo="domicilio">🛵 A domicilio</div>
        </div>
        <div id="tipo-campos-domicilio" style="display:none;margin-top:10px">
          <select id="tipo-colonia-select" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;margin-bottom:8px">
            <option value="">Selecciona colonia</option>
            ${envios.map((e) => `<option value="${e.colonia}">${e.colonia} — $${Number(e.costo).toFixed(2)}</option>`).join('')}
          </select>
          <input type="text" id="tipo-direccion-input" placeholder="Dirección (calle, número, referencias)" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd" value="${pedido.cliente_direccion || ''}" />
        </div>
        <div id="tipo-status" style="color:#b8232f;font-size:13px;margin-top:8px"></div>
        <div class="modal-botones" style="margin-top:14px">
          <button class="btn-cancelar" id="btn-cerrar-tipo">Cancelar</button>
          <button class="btn-agregar" id="btn-confirmar-tipo" disabled>Confirmar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;

  let tipoElegido = null;

  document.getElementById('modal-overlay-tipo').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay-tipo') document.getElementById('modal-container').innerHTML = '';
  });
  document.getElementById('btn-cerrar-tipo').addEventListener('click', () => {
    document.getElementById('modal-container').innerHTML = '';
  });
  document.querySelectorAll('#modal-overlay-tipo .modal-opcion').forEach((el) => {
    el.addEventListener('click', () => {
      tipoElegido = el.dataset.tipo;
      document.querySelectorAll('#modal-overlay-tipo .modal-opcion').forEach((o) => o.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('tipo-campos-domicilio').style.display = tipoElegido === 'domicilio' ? 'block' : 'none';
      document.getElementById('btn-confirmar-tipo').disabled = false;
    });
  });
  document.getElementById('btn-confirmar-tipo').addEventListener('click', async () => {
    const statusEl = document.getElementById('tipo-status');
    const colonia = document.getElementById('tipo-colonia-select').value;
    const direccion = document.getElementById('tipo-direccion-input').value.trim();
    if (tipoElegido === 'domicilio' && !colonia) {
      statusEl.textContent = 'Elige la colonia para calcular el envío.';
      return;
    }
    const resp = await fetch(`/api/pedidos/${pedido.id}/tipo`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: tipoElegido, colonia, direccion }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = err.error || 'No se pudo cambiar';
      return;
    }
    document.getElementById('modal-container').innerHTML = '';
    await refrescarPedidoEditando();
    renderTicketPanel();
    const pedidoActualizado = ticketState.pedidoData;
    document.getElementById('overlay-titulo').textContent = `Pedido #${pedidoActualizado.numero_dia ?? pedidoActualizado.id}`;
    const direccionEl = document.getElementById('ticket-direccion-display');
    if (pedidoActualizado.cliente_direccion || pedidoActualizado.cliente_colonia) {
      direccionEl.textContent = `📍 ${pedidoActualizado.cliente_direccion || ''}${pedidoActualizado.cliente_colonia ? ', ' + pedidoActualizado.cliente_colonia : ''}`;
      direccionEl.style.display = 'block';
    } else {
      direccionEl.style.display = 'none';
    }
    actualizarZonaEnvio(pedidoActualizado);
  });
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

// ==================== AUTOCOMPLETAR CLIENTE POR TELÉFONO ====================

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

// ==================== NAVEGACIÓN A COCINA Y ADMINISTRACIÓN ====================

document.getElementById('btn-ir-kds').addEventListener('click', () => {
  const sucursalActual = state.sucursales.find((s) => String(s.id) === document.getElementById('sucursal-select').value);
  const slug = sucursalActual ? normalizarSlug(sucursalActual.nombre) : '';
  window.location.href = slug ? `/kds?sucursal=${slug}` : '/kds';
});

document.getElementById('btn-ir-admin').addEventListener('click', () => {
  const sucursalActual = state.sucursales.find((s) => String(s.id) === document.getElementById('sucursal-select').value);
  const slug = sucursalActual ? normalizarSlug(sucursalActual.nombre) : '';
  window.location.href = slug ? `/admin?sucursal=${slug}` : '/admin';
});

cargarInicial();
