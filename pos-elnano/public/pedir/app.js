const CATEGORIA_EMOJI = {
  'Bistec y Gueros': '🌮',
  'Volcanes y Piratas': '🌋',
  'Burritos y Tortas': '🌯',
  Combos: '🍽️',
  Complementos: '🍟',
  'Nano Smash': '🍔',
  Bebidas: '🥤',
};

const state = {
  sucursales: [],
  categorias: [],
  productos: [],
  envios: [],
  recompensas: [],
  categoriaActiva: null,
  tipo: null,
  carrito: [],
  costoEnvio: 0,
  clienteDetectado: null,
  recompensaElegidaId: null,
};

function normalizarSlug(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function cargarInicial() {
  state.sucursales = await fetch('/api/sucursales').then((r) => r.json());

  const select = document.getElementById('sucursal-select');
  select.innerHTML = state.sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');
  select.addEventListener('change', async () => {
    state.envios = await fetch(`/api/envios?sucursal_id=${select.value}`).then((r) => r.json());
    renderColoniaOptions();
    state.categorias = await fetch(`/api/categorias?sucursal_id=${select.value}`).then((r) => r.json());
    state.productos = await fetch(`/api/productos?sucursal_id=${select.value}`).then((r) => r.json());
    state.categoriaActiva = state.categorias[0]?.id ?? null;
    renderCatTabs();
    renderProductos();
  });

  // Si el link trae ?sucursal=santa-maria (o el id numérico), se fija esa sucursal
  // y se oculta el selector, para que el cliente no pueda mandar el pedido a la otra.
  const params = new URLSearchParams(window.location.search);
  const sucursalParam = params.get('sucursal');
  if (sucursalParam) {
    const encontrada = state.sucursales.find(
      (s) => normalizarSlug(s.nombre) === sucursalParam.toLowerCase() || String(s.id) === sucursalParam
    );
    if (encontrada) {
      select.value = encontrada.id;
      select.style.display = 'none';
      const fijaEl = document.getElementById('sucursal-fija');
      fijaEl.textContent = '📍 ' + encontrada.nombre;
      fijaEl.style.display = 'block';
    }
  }

  // El menú (categorías/productos) es independiente por sucursal — se carga hasta
  // aquí, ya con la sucursal resuelta.
  state.categorias = await fetch(`/api/categorias?sucursal_id=${select.value}`).then((r) => r.json());
  state.productos = await fetch(`/api/productos?sucursal_id=${select.value}`).then((r) => r.json());

  state.envios = await fetch(`/api/envios?sucursal_id=${select.value}`).then((r) => r.json());
  renderColoniaOptions();

  state.categoriaActiva = state.categorias[0]?.id ?? null;
  renderCatTabs();
  renderProductos();
}

function renderCatTabs() {
  const cont = document.getElementById('cat-tabs');
  cont.innerHTML = state.categorias
    .map((c) => `<div class="cat-tab ${c.id === state.categoriaActiva ? 'active' : ''}" data-id="${c.id}">${CATEGORIA_EMOJI[c.nombre] || '🍴'} ${c.nombre}</div>`)
    .join('');
  cont.querySelectorAll('.cat-tab').forEach((el) => {
    el.addEventListener('click', () => {
      state.categoriaActiva = Number(el.dataset.id);
      renderCatTabs();
      renderProductos();
    });
  });
}

function renderProductos() {
  const cont = document.getElementById('productos-grid');
  const categoriaPorId = {};
  state.categorias.forEach((c) => (categoriaPorId[c.id] = c.nombre));
  const lista = state.productos.filter((p) => p.categoria_id === state.categoriaActiva);

  cont.innerHTML = lista
    .map(
      (p) => `
      <div class="prod-card" data-id="${p.id}">
        ${
          p.imagen
            ? `<img src="${p.imagen}" style="width:100%;height:80px;object-fit:cover;border-radius:8px;margin-bottom:8px" />`
            : `<div class="emoji">${CATEGORIA_EMOJI[categoriaPorId[p.categoria_id]] || '🍴'}</div>`
        }
        <div class="nombre">${p.nombre}</div>
        <div class="precio">$${Number(p.precio).toFixed(2)}</div>
      </div>`
    )
    .join('');

  cont.querySelectorAll('.prod-card').forEach((el) => {
    el.addEventListener('click', () => manejarClickProducto(Number(el.dataset.id)));
  });
}

document.querySelectorAll('.tipo-servicio-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.tipo = btn.dataset.tipo;
    document.querySelectorAll('.tipo-servicio-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('campos-domicilio').style.display = state.tipo === 'domicilio' ? 'block' : 'none';
    if (state.tipo !== 'domicilio') {
      state.costoEnvio = 0;
      document.getElementById('envio-info-web').style.display = 'none';
    }
    actualizarTotalWeb();
  });
});

function renderColoniaOptions() {
  const sel = document.getElementById('cliente-colonia');
  if (!state.envios.length) {
    sel.innerHTML = '<option value="">Sin cobertura de domicilio por ahora</option>';
    return;
  }
  sel.innerHTML =
    '<option value="">Selecciona colonia</option>' +
    state.envios.map((e) => `<option value="${e.colonia}">${e.colonia} — envío $${Number(e.costo).toFixed(2)}</option>`).join('');
}

document.getElementById('cliente-colonia').addEventListener('change', () => {
  const infoEl = document.getElementById('envio-info-web');
  const match = state.envios.find((e) => e.colonia === document.getElementById('cliente-colonia').value);
  if (match) {
    state.costoEnvio = Number(match.costo);
    infoEl.textContent = `🛵 Costo de envío: $${state.costoEnvio.toFixed(2)}`;
    infoEl.style.display = 'block';
  } else {
    state.costoEnvio = 0;
    infoEl.style.display = 'none';
  }
  actualizarTotalWeb();
});

// ---------- Detectar cliente conocido y sus puntos de lealtad ----------

let telefonoWebTimeout = null;
document.getElementById('cliente-telefono').addEventListener('input', () => {
  clearTimeout(telefonoWebTimeout);
  state.clienteDetectado = null;
  state.recompensaElegidaId = null;
  document.getElementById('cliente-encontrado-web').style.display = 'none';
  document.getElementById('lealtad-web').style.display = 'none';
  telefonoWebTimeout = setTimeout(buscarClienteWeb, 400);
});

async function buscarClienteWeb() {
  const telefono = document.getElementById('cliente-telefono').value.trim();
  if (telefono.length < 10) return;

  const cliente = await fetch(`/api/clientes/consulta-publica?telefono=${encodeURIComponent(telefono)}`).then((r) => r.json());
  if (!cliente) return;

  state.clienteDetectado = cliente;
  if (cliente.nombre && !document.getElementById('cliente-nombre').value.trim()) {
    document.getElementById('cliente-nombre').value = cliente.nombre;
  }
  const encontradoEl = document.getElementById('cliente-encontrado-web');
  encontradoEl.textContent = `👋 ¡Qué bueno verte de nuevo, ${cliente.nombre || ''}!`;
  encontradoEl.style.display = 'block';

  if (Number(cliente.puntos) > 0) {
    if (!state.recompensas.length) {
      state.recompensas = await fetch('/api/recompensas').then((r) => r.json());
    }
    renderLealtadWeb(cliente);
  }
}

function renderLealtadWeb(cliente) {
  const disponibles = state.recompensas.filter((r) => r.puntos_requeridos <= Number(cliente.puntos));
  const lealtadEl = document.getElementById('lealtad-web');
  document.getElementById('lealtad-puntos-texto').textContent = `Tienes ${cliente.puntos} punto(s) acumulados`;

  if (!disponibles.length) {
    document.getElementById('lealtad-recompensas-lista').innerHTML =
      '<div style="font-size:12.5px;color:#888">Todavía no te alcanza para ninguna recompensa — ¡síguele!</div>';
    lealtadEl.style.display = 'block';
    return;
  }

  document.getElementById('lealtad-recompensas-lista').innerHTML = disponibles
    .map(
      (r) => `
    <div class="recompensa-chip-web ${state.recompensaElegidaId === r.id ? 'selected' : ''}" data-recompensa="${r.id}">
      <span>🎁 ${r.nombre}</span>
      <span class="puntos-req">${r.puntos_requeridos} pts · −$${Number(r.monto_descuento).toFixed(2)}</span>
    </div>`
    )
    .join('');

  document.querySelectorAll('.recompensa-chip-web').forEach((el) => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.recompensa);
      state.recompensaElegidaId = state.recompensaElegidaId === id ? null : id;
      renderLealtadWeb(cliente);
      actualizarTotalWeb();
    });
  });
  lealtadEl.style.display = 'block';
}

// ---------- Carrito ----------

function manejarClickProducto(productoId) {
  const producto = state.productos.find((p) => p.id === productoId);
  const grupos = producto.grupos_modificadores || [];

  if (grupos.length === 0) {
    agregarAlCarrito({ producto_id: producto.id, nombre: producto.nombre, precio: Number(producto.precio), cantidad: 1, opciones_seleccionadas: [] });
  } else {
    abrirModalModificadores(producto, grupos);
  }
}

function agregarAlCarrito(item) {
  const clave = item.producto_id + '|' + JSON.stringify(item.opciones_seleccionadas);
  const existente = state.carrito.find((it) => it._clave === clave);
  if (existente) existente.cantidad += item.cantidad;
  else state.carrito.push({ ...item, _clave: clave });
  actualizarBarraCarrito();
}

function quitarDelCarrito(clave) {
  const item = state.carrito.find((it) => it._clave === clave);
  if (!item) return;
  item.cantidad -= 1;
  if (item.cantidad <= 0) state.carrito = state.carrito.filter((it) => it._clave !== clave);
  actualizarBarraCarrito();
  renderCartItems();
}

function totalCarrito() {
  return state.carrito.reduce((sum, it) => sum + it.precio * it.cantidad, 0) + (state.costoEnvio || 0);
}

function actualizarBarraCarrito() {
  const bar = document.getElementById('cart-bar');
  const cantidadTotal = state.carrito.reduce((s, it) => s + it.cantidad, 0);
  if (cantidadTotal > 0) {
    bar.classList.add('visible');
    document.getElementById('cart-bar-texto').textContent = `🛒 ${cantidadTotal} producto(s) · $${totalCarrito().toFixed(2)}`;
  } else {
    bar.classList.remove('visible');
  }
}

document.getElementById('cart-bar').addEventListener('click', () => {
  renderCartItems();
  document.getElementById('overlay-checkout').classList.add('abierto');
});
document.getElementById('btn-cerrar-checkout').addEventListener('click', () => {
  document.getElementById('overlay-checkout').classList.remove('abierto');
});

function renderCartItems() {
  const cont = document.getElementById('cart-items');
  cont.innerHTML =
    state.carrito
      .map((it) => {
        const detalle = it.opciones_seleccionadas.map((o) => o.nombre).join(', ');
        return `
      <div class="cart-item">
        <span>${it.cantidad}x ${it.nombre}${detalle ? `<br><small>${detalle}</small>` : ''}</span>
        <span>$${(it.precio * it.cantidad).toFixed(2)} <button data-clave="${it._clave}">×</button></span>
      </div>`;
      })
      .join('') || '<p style="color:#999;text-align:center">Tu carrito está vacío</p>';

  cont.querySelectorAll('button[data-clave]').forEach((btn) => {
    btn.addEventListener('click', () => quitarDelCarrito(btn.dataset.clave));
  });
  actualizarTotalWeb();
}

function actualizarTotalWeb() {
  const subtotal = state.carrito.reduce((sum, it) => sum + it.precio * it.cantidad, 0);
  const envio = state.costoEnvio || 0;
  const recompensa = state.recompensas.find((r) => r.id === state.recompensaElegidaId);
  const descuento = recompensa ? Number(recompensa.monto_descuento) : 0;

  document.getElementById('desglose-web').innerHTML = `
    <div style="display:flex;justify-content:space-between">
      <span>Subtotal productos</span><span>$${subtotal.toFixed(2)}</span>
    </div>
    ${
      envio > 0
        ? `<div style="display:flex;justify-content:space-between;color:#1a7d3a;font-weight:600">
            <span>🛵 Costo de envío</span><span>$${envio.toFixed(2)}</span>
          </div>`
        : ''
    }
    ${
      descuento > 0
        ? `<div style="display:flex;justify-content:space-between;color:#a97800;font-weight:600">
            <span>🎁 Descuento por puntos</span><span>−$${descuento.toFixed(2)}</span>
          </div>`
        : ''
    }`;
  document.getElementById('total-web').textContent = `$${Math.max(0, subtotal + envio - descuento).toFixed(2)}`;
}

// ---------- Confirmar pedido ----------

document.getElementById('btn-confirmar-pedido').addEventListener('click', confirmarPedidoWeb);

async function confirmarPedidoWeb() {
  const statusEl = document.getElementById('status-web');
  const nombre = document.getElementById('cliente-nombre').value.trim();
  const telefono = document.getElementById('cliente-telefono').value.trim();
  const direccion = document.getElementById('cliente-direccion').value.trim();
  const colonia = document.getElementById('cliente-colonia').value;

  if (!state.carrito.length) {
    statusEl.textContent = 'Agrega al menos un producto.';
    return;
  }
  if (!telefono || !nombre) {
    statusEl.textContent = 'Falta tu teléfono o tu nombre.';
    return;
  }
  if (!state.tipo) {
    statusEl.textContent = 'Elige si tu pedido es para llevar o a domicilio.';
    return;
  }
  if (state.tipo === 'domicilio' && (!colonia || !direccion)) {
    statusEl.textContent = 'Falta la colonia o la dirección para el domicilio.';
    return;
  }

  const sucursal_id = Number(document.getElementById('sucursal-select').value);
  const btn = document.getElementById('btn-confirmar-pedido');
  btn.disabled = true;
  statusEl.textContent = 'Enviando tu pedido...';

  try {
    const cliente = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, telefono, direccion, colonia }),
    }).then((r) => r.json());

    const items = state.carrito.map((it) => ({
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      precio_unitario: it.precio,
      opciones_seleccionadas: it.opciones_seleccionadas,
    }));

    const resp = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sucursal_id,
        cliente_id: cliente.id,
        cliente_nombre: nombre,
        tipo: state.tipo,
        items,
        costo_envio: state.costoEnvio || 0,
        origen: 'web',
        recompensa_id: state.recompensaElegidaId || undefined,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = '❌ ' + (err.error || 'No se pudo enviar tu pedido');
      btn.disabled = false;
      return;
    }

    const pedido = await resp.json();
    document.getElementById('confirmacion-detalle').textContent =
      `Tu pedido #${pedido.numero_dia ?? pedido.id} ya está en camino a cocina. ` +
      (state.tipo === 'domicilio' ? 'Te lo llevamos en cuanto esté listo.' : 'Pasa por él en un rato.') +
      ` Total: $${Number(pedido.total).toFixed(2)} (se cobra al recibir).`;

    document.getElementById('overlay-checkout').classList.remove('abierto');
    document.getElementById('overlay-confirmacion').classList.add('abierto');

    state.carrito = [];
    state.tipo = null;
    state.costoEnvio = 0;
    state.clienteDetectado = null;
    state.recompensaElegidaId = null;
    actualizarBarraCarrito();
    document.querySelectorAll('.tipo-servicio-btn').forEach((b) => b.classList.remove('selected'));
    document.getElementById('campos-domicilio').style.display = 'none';
    document.getElementById('cliente-encontrado-web').style.display = 'none';
    document.getElementById('lealtad-web').style.display = 'none';
    document.getElementById('cliente-nombre').value = '';
    document.getElementById('cliente-telefono').value = '';
    document.getElementById('cliente-direccion').value = '';
    document.getElementById('cliente-colonia').value = '';
  } catch (err) {
    statusEl.textContent = '❌ No se pudo enviar, revisa tu conexión e intenta de nuevo.';
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('btn-nuevo-pedido-web').addEventListener('click', () => {
  document.getElementById('overlay-confirmacion').classList.remove('abierto');
  document.getElementById('status-web').textContent = '';
});

// ---------- Modal de modificadores (variantes y extras) ----------

function abrirModalModificadores(producto, grupos) {
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
                  const isSelected = g.tipo === 'variante' ? seleccion[g.id] && seleccion[g.id].id === op.id : seleccion[g.id].some((s) => s.id === op.id);
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
    document.getElementById('modal-menos').addEventListener('click', () => { if (cantidad > 1) cantidad -= 1; render(); });
    document.getElementById('modal-mas').addEventListener('click', () => { cantidad += 1; render(); });
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
          opcionesElegidas.push({ id: seleccion[g.id].id, grupo: g.nombre, nombre: seleccion[g.id].nombre, precio: Number(seleccion[g.id].precio), tipo: 'variante', multiplicador: Number(seleccion[g.id].multiplicador) || 1 });
        }
        if (g.tipo === 'extra') {
          seleccion[g.id].forEach((op) => {
            opcionesElegidas.push({ id: op.id, grupo: g.nombre, nombre: op.nombre, precio: Number(op.precio), tipo: 'extra' });
          });
        }
      });
      agregarAlCarrito({ producto_id: producto.id, nombre: producto.nombre, precio: calcularPrecio(), cantidad, opciones_seleccionadas: opcionesElegidas });
      cerrar();
    });
  }

  function cerrar() {
    document.getElementById('modal-container').innerHTML = '';
  }

  render();
}

cargarInicial();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
