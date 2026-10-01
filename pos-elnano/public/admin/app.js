const TIPO_LABELS = { mesa: 'Mesa', para_llevar: 'Para llevar', domicilio: 'Domicilio' };

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

  if (state.empleado?.sucursal_id) {
    select.value = state.empleado.sucursal_id;
    select.disabled = true;
    select.title = 'Tu acceso está limitado a esta sucursal';
  }
  localStorage.setItem('elnano_sucursal_id', select.value);

  // El menú (categorías/productos) es independiente por sucursal.
  state.categorias = await fetch(`/api/categorias?sucursal_id=${select.value}`).then((r) => r.json());
  state.productos = await fetch(`/api/productos?sucursal_id=${select.value}`).then((r) => r.json());

  select.addEventListener('change', async () => {
    localStorage.setItem('elnano_sucursal_id', select.value);
    state.categorias = await fetch(`/api/categorias?sucursal_id=${select.value}`).then((r) => r.json());
    state.productos = await fetch(`/api/productos?sucursal_id=${select.value}`).then((r) => r.json());
    state.categoriaActivaOverlay = state.categorias[0]?.id ?? null;
  });

  state.categoriaActivaOverlay = state.categorias[0]?.id ?? null;
}

document.getElementById('btn-ir-pos').addEventListener('click', () => {
  const sucursalActual = state.sucursales.find((s) => String(s.id) === document.getElementById('sucursal-select').value);
  const slug = sucursalActual ? normalizarSlug(sucursalActual.nombre) : '';
  window.location.href = slug ? `/pos?sucursal=${slug}` : '/pos';
});
document.getElementById('btn-ir-pos-drawer').addEventListener('click', () => document.getElementById('btn-ir-pos').click());

document.getElementById('btn-cerrar-sesion').addEventListener('click', async () => {
  if (!confirm('¿Cerrar sesión?')) return;
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ==================== MENÚ LATERAL (paneles administrativos) ====================

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



document.getElementById('btn-abrir-repartidores').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-repartidores').classList.add('abierto');
  cargarRepartidoresAdmin();
});


document.getElementById('btn-cerrar-repartidores').addEventListener('click', () => document.getElementById('overlay-repartidores').classList.remove('abierto'));



document.getElementById('btn-agregar-repartidor').addEventListener('click', async () => {
  const nombre = document.getElementById('nuevo-repartidor-nombre').value.trim();
  const telefono = document.getElementById('nuevo-repartidor-telefono').value.trim();
  if (!nombre) {
    alert('Falta el nombre');
    return;
  }
  await fetch('/api/repartidores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, telefono }),
  });
  document.getElementById('nuevo-repartidor-nombre').value = '';
  document.getElementById('nuevo-repartidor-telefono').value = '';
  cargarRepartidoresAdmin();
});

async function cargarRepartidoresAdmin() {
  const repartidores = await fetch('/api/repartidores?todos=true').then((r) => r.json());
  repartidoresCache = null; // invalida el caché usado en el ticket

  document.getElementById('repartidores-tabla-body').innerHTML = repartidores
    .map(
      (r) => `
    <tr style="opacity:${r.activo ? '1' : '0.5'}">
      <td><input type="text" class="repartidor-nombre-edit" data-id="${r.id}" value="${r.nombre}" style="width:100%;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td><input type="text" class="repartidor-telefono-edit" data-id="${r.id}" value="${r.telefono || ''}" style="width:120px;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td style="white-space:nowrap">
        <button class="btn-eliminar-fila" data-guardar-repartidor="${r.id}" title="Guardar">💾</button>
        <button class="btn-eliminar-fila" data-toggle-repartidor="${r.id}" data-activo="${r.activo}" title="${r.activo ? 'Desactivar' : 'Activar'}">${r.activo ? '👁️' : '🚫'}</button>
      </td>
      <td><button class="btn-eliminar-fila" data-borrar-repartidor="${r.id}" title="Borrar">🗑️</button></td>
    </tr>`
    )
    .join('') || '<tr><td colspan="4" style="text-align:center;color:#999">Sin repartidores todavía</td></tr>';

  document.querySelectorAll('[data-guardar-repartidor]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.guardarRepartidor;
      const nombre = document.querySelector(`.repartidor-nombre-edit[data-id="${id}"]`).value.trim();
      const telefono = document.querySelector(`.repartidor-telefono-edit[data-id="${id}"]`).value.trim();
      await fetch(`/api/repartidores/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, telefono }),
      });
      cargarRepartidoresAdmin();
    });
  });
  document.querySelectorAll('[data-toggle-repartidor]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const activo = btn.dataset.activo === 'true';
      await fetch(`/api/repartidores/${btn.dataset.toggleRepartidor}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !activo }),
      });
      cargarRepartidoresAdmin();
    });
  });
  document.querySelectorAll('[data-borrar-repartidor]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este repartidor?')) return;
      await fetch(`/api/repartidores/${btn.dataset.borrarRepartidor}`, { method: 'DELETE' });
      cargarRepartidoresAdmin();
    });
  });
}



document.getElementById('btn-abrir-clientes').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-clientes').classList.add('abierto');
  document.getElementById('clientes-buscar').value = '';
  cargarClientes();
});


document.getElementById('btn-cerrar-clientes').addEventListener('click', () => document.getElementById('overlay-clientes').classList.remove('abierto'));



document.getElementById('btn-abrir-profit-first').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-profit-first').classList.add('abierto');
  cargarProfitFirst();
});


document.getElementById('btn-cerrar-profit-first').addEventListener('click', () => document.getElementById('overlay-profit-first').classList.remove('abierto'));



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
  const sucursalId = document.getElementById('sucursal-select').value;
  state.categorias = await fetch(`/api/categorias?sucursal_id=${sucursalId}`).then((r) => r.json());
  state.productos = await fetch(`/api/productos?sucursal_id=${sucursalId}`).then((r) => r.json());
});



document.getElementById('btn-abrir-envios').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-envios').classList.add('abierto');
  cargarEnvios();
});


document.getElementById('btn-cerrar-envios').addEventListener('click', () => document.getElementById('overlay-envios').classList.remove('abierto'));



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

document.getElementById('btn-importar-respaldo-pf').addEventListener('click', () => {
  document.getElementById('pf-archivo-respaldo').click();
});

document.getElementById('pf-archivo-respaldo').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  const statusEl = document.getElementById('pf-import-status');
  if (!archivo) return;

  statusEl.style.color = '#666';
  statusEl.textContent = 'Leyendo archivo...';

  try {
    const texto = await archivo.text();
    const datos = JSON.parse(texto);

    if (!confirm(`Se va a importar el respaldo con ${datos.entries?.length || 0} días registrados. ¿Continuar?`)) {
      statusEl.textContent = '';
      return;
    }

    statusEl.textContent = 'Importando...';
    const resp = await fetch('/api/profit-first/importar-respaldo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: texto,
    });
    const resultado = await resp.json();

    if (!resp.ok) {
      statusEl.style.color = '#b8232f';
      statusEl.textContent = resultado.error || 'No se pudo importar';
      return;
    }

    statusEl.style.color = '#1a7d3a';
    statusEl.textContent = `✅ Importado: ${resultado.diasProcesados} días, ${resultado.movimientosCreados} movimientos creados.`;
    cargarProfitFirst();
  } catch (err) {
    statusEl.style.color = '#b8232f';
    statusEl.textContent = 'El archivo no es un JSON válido, o hubo un error al importar.';
  } finally {
    e.target.value = '';
  }
});

cargarInicial();

// ==================== PROFIT FIRST ====================

async function abrirHistorialProfitFirst(categoriaId, nombreCategoria) {
  const movimientos = await fetch(`/api/profit-first/movimientos?categoria_id=${categoriaId}`).then((r) => r.json());

  const html = `
    <div class="modal-overlay" id="modal-overlay-historial-pf">
      <div class="modal-box">
        <h3>Historial — ${nombreCategoria}</h3>
        <div id="historial-pf-lista">
          ${
            movimientos
              .map(
                (m) => `
            <div class="editar-item-row" style="align-items:center">
              <span style="font-size:12.5px">
                <strong style="color:${m.tipo === 'ingreso' ? '#1a7d3a' : '#b8232f'}">${m.tipo === 'ingreso' ? '+' : '−'}$${Number(m.monto).toFixed(2)}</strong>
                — ${escapeHtml(m.descripcion || '')}<br>
                <span style="color:#999">${new Date(m.creado_en).toLocaleDateString('es-MX')}</span>
              </span>
              <button data-borrar-mov-pf="${m.id}">×</button>
            </div>`
              )
              .join('') || '<p style="color:#999;font-size:13px">Sin movimientos todavía</p>'
          }
        </div>
        <button class="btn-cancelar-modal" id="btn-cerrar-historial-pf">Cerrar</button>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;

  document.getElementById('modal-overlay-historial-pf').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay-historial-pf') document.getElementById('modal-container').innerHTML = '';
  });
  document.getElementById('btn-cerrar-historial-pf').addEventListener('click', () => {
    document.getElementById('modal-container').innerHTML = '';
  });
  document.querySelectorAll('[data-borrar-mov-pf]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Borrar este movimiento?')) return;
      await fetch(`/api/profit-first/movimientos/${btn.dataset.borrarMovPf}`, { method: 'DELETE' });
      abrirHistorialProfitFirst(categoriaId, nombreCategoria);
      cargarProfitFirst();
    });
  });
}

const PF_SLUG = {
  'Opex': 'opex', 'Nómina': 'nomina', 'Impuestos': 'impuestos', 'Utilidad': 'utilidad',
  'Sueldo dueño': 'sueldo-dueno', 'Renta': 'renta', 'Aguinaldo': 'aguinaldo',
};

async function cargarProfitFirst() {
  const categorias = await fetch('/api/profit-first/categorias').then((r) => r.json());

  const sumaPorcentajes = categorias.reduce((s, c) => s + Number(c.porcentaje), 0);
  const totalEl = document.getElementById('pf-total-porcentaje');
  totalEl.textContent = `Suma de porcentajes: ${sumaPorcentajes.toFixed(1)}%`;
  totalEl.style.color = Math.abs(sumaPorcentajes - 100) < 0.1 ? '#4f7942' : '#c98a2c';

  document.getElementById('pf-categorias').innerHTML = categorias
    .map((c) => {
      const slug = PF_SLUG[c.nombre] || 'opex';
      return `
    <div class="pf-ticket pf-caja-card ${slug}">
      <div class="tt">
        <span class="pf-chip ${slug}">${escapeHtml(c.nombre)}</span>
        <span class="pf-big ${c.saldo < 0 ? 'pf-neg' : 'pf-pos'}">$${Number(c.saldo).toFixed(2)}</span>
      </div>
      <label>Porcentaje</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" inputmode="decimal" class="pf-porcentaje-edit" data-id="${c.id}" value="${c.porcentaje}" style="width:70px" />
        <span style="font-size:13px;color:var(--ink-soft)">%</span>
        <button class="btn-eliminar-fila" data-guardar-pf="${c.id}" title="Guardar porcentaje" style="margin-left:auto">💾</button>
      </div>
      <div class="pf-zigzag"></div>
      <div style="padding-top:14px">
        <label>Registrar movimiento</label>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input type="text" inputmode="decimal" class="pf-gasto-monto" data-id="${c.id}" placeholder="Monto" style="width:90px" />
          <input type="text" class="pf-gasto-desc" data-id="${c.id}" placeholder="Descripción" style="flex:1" />
        </div>
        <div style="display:flex;gap:6px">
          <button class="pf-btn danger" style="margin-top:0;flex:1" data-registrar-gasto-pf="${c.id}">− Gasto</button>
          <button class="pf-btn secondary" style="margin-top:0;flex:1" data-registrar-ingreso-pf="${c.id}">+ Ingreso</button>
          <button class="btn-eliminar-fila" data-ver-historial-pf="${c.id}" data-nombre-pf="${escapeHtml(c.nombre)}" title="Ver historial">📋</button>
        </div>
      </div>
    </div>`;
    })
    .join('');

  document.querySelectorAll('.pf-porcentaje-edit, .pf-gasto-monto').forEach((el) => {
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9.]/g, '');
    });
  });
  document.querySelectorAll('[data-guardar-pf]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.guardarPf;
      const porcentaje = document.querySelector(`.pf-porcentaje-edit[data-id="${id}"]`).value;
      await fetch(`/api/profit-first/categorias/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ porcentaje }),
      });
      cargarProfitFirst();
    });
  });
  document.querySelectorAll('[data-registrar-gasto-pf]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.registrarGastoPf;
      const monto = document.querySelector(`.pf-gasto-monto[data-id="${id}"]`).value;
      const descripcion = document.querySelector(`.pf-gasto-desc[data-id="${id}"]`).value.trim();
      if (!monto) {
        alert('Falta el monto');
        return;
      }
      await fetch('/api/profit-first/gastos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria_id: id, monto, descripcion, tipo: 'gasto' }),
      });
      cargarProfitFirst();
    });
  });
  document.querySelectorAll('[data-registrar-ingreso-pf]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.registrarIngresoPf;
      const monto = document.querySelector(`.pf-gasto-monto[data-id="${id}"]`).value;
      const descripcion = document.querySelector(`.pf-gasto-desc[data-id="${id}"]`).value.trim();
      if (!monto) {
        alert('Falta el monto');
        return;
      }
      await fetch('/api/profit-first/gastos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria_id: id, monto, descripcion, tipo: 'ingreso' }),
      });
      cargarProfitFirst();
    });
  });
  document.querySelectorAll('[data-ver-historial-pf]').forEach((btn) => {
    btn.addEventListener('click', () => abrirHistorialProfitFirst(btn.dataset.verHistorialPf, btn.dataset.nombrePf));
  });
}

// ==================== INFORMES ====================

document.getElementById('btn-abrir-informes').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-informes').classList.add('abierto');
  if (!document.getElementById('informes-desde').value) aplicarPresetFecha('hoy');
  else cargarInformes();
});
document.getElementById('btn-cerrar-informes').addEventListener('click', () => document.getElementById('overlay-informes').classList.remove('abierto'));
document.getElementById('btn-consultar-informes').addEventListener('click', cargarInformes);

document.querySelectorAll('.chip-fecha').forEach((btn) => {
  btn.addEventListener('click', () => aplicarPresetFecha(btn.dataset.preset));
});

function aplicarPresetFecha(preset) {
  document.querySelectorAll('.chip-fecha').forEach((b) => b.classList.toggle('activo', b.dataset.preset === preset));
  const hoy = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  let desde = new Date(hoy);
  const hasta = fmt(hoy);

  if (preset === 'semana') desde.setDate(hoy.getDate() - hoy.getDay());
  else if (preset === 'mes') desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  // 'hoy' se queda igual a hoy

  document.getElementById('informes-desde').value = fmt(desde);
  document.getElementById('informes-hasta').value = hasta;
  cargarInformes();
}

const TIPO_LABELS_INFORMES = { mesa: 'Mesa', para_llevar: 'Para llevar', domicilio: 'Domicilio' };
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatearFechaCorta(fechaStr) {
  const [y, m, d] = String(fechaStr).slice(0, 10).split('-');
  return `${d} ${MESES_CORTOS[Number(m) - 1]}`;
}

async function cargarInformes() {
  const desde = document.getElementById('informes-desde').value;
  const hasta = document.getElementById('informes-hasta').value;
  const sucursalId = document.getElementById('sucursal-select').value;
  const cont = document.getElementById('informes-contenido');
  if (!desde || !hasta) return;

  cont.innerHTML = '<p style="color:#999;text-align:center;padding:20px">Cargando...</p>';

  const resp = await fetch(`/api/informes?sucursal_id=${sucursalId}&fecha_desde=${desde}&fecha_hasta=${hasta}`);
  if (!resp.ok) {
    let mensaje = `No se pudo cargar (código ${resp.status})`;
    try {
      const err = await resp.json();
      if (err.error) mensaje = err.error;
    } catch (e) {
      // la respuesta no era JSON (ej. error interno del servidor); se deja el mensaje genérico con el código
    }
    cont.innerHTML = `<p style="color:#b8232f;text-align:center;padding:20px">${mensaje}</p>`;
    return;
  }
  const d = await resp.json();

  const maxDia = Math.max(1, ...d.porDia.map((r) => r.total));
  const maxMetodo = Math.max(1, ...d.porMetodo.map((r) => r.total));
  const maxTipo = Math.max(1, ...d.porTipo.map((r) => r.total));
  const maxProducto = Math.max(1, ...d.topProductos.map((r) => r.cantidad));

  cont.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="valor">$${d.ventas.toFixed(0)}</div><div class="etiqueta">Ventas</div></div>
      <div class="kpi-card"><div class="valor">${d.pedidos}</div><div class="etiqueta">Pedidos cobrados</div></div>
      <div class="kpi-card"><div class="valor">$${d.ticketPromedio.toFixed(0)}</div><div class="etiqueta">Ticket promedio</div></div>
      <div class="kpi-card"><div class="valor">${d.porcentajeCancelados}%</div><div class="etiqueta">Cancelados (${d.pedidosCancelados})</div></div>
      <div class="kpi-card"><div class="valor">${d.tiempoPromedioCocinaMin ?? '—'}${d.tiempoPromedioCocinaMin ? ' min' : ''}</div><div class="etiqueta">Tiempo en cocina</div></div>
      <div class="kpi-card"><div class="valor">${d.resenaPromedio ?? '—'}${d.resenaPromedio ? ' ⭐' : ''}</div><div class="etiqueta">Reseñas (${d.resenaCantidad})</div></div>
    </div>

    <div class="informes-seccion">
      <h3>💰 Resumen financiero</h3>
      <div style="font-size:14px;line-height:2">
        <div style="display:flex;justify-content:space-between"><span>Ventas</span><strong>$${d.ventas.toFixed(2)}</strong></div>
        <div style="display:flex;justify-content:space-between;color:#666"><span>− Gastos registrados</span><span>$${d.gastos.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;color:#666"><span>− Descuentos por lealtad</span><span>$${d.descuentosLealtad.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding-top:8px;margin-top:4px;border-top:1px solid #eee;font-weight:bold"><span>≈ Resultado del periodo</span><span>$${(d.ventas - d.gastos - d.descuentosLealtad).toFixed(2)}</span></div>
      </div>
      <div style="font-size:11px;color:#aaa;margin-top:8px">No incluye el costo de los insumos consumidos, solo ventas menos gastos registrados y descuentos.</div>
    </div>

    <div class="informes-seccion">
      <h3>📅 Ventas por día</h3>
      ${
        d.porDia.length
          ? d.porDia
              .map(
                (r) => `
        <div class="barra-fila">
          <span class="etiqueta-barra">${formatearFechaCorta(r.dia)}</span>
          <div class="barra-fondo"><div class="barra-relleno" style="width:${(r.total / maxDia) * 100}%"><span>$${r.total.toFixed(0)}</span></div></div>
        </div>`
              )
              .join('')
          : '<p style="color:#999;font-size:13px">Sin ventas en este rango</p>'
      }
    </div>

    <div class="informes-seccion">
      <h3>💳 Ventas por método de pago</h3>
      ${
        d.porMetodo.length
          ? d.porMetodo
              .map(
                (r) => `
        <div class="barra-fila">
          <span class="etiqueta-barra">${METODO_LABELS[r.metodo] || r.metodo}</span>
          <div class="barra-fondo"><div class="barra-relleno" style="width:${(r.total / maxMetodo) * 100}%"><span>$${r.total.toFixed(0)}</span></div></div>
        </div>`
              )
              .join('')
          : '<p style="color:#999;font-size:13px">Sin datos</p>'
      }
    </div>

    <div class="informes-seccion">
      <h3>🧾 Ventas por tipo de pedido</h3>
      ${
        d.porTipo.length
          ? d.porTipo
              .map(
                (r) => `
        <div class="barra-fila">
          <span class="etiqueta-barra">${TIPO_LABELS_INFORMES[r.tipo] || r.tipo} (${r.pedidos})</span>
          <div class="barra-fondo"><div class="barra-relleno" style="width:${(r.total / maxTipo) * 100}%"><span>$${r.total.toFixed(0)}</span></div></div>
        </div>`
              )
              .join('')
          : '<p style="color:#999;font-size:13px">Sin datos</p>'
      }
    </div>

    <div class="informes-seccion">
      <h3>🏆 Top 10 productos más vendidos</h3>
      ${
        d.topProductos.length
          ? d.topProductos
              .map(
                (r, i) => `
        <div class="barra-fila">
          <span class="etiqueta-barra">${i + 1}. ${escapeHtml(r.nombre)}</span>
          <div class="barra-fondo"><div class="barra-relleno" style="width:${(r.cantidad / maxProducto) * 100}%"><span>${r.cantidad} · $${r.total.toFixed(0)}</span></div></div>
        </div>`
              )
              .join('')
          : '<p style="color:#999;font-size:13px">Sin ventas en este rango</p>'
      }
    </div>

    <div class="informes-seccion">
      <h3>👥 Clientes nuevos en el periodo</h3>
      <div class="kpi-card" style="max-width:200px"><div class="valor">${d.clientesNuevos}</div><div class="etiqueta">Clientes nuevos (todas las sucursales)</div></div>
    </div>`;
}

// ==================== PERMISOS SEGÚN PUESTO ====================

const DRAWER_SOLO_ENCARGADO = [
  'btn-abrir-compra-registro', 'btn-abrir-importar', 'btn-abrir-conteo', 'btn-abrir-compras',
  'btn-abrir-lealtad', 'btn-abrir-resenas', 'btn-abrir-reparto', 'btn-abrir-importar-recetas',
  'btn-abrir-menu-admin', 'btn-abrir-envios', 'btn-abrir-empleados', 'btn-abrir-profit-first',
];
const DRAWER_CAJERO_O_ENCARGADO = []; // Informes, Clientes y Repartidores quedan visibles a cajero también

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

  const origenSel = document.getElementById('copiar-menu-origen');
  const destinoSel = document.getElementById('copiar-menu-destino');
  const opciones = state.sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');
  origenSel.innerHTML = opciones;
  destinoSel.innerHTML = opciones;
  // Por conveniencia, precarga origen = sucursal actual, destino = la otra
  origenSel.value = document.getElementById('sucursal-select').value;
  const otra = state.sucursales.find((s) => String(s.id) !== origenSel.value);
  if (otra) destinoSel.value = otra.id;
}

document.getElementById('btn-copiar-menu').addEventListener('click', async () => {
  const sucursal_origen_id = document.getElementById('copiar-menu-origen').value;
  const sucursal_destino_id = document.getElementById('copiar-menu-destino').value;
  if (sucursal_origen_id === sucursal_destino_id) {
    alert('Elige dos sucursales distintas');
    return;
  }
  const origenNombre = state.sucursales.find((s) => String(s.id) === sucursal_origen_id)?.nombre;
  const destinoNombre = state.sucursales.find((s) => String(s.id) === sucursal_destino_id)?.nombre;
  if (!confirm(`¿Copiar todo el menú de "${origenNombre}" hacia "${destinoNombre}"? Esto AGREGA los productos, no borra lo que ya tenga "${destinoNombre}".`)) return;

  const btn = document.getElementById('btn-copiar-menu');
  btn.disabled = true;
  btn.textContent = 'Copiando...';

  const resp = await fetch('/api/admin/copiar-menu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sucursal_origen_id, sucursal_destino_id }),
  });
  const resultado = await resp.json();
  btn.disabled = false;
  btn.textContent = 'Copiar menú';

  if (!resp.ok) {
    alert(resultado.error || 'No se pudo copiar el menú');
    return;
  }
  alert(`Listo: se copiaron ${resultado.categoriasCopiadas} categoría(s) y ${resultado.productosCopiados} producto(s) a "${destinoNombre}".`);

  if (String(document.getElementById('sucursal-select').value) === String(sucursal_destino_id)) {
    cargarMenuAdmin();
  }
});

async function recargarCategoriasYProductos() {
  const sucursalId = document.getElementById('sucursal-select').value;
  state.categorias = await fetch(`/api/categorias?sucursal_id=${sucursalId}`).then((r) => r.json());
  state.productos = await fetch(`/api/productos?sucursal_id=${sucursalId}&todos=true`).then((r) => r.json());
}

function renderSelectCategoriasAdmin() {
  document.getElementById('nuevo-prod-categoria').innerHTML = state.categorias
    .map((c) => `<option value="${c.id}">${c.nombre}</option>`)
    .join('');
}

async function abrirModalEtiquetas(categoriaId, nombreCategoria) {
  const etiquetas = await fetch(`/api/etiquetas?categoria_id=${categoriaId}`).then((r) => r.json());
  delete etiquetasCache[categoriaId]; // invalida el caché usado al tomar pedidos, para que tome los cambios

  const html = `
    <div class="modal-overlay" id="modal-overlay-etiquetas">
      <div class="modal-box">
        <h3>Etiquetas de "${escapeHtml(nombreCategoria)}"</h3>
        <div style="font-size:12px;color:#888;margin-bottom:10px">Estas aparecen como opciones rápidas de comentario al agregar cualquier producto de esta categoría (ej. "Sin queso", "Poco aceite")</div>
        <div id="etiquetas-lista">
          ${
            etiquetas
              .map(
                (et) => `
            <div class="editar-item-row">
              <span>${escapeHtml(et.texto)}</span>
              <button data-borrar-etiqueta="${et.id}">×</button>
            </div>`
              )
              .join('') || '<p style="color:#999;font-size:13px">Sin etiquetas todavía</p>'
          }
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="text" id="nueva-etiqueta-texto" placeholder="Nueva etiqueta (ej. Sin cebolla)" style="flex:1;padding:9px;border-radius:8px;border:1px solid #ddd" />
          <button class="btn-agregar" id="btn-agregar-etiqueta" style="padding:9px 14px;border-radius:8px;border:none">+ Agregar</button>
        </div>
        <button class="btn-cancelar-modal" id="btn-cerrar-etiquetas">Cerrar</button>
      </div>
    </div>`;
  document.getElementById('modal-container').innerHTML = html;

  document.getElementById('modal-overlay-etiquetas').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay-etiquetas') document.getElementById('modal-container').innerHTML = '';
  });
  document.getElementById('btn-cerrar-etiquetas').addEventListener('click', () => {
    document.getElementById('modal-container').innerHTML = '';
  });
  document.querySelectorAll('[data-borrar-etiqueta]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/etiquetas/${btn.dataset.borrarEtiqueta}`, { method: 'DELETE' });
      abrirModalEtiquetas(categoriaId, nombreCategoria);
    });
  });
  document.getElementById('btn-agregar-etiqueta').addEventListener('click', async () => {
    const texto = document.getElementById('nueva-etiqueta-texto').value.trim();
    if (!texto) return;
    await fetch('/api/etiquetas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoria_id: categoriaId, texto }),
    });
    abrirModalEtiquetas(categoriaId, nombreCategoria);
  });
}

function renderCategoriasAdmin() {
  document.getElementById('categorias-admin-tabla-body').innerHTML = state.categorias
    .map(
      (c) => `
    <tr>
      <td><input type="text" class="categoria-nombre-edit" data-id="${c.id}" value="${c.nombre}" style="width:100%;padding:6px;border-radius:6px;border:1px solid #ddd" /></td>
      <td style="white-space:nowrap">
        <button class="btn-eliminar-fila" data-guardar-categoria="${c.id}" title="Guardar">💾</button>
        <button class="btn-eliminar-fila" data-etiquetas-categoria="${c.id}" data-nombre="${c.nombre}" title="Etiquetas de comentarios">🏷️</button>
        <button class="btn-eliminar-fila" data-borrar-categoria="${c.id}" title="Borrar">🗑️</button>
      </td>
    </tr>`
    )
    .join('');

  document.querySelectorAll('[data-etiquetas-categoria]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalEtiquetas(Number(btn.dataset.etiquetasCategoria), btn.dataset.nombre));
  });

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
    body: JSON.stringify({ nombre, sucursal_id: document.getElementById('sucursal-select').value }),
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
    body: JSON.stringify({ nombre, categoria_id, precio, sucursal_id: document.getElementById('sucursal-select').value }),
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
        <button class="btn-eliminar-fila" data-borrar-definitivo="${p.id}" data-nombre="${p.nombre}" title="Borrar definitivamente">🗑️</button>
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
  document.querySelectorAll('[data-borrar-definitivo]').forEach((btn) => {
    btn.addEventListener('click', () => borrarProductoDefinitivo(Number(btn.dataset.borrarDefinitivo), btn.dataset.nombre));
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

async function borrarProductoDefinitivo(productoId, nombre) {
  if (!confirm(`¿Borrar "${nombre}" DEFINITIVAMENTE del menú? Esto no se puede deshacer.\n\nSi ya se usó en algún pedido, no se va a poder borrar — solo ocultar (para eso usa el botón 👁️/🚫 en vez de este).`)) return;

  const resp = await fetch(`/api/productos/${productoId}/definitivo`, { method: 'DELETE' });
  if (!resp.ok) {
    const err = await resp.json();
    alert(err.error || 'No se pudo borrar');
    return;
  }
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


if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
