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
  const existente = state.carrito.find((it) => it.producto_id === productoId);
  if (existente) {
    existente.cantidad += 1;
  } else {
    state.carrito.push({
      producto_id: producto.id,
      nombre: producto.nombre,
      precio: Number(producto.precio),
      cantidad: 1,
    });
  }
  renderCarrito();
}

function quitarDelCarrito(productoId) {
  const item = state.carrito.find((it) => it.producto_id === productoId);
  if (!item) return;
  item.cantidad -= 1;
  if (item.cantidad <= 0) {
    state.carrito = state.carrito.filter((it) => it.producto_id !== productoId);
  }
  renderCarrito();
}

function renderCarrito() {
  const cont = document.getElementById('cart-items');
  cont.innerHTML = state.carrito
    .map(
      (it) => `
      <div class="cart-item">
        <span>${it.cantidad}x ${it.nombre}</span>
        <span>
          $${(it.precio * it.cantidad).toFixed(2)}
          <button data-id="${it.producto_id}">×</button>
        </span>
      </div>`
    )
    .join('');
  cont.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => quitarDelCarrito(Number(btn.dataset.id)));
  });

  const total = state.carrito.reduce((sum, it) => sum + it.precio * it.cantidad, 0);
  document.getElementById('total').textContent = total.toFixed(2);
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
