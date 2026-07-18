const state = {
  sucursales: [],
  categorias: [],
  productos: [],
  categoriaActiva: null,
  carrito: [], // { producto_id, nombre, precio, cantidad }
  tipoPedido: 'mesa',
};

async function cargarInicial() {
  state.sucursales = await fetch('/api/sucursales').then((r) => r.json());
  state.categorias = await fetch('/api/categorias').then((r) => r.json());
  state.productos = await fetch('/api/productos').then((r) => r.json());

  const select = document.getElementById('sucursal-select');
  select.innerHTML = state.sucursales
    .map((s) => `<option value="${s.id}">${s.nombre}</option>`)
    .join('');

  state.categoriaActiva = state.categorias[0]?.id ?? null;
  renderTabs();
  renderProductos();
}

function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = state.categorias
    .map(
      (c) =>
        `<div class="tab ${c.id === state.categoriaActiva ? 'active' : ''}" data-id="${c.id}">${c.nombre}</div>`
    )
    .join('');
  tabs.querySelectorAll('.tab').forEach((el) => {
    el.addEventListener('click', () => {
      state.categoriaActiva = Number(el.dataset.id);
      renderTabs();
      renderProductos();
    });
  });
}

function renderProductos() {
  const cont = document.getElementById('productos');
  const lista = state.productos.filter((p) => p.categoria_id === state.categoriaActiva);
  cont.innerHTML = lista
    .map(
      (p) => `
      <div class="producto" data-id="${p.id}">
        <div class="nombre">${p.nombre}</div>
        <div class="precio">$${Number(p.precio).toFixed(2)}</div>
      </div>`
    )
    .join('');
  cont.querySelectorAll('.producto').forEach((el) => {
    el.addEventListener('click', () => agregarAlCarrito(Number(el.dataset.id)));
  });
}

function agregarAlCarrito(productoId) {
  const producto = state.productos.find((p) => p.id === productoId);
  const grupos = producto.grupos_modificadores || [];

  if (grupos.length === 0) {
    // Producto simple, sin modificadores: se agrega directo como antes
    agregarItemAlCarrito({
      producto_id: producto.id,
      nombre: producto.nombre,
      precio: Number(producto.precio),
      cantidad: 1,
      opciones_seleccionadas: [],
    });
    return;
  }

  abrirModalModificadores(producto, grupos);
}

function agregarItemAlCarrito(item) {
  // Cada combinación distinta de opciones se trata como línea separada en el carrito
  const clave = item.producto_id + '|' + JSON.stringify(item.opciones_seleccionadas);
  const existente = state.carrito.find((it) => it._clave === clave);
  if (existente) {
    existente.cantidad += item.cantidad;
  } else {
    state.carrito.push({ ...item, _clave: clave });
  }
  renderCarrito();
}

function quitarDelCarrito(clave) {
  const item = state.carrito.find((it) => it._clave === clave);
  if (!item) return;
  item.cantidad -= 1;
  if (item.cantidad <= 0) {
    state.carrito = state.carrito.filter((it) => it._clave !== clave);
  }
  renderCarrito();
}

function renderCarrito() {
  const cont = document.getElementById('cart-items');
  cont.innerHTML = state.carrito
    .map((it) => {
      const detalle = it.opciones_seleccionadas.map((o) => o.nombre).join(', ');
      return `
      <div class="cart-item">
        <span>${it.cantidad}x ${it.nombre}${detalle ? `<br><small style="color:#888">${detalle}</small>` : ''}</span>
        <span>
          $${(it.precio * it.cantidad).toFixed(2)}
          <button data-clave="${it._clave}">×</button>
        </span>
      </div>`;
    })
    .join('');
  cont.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => quitarDelCarrito(btn.dataset.clave));
  });

  const total = state.carrito.reduce((sum, it) => sum + it.precio * it.cantidad, 0);
  document.getElementById('total').textContent = total.toFixed(2);
}

// ---------- Modal de modificadores ----------
function abrirModalModificadores(producto, grupos) {
  const seleccion = {}; // grupo.id -> opcion (variante) u opcion.id[] (extra)
  grupos.forEach((g) => {
    seleccion[g.id] = g.tipo === 'extra' ? [] : (g.obligatorio ? g.opciones[0] : null);
  });
  let cantidad = 1;

  function calcularPrecio() {
    let precio = Number(producto.precio);
    grupos.forEach((g) => {
      if (g.tipo === 'variante' && seleccion[g.id]) {
        precio = Number(seleccion[g.id].precio); // reemplaza el precio base
      }
      if (g.tipo === 'extra') {
        seleccion[g.id].forEach((op) => { precio += Number(op.precio); });
      }
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
                    g.tipo === 'variante'
                      ? seleccion[g.id] && seleccion[g.id].id === op.id
                      : seleccion[g.id].some((s) => s.id === op.id);
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
      agregarItemAlCarrito({
        producto_id: producto.id,
        nombre: producto.nombre,
        precio: calcularPrecio(),
        cantidad,
        opciones_seleccionadas: opcionesElegidas,
      });
      cerrar();
    });
  }

  function cerrar() {
    document.getElementById('modal-container').innerHTML = '';
  }

  render();
}

document.querySelectorAll('.tipo-pedido button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.tipoPedido = btn.dataset.tipo;
    document.querySelectorAll('.tipo-pedido button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

async function enviarPedido() {
  const statusMsg = document.getElementById('status-msg');
  if (!state.carrito.length) {
    statusMsg.textContent = 'Agrega al menos un producto.';
    return;
  }

  const sucursal_id = Number(document.getElementById('sucursal-select').value);
  const telefono = document.getElementById('cliente-telefono').value.trim();
  const nombre = document.getElementById('cliente-nombre').value.trim();
  const direccion = document.getElementById('cliente-direccion').value.trim();
  const colonia = document.getElementById('cliente-colonia').value.trim();

  let cliente_id = null;
  if (telefono) {
    const cliente = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, telefono, direccion, colonia }),
    }).then((r) => r.json());
    cliente_id = cliente.id;
  }

  const items = state.carrito.map((it) => ({
    producto_id: it.producto_id,
    cantidad: it.cantidad,
    precio_unitario: it.precio,
    opciones_seleccionadas: it.opciones_seleccionadas,
  }));

  const btn = document.getElementById('btn-enviar');
  btn.disabled = true;
  statusMsg.textContent = 'Enviando...';

  try {
    await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sucursal_id, cliente_id, tipo: state.tipoPedido, items }),
    }).then((r) => r.json());

    statusMsg.textContent = '✅ Pedido enviado a cocina';
    state.carrito = [];
    renderCarrito();
    document.getElementById('cliente-telefono').value = '';
    document.getElementById('cliente-nombre').value = '';
    document.getElementById('cliente-direccion').value = '';
    document.getElementById('cliente-colonia').value = '';
  } catch (err) {
    statusMsg.textContent = '❌ Error al enviar el pedido, intenta de nuevo';
  } finally {
    btn.disabled = false;
    setTimeout(() => (statusMsg.textContent = ''), 3000);
  }
}

document.getElementById('btn-enviar').addEventListener('click', enviarPedido);

cargarInicial();

// ==================== VISTA DE COBRO ====================

const TIPO_LABELS = { mesa: 'Mesa', para_llevar: 'Para llevar', domicilio: 'Domicilio' };
const METODO_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Dividido' };
let pedidosCobro = [];
let filtroCobro = 'pendientes';

document.getElementById('nav-pedido').addEventListener('click', () => cambiarVista('pedido'));
document.getElementById('nav-cobro').addEventListener('click', () => cambiarVista('cobro'));

function cambiarVista(vista) {
  document.getElementById('vista-pedido').style.display = vista === 'pedido' ? 'block' : 'none';
  document.getElementById('vista-cobro').style.display = vista === 'cobro' ? 'block' : 'none';
  document.getElementById('nav-pedido').classList.toggle('active', vista === 'pedido');
  document.getElementById('nav-cobro').classList.toggle('active', vista === 'cobro');
  if (vista === 'cobro') cargarPedidosCobro();
}

// Si cambian de sucursal mientras están en la vista de cobro, refresca esa lista también
document.getElementById('sucursal-select').addEventListener('change', () => {
  if (document.getElementById('vista-cobro').style.display !== 'none') cargarPedidosCobro();
});

document.querySelectorAll('.filtro').forEach((btn) => {
  btn.addEventListener('click', () => {
    filtroCobro = btn.dataset.filtro;
    document.querySelectorAll('.filtro').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    cargarPedidosCobro();
  });
});

async function cargarPedidosCobro() {
  const sucursalId = document.getElementById('sucursal-select').value;
  let url = `/api/pedidos?sucursal_id=${sucursalId}`;
  if (filtroCobro === 'pendientes') url += '&pagado=false';
  if (filtroCobro === 'cobrados') url += '&pagado=true';
  pedidosCobro = await fetch(url).then((r) => r.json());
  renderCobro();
}

function renderCobro() {
  const cont = document.getElementById('lista-cobro');
  const sinPedidos = document.getElementById('sin-pedidos');

  if (!pedidosCobro.length) {
    cont.innerHTML = '';
    sinPedidos.style.display = 'block';
    return;
  }
  sinPedidos.style.display = 'none';

  cont.innerHTML = pedidosCobro.map((p) => renderCardCobro(p)).join('');

  document.querySelectorAll('[data-cobrar]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalCobro(Number(btn.dataset.cobrar)));
  });
}

function renderCardCobro(pedido) {
  const hora = new Date(pedido.creado_en).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const itemsTexto = pedido.items
    .map((it) => {
      const opciones = (it.opciones_seleccionadas || []).map((o) => o.nombre).join(', ');
      return `${it.cantidad}x ${it.producto_nombre}${opciones ? ` (${opciones})` : ''}`;
    })
    .join('<br>');

  const tipoLabel = TIPO_LABELS[pedido.tipo] || pedido.tipo;

  return `
    <div class="pedido-card">
      <div class="pedido-top">
        <span class="id">#${pedido.id} · ${hora}</span>
        <span class="badge badge-${pedido.tipo}">${tipoLabel}</span>
      </div>
      <div class="pedido-items-cobro">${itemsTexto}</div>
      ${pedido.cliente_nombre ? `<div class="pedido-cliente">👤 ${pedido.cliente_nombre} · ${pedido.cliente_telefono || ''}</div>` : ''}
      <div class="pedido-bottom">
        <span class="total">$${Number(pedido.total).toFixed(2)}</span>
        ${
          pedido.pagado
            ? `<span class="pago-info">✅ ${METODO_LABELS[pedido.metodo_pago] || pedido.metodo_pago}</span>`
            : `<button class="btn-cobrar" data-cobrar="${pedido.id}">Cobrar</button>`
        }
      </div>
    </div>`;
}

let pagosEnCurso = [];
let pedidoEnCobro = null;

function abrirModalCobro(pedidoId) {
  pedidoEnCobro = pedidosCobro.find((p) => p.id === pedidoId);
  pagosEnCurso = [{ metodo: 'efectivo', monto: Number(pedidoEnCobro.total).toFixed(2) }];
  renderModalCobro();
}

function renderModalCobro() {
  // Guarda en qué campo estabas escribiendo antes de reconstruir el HTML,
  // para devolverle el foco después (si no, cada tecla te sacaba del campo)
  const activeEl = document.activeElement;
  let focoGuardado = null;
  if (activeEl && activeEl.dataset && activeEl.dataset.idx !== undefined) {
    let clase = null;
    if (activeEl.classList.contains('pago-monto')) clase = 'pago-monto';
    else if (activeEl.classList.contains('pago-recibido')) clase = 'pago-recibido';
    if (clase) {
      focoGuardado = {
        clase,
        idx: activeEl.dataset.idx,
        inicio: activeEl.selectionStart,
        fin: activeEl.selectionEnd,
      };
    }
  }

  const total = Number(pedidoEnCobro.total);

  // Calcula, en orden, cuánto de lo escrito en cada fila realmente se aplica al total
  // (el resto, si es efectivo, se vuelve cambio) — así nunca se puede "pasar" del total.
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
      <div style="font-size:12px;color:#888">
        ${p.metodo === 'efectivo' ? '¿Cuánto te dio el cliente?' : 'Monto a cobrar por este método'}
      </div>
      ${
        p.cambio > 0
          ? `<div style="text-align:right;margin-top:4px;font-weight:bold;color:#1a7d3a">Cambio a dar: $${p.cambio.toFixed(2)}</div>`
          : ''
      }
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
      const restanteParaNuevaFila = filasCalculadas.length
        ? Number((total - asignado).toFixed(2))
        : total;
      pagosEnCurso.push({
        metodo: 'tarjeta',
        monto: restanteParaNuevaFila > 0 ? restanteParaNuevaFila.toFixed(2) : '0.00',
      });
      renderModalCobro();
    });
  }
  const btnConfirmar = document.getElementById('btn-confirmar-cobro');
  if (btnConfirmar && !btnConfirmar.disabled) {
    btnConfirmar.addEventListener('click', () => confirmarCobro(filasCalculadas));
  }

  // Devuelve el foco (y la posición del cursor) al campo donde estabas escribiendo
  if (focoGuardado) {
    const el = document.querySelector(`.${focoGuardado.clase}[data-idx="${focoGuardado.idx}"]`);
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
    cargarPedidosCobro();
  } catch (err) {
    alert('No se pudo registrar el cobro, revisa tu conexión.');
    btn.disabled = false;
    btn.textContent = 'Confirmar cobro';
  }
}
