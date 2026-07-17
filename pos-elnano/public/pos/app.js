const state = {
  sucursales: [],
  categorias: [],
  productos: [],
  categoriaActiva: null,
  carrito: [], // { producto_id, nombre, precio, cantidad }
  tipoPedido: 'mostrador',
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
