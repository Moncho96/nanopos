// ==================== INVENTARIO (pestaña de Administración) ====================
// Se carga después de app.js y reutiliza sus utilidades: state, escapeHtml, fechaNegocioActual,
// fechaLocalISO, dashFechaCorta y abrirModalReceta.

const INV = { tab: null, token: 0, alertasN: 0, insumos: null, proveedores: null, stock: { buscar: '', filtro: 'todos', categoria: '' } };
const INV_RENDER = {}; // una función por pestaña
const INV_ACC = {}; // acciones por data-acc (clics)
const INV_CHG = {}; // cambios por data-chg
const INV_INP = {}; // escritura en vivo por data-inp

const INV_TABS = [
  { id: 'resumen', et: '📊 Resumen', soloEncargado: true },
  { id: 'stock', et: '📦 Stock' },
  { id: 'alertas', et: '🚨 Alertas' },
  { id: 'entradas', et: '⬇️ Entradas', soloEncargado: true },
  { id: 'mermas', et: '🗑️ Mermas' },
  { id: 'produccion', et: '🍳 Producción' },
  { id: 'recetas', et: '🧾 Recetas y costos', soloEncargado: true },
  { id: 'proveedores', et: '🚚 Proveedores', soloEncargado: true },
  { id: 'cierre', et: '✅ Cierre de turno' },
  { id: 'movimientos', et: '📜 Movimientos' },
];

const INV_TIPOS = {
  saldo_inicial: ['Saldo inicial', '#6b7280'],
  entrada_compra: ['Compra', '#1a7d3a'],
  entrada_manual: ['Entrada manual', '#1a7d3a'],
  anulacion_compra: ['Compra anulada', '#b8232f'],
  venta: ['Venta', '#3c5a6b'],
  devolucion_venta: ['Devolución de venta', '#4f7942'],
  merma: ['Merma', '#b8232f'],
  produccion_consumo: ['Producción (usado)', '#8a6d3b'],
  produccion_entrada: ['Producción (obtenido)', '#1a7d3a'],
  traspaso_salida: ['Traspaso (sale)', '#a97800'],
  traspaso_entrada: ['Traspaso (entra)', '#a97800'],
  ajuste_manual: ['Ajuste manual', '#6b3550'],
  ajuste_conteo: ['Ajuste por conteo', '#6b3550'],
};
const INV_MOTIVOS_MERMA = {
  caducidad: 'Caducidad / se echó a perder', accidente: 'Accidente / se cayó', sobreproduccion: 'Sobreproducción',
  error_cocina: 'Error en cocina', devolucion_cliente: 'Devolución del cliente', faltante: 'Faltante sin explicación', otro: 'Otro',
};

// ---------- Utilidades ----------
const invEnc = () => state.empleado?.puesto === 'encargado';
const invSuc = () => document.getElementById('sucursal-select').value;
const invSucNombre = () => (state.sucursales.find((s) => String(s.id) === String(invSuc())) || {}).nombre || '';
const invEsc = (s) => escapeHtml(s === null || s === undefined ? '' : s);
const invAttr = (s) => invEsc(s).replace(/"/g, '&quot;');
const invNum = (n) => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 3 });
const invMoneda = (n, dec = 2) => {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
// Costo por unidad: 2 decimales cuando pasa de un peso; hasta 4 cuando son fracciones (ej. $0.0852 por gramo)
const invCosto = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1) return invMoneda(v);
  let s = invMoneda(v, 4);
  while (s.endsWith('0') && s.split('.')[1].length > 2) s = s.slice(0, -1); // $0.9000 → $0.90, $0.0852 se queda
  return s;
};
const invHora = (ts) => new Date(ts).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const invContenido = () => document.getElementById('inv-contenido');
const invAbierto = () => document.getElementById('overlay-inventario').classList.contains('abierto');

// Rango de fechas de negocio terminando hoy: invRango(1) = hoy, invRango(7) = últimos 7 días
function invRango(dias) {
  const hoy = new Date(fechaNegocioActual() + 'T12:00:00');
  const desde = new Date(hoy);
  desde.setDate(hoy.getDate() - (dias - 1));
  return { desde: fechaLocalISO(desde), hasta: fechaLocalISO(hoy) };
}

async function invApi(metodo, url, cuerpo) {
  try {
    const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, d };
  } catch (e) {
    return { ok: false, status: 0, d: { error: 'No se pudo conectar. Revisa tu internet e intenta de nuevo.' } };
  }
}

function invAviso(mensaje, error) {
  const el = document.createElement('div');
  el.textContent = mensaje;
  el.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:90vw;padding:11px 18px;border-radius:22px;z-index:500;font-size:14px;font-weight:600;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.3);background:${error ? '#b8232f' : '#2a231c'}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), error ? 4500 : 2600);
}

function invModal(html, onMount) {
  const cont = document.getElementById('modal-container');
  cont.innerHTML = `<div class="modal-overlay" id="inv-modal-overlay"><div class="modal-box">${html}</div></div>`;
  document.getElementById('inv-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'inv-modal-overlay') invCerrarModal();
  });
  if (onMount) onMount(cont);
}
function invCerrarModal() {
  document.getElementById('modal-container').innerHTML = '';
}

function invError(r) {
  invContenido().innerHTML = `<div class="inv-vacio">${invEsc(r.d?.error || 'No se pudo cargar')}<br><br><button class="inv-btn" data-acc="reintentar">Reintentar</button></div>`;
}
INV_ACC.reintentar = () => invIrA(INV.tab);

// Vista secundaria (formularios y detalles) con botón para volver a la pestaña
function invVista(titulo, html) {
  invContenido().innerHTML = `<div class="inv-volver"><button class="inv-btn chico" data-acc="volver">← Volver</button><span>${invEsc(titulo)}</span></div>${html}`;
  document.getElementById('overlay-inventario').scrollTop = 0;
}
INV_ACC.volver = () => invIrA(INV.tab);

async function invAsegurarInsumos(forzar) {
  if (INV.insumos && !forzar) return INV.insumos;
  const r = await invApi('GET', `/api/inventario/insumos?sucursal_id=${invSuc()}`);
  INV.insumos = r.ok ? r.d : [];
  return INV.insumos;
}
async function invAsegurarProveedores(forzar) {
  if (!invEnc()) return [];
  if (INV.proveedores && !forzar) return INV.proveedores;
  const r = await invApi('GET', '/api/inventario/proveedores');
  INV.proveedores = r.ok ? r.d : [];
  return INV.proveedores;
}
const invOpcionesInsumos = (lista, seleccionado, vacio) => {
  const porCat = {};
  lista.forEach((i) => (porCat[i.categoria || 'Sin categoría'] = porCat[i.categoria || 'Sin categoría'] || []).push(i));
  return (vacio ? `<option value="">${invEsc(vacio)}</option>` : '') +
    Object.keys(porCat).sort().map((c) => `<optgroup label="${invAttr(c)}">${porCat[c].map((i) => `<option value="${i.id}" ${String(seleccionado) === String(i.id) ? 'selected' : ''}>${invEsc(i.nombre)} (${invEsc(i.unidad)})</option>`).join('')}</optgroup>`).join('');
};

// ---------- Navegación ----------
function invPintarTabs() {
  const visibles = INV_TABS.filter((t) => !t.soloEncargado || invEnc());
  document.getElementById('inv-tabs').innerHTML = visibles
    .map((t) => `<button class="inv-tab ${t.id === INV.tab ? 'activo' : ''}" data-tab="${t.id}">${t.et}${t.id === 'alertas' && INV.alertasN ? `<span class="n">${INV.alertasN}</span>` : ''}</button>`)
    .join('');
}

async function invIrA(tab) {
  INV.tab = tab;
  const mi = ++INV.token;
  invPintarTabs();
  invContenido().innerHTML = '<div class="inv-vacio">Cargando…</div>';
  document.getElementById('overlay-inventario').scrollTop = 0;
  await INV_RENDER[tab](mi);
}

document.getElementById('inv-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) invIrA(b.dataset.tab);
});
invContenido().addEventListener('click', (e) => {
  const el = e.target.closest('[data-acc]');
  if (el && INV_ACC[el.dataset.acc]) INV_ACC[el.dataset.acc](el, e);
});
invContenido().addEventListener('change', (e) => {
  const el = e.target.closest('[data-chg]');
  if (el && INV_CHG[el.dataset.chg]) INV_CHG[el.dataset.chg](el, e);
});
invContenido().addEventListener('input', (e) => {
  const el = e.target.closest('[data-inp]');
  if (el && INV_INP[el.dataset.inp]) INV_INP[el.dataset.inp](el, e);
});
INV_ACC['ir-tab'] = (el) => invIrA(el.dataset.tab);

async function invActualizarBadge(reintentos = 0) {
  const suc = document.getElementById('sucursal-select').value;
  if (!suc) {
    if (reintentos < 10) setTimeout(() => invActualizarBadge(reintentos + 1), 600);
    return;
  }
  const r = await invApi('GET', `/api/inventario/alertas?sucursal_id=${suc}`);
  if (!r.ok) return;
  INV.alertasN = r.d.conteo.critica + r.d.conteo.alta;
  const b = document.getElementById('inv-badge');
  b.textContent = INV.alertasN;
  b.style.display = INV.alertasN ? 'block' : 'none';
  if (invAbierto()) invPintarTabs();
}

document.getElementById('btn-abrir-inventario').addEventListener('click', () => {
  document.getElementById('drawer-overlay').classList.remove('abierto');
  document.getElementById('overlay-inventario').classList.add('abierto');
  document.getElementById('inv-sucursal-label').textContent = `· ${invSucNombre()}`;
  INV.insumos = null;
  INV.proveedores = null;
  if (!INV.tab || (INV.tab === 'resumen' && !invEnc())) INV.tab = invEnc() ? 'resumen' : 'stock';
  invIrA(INV.tab);
  invActualizarBadge();
});
document.getElementById('btn-cerrar-inventario').addEventListener('click', () => {
  document.getElementById('overlay-inventario').classList.remove('abierto');
  invActualizarBadge();
});
document.getElementById('sucursal-select').addEventListener('change', () => {
  INV.insumos = null;
  INV.proveedores = null;
  if (invAbierto()) {
    document.getElementById('inv-sucursal-label').textContent = `· ${invSucNombre()}`;
    invIrA(INV.tab);
  }
  invActualizarBadge();
});
setTimeout(() => invActualizarBadge(), 1500);

// ==================== RESUMEN ====================
INV_RENDER.resumen = async (mi) => {
  const r = await invApi('GET', `/api/inventario/resumen?sucursal_id=${invSuc()}`);
  if (mi !== INV.token) return;
  if (!r.ok) return invError(r);
  const d = r.d;
  const al = d.alertas;
  const porSurtir = d.agotados + d.bajo_minimo;
  const totalAlertas = al.critica + al.alta + al.media + al.baja;

  invContenido().innerHTML = `
    <div class="inv-kpis">
      <div class="inv-kpi"><div class="et">Valor del inventario</div><div class="val">${invMoneda(d.valor_inventario, 0)}</div><div class="sub">${d.insumos_con_stock} de ${d.insumos_total} insumos con existencias</div></div>
      <div class="inv-kpi" data-acc="ver-por-surtir" style="cursor:pointer"><div class="et">Por surtir</div><div class="val ${porSurtir ? 'inv-neg' : 'inv-pos'}">${porSurtir}</div><div class="sub">${d.agotados} agotados · ${d.bajo_minimo} bajo mínimo</div></div>
      <div class="inv-kpi"><div class="et">Compras del mes</div><div class="val">${invMoneda(d.compras_mes, 0)}</div><div class="sub">${d.compras_mes_n} compra${d.compras_mes_n === 1 ? '' : 's'}</div></div>
      <div class="inv-kpi"><div class="et">Mermas del mes</div><div class="val ${d.merma_mes > 0 ? 'inv-neg' : ''}">${invMoneda(d.merma_mes, 0)}</div><div class="sub">${d.merma_pct}% de lo consumido · ${d.merma_mes_n} registro${d.merma_mes_n === 1 ? '' : 's'}</div></div>
      <div class="inv-kpi"><div class="et">Producción del mes</div><div class="val">${d.producciones_mes}</div><div class="sub">lotes registrados</div></div>
      <div class="inv-kpi" data-acc="ir-tab" data-tab="recetas" style="cursor:pointer"><div class="et">Platillos sin receta</div><div class="val ${d.productos_sin_receta ? 'inv-neg' : 'inv-pos'}">${d.productos_sin_receta}</div><div class="sub">no descuentan inventario</div></div>
    </div>

    <div class="inv-card" data-acc="ir-tab" data-tab="alertas" style="cursor:pointer">
      <h3>Alertas</h3>
      ${totalAlertas
        ? `<div style="display:flex;gap:14px;flex-wrap:wrap;font-weight:700">
            ${al.critica ? `<span>🔴 ${al.critica} crítica${al.critica === 1 ? '' : 's'}</span>` : ''}
            ${al.alta ? `<span>🟠 ${al.alta} alta${al.alta === 1 ? '' : 's'}</span>` : ''}
            ${al.media ? `<span>🟡 ${al.media} media${al.media === 1 ? '' : 's'}</span>` : ''}
            ${al.baja ? `<span>⚪ ${al.baja} baja${al.baja === 1 ? '' : 's'}</span>` : ''}
           </div><div class="inv-sub" style="margin-top:6px">Toca para verlas →</div>`
        : '<div class="inv-ok" style="margin:0">✅ Todo en orden: no hay alertas.</div>'}
    </div>

    ${d.top_mermas.length
      ? `<div class="inv-card"><h3>Lo que más se ha tirado este mes</h3>
          ${d.top_mermas.map((m) => `<div class="inv-fila"><div class="cuerpo"><div class="nombre">${invEsc(m.nombre)}</div><div class="detalle">${invNum(m.cantidad)} ${invEsc(m.unidad)}</div></div><strong class="inv-neg">${invMoneda(m.costo)}</strong></div>`).join('')}
        </div>`
      : ''}

    <div class="inv-card"><h3>Atajos</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="inv-btn primario" data-acc="nueva-compra">🧾 Nueva compra</button>
        <button class="inv-btn" data-acc="ir-tab" data-tab="mermas">🗑️ Registrar merma</button>
        <button class="inv-btn" data-acc="ir-tab" data-tab="cierre">✅ Cierre de turno</button>
        <button class="inv-btn" data-acc="pedido-sugerido">🛒 Pedido sugerido</button>
      </div>
    </div>`;
};
INV_ACC['ver-por-surtir'] = () => {
  INV.stock = { buscar: '', filtro: 'surtir', categoria: '' };
  invIrA('stock');
};

// ==================== ALERTAS ====================
const INV_ALERTA_DESTINO = {
  agotado: ['stock', 'Ver en stock'], bajo_minimo: ['stock', 'Ver en stock'], cobertura_baja: ['stock', 'Ver en stock'],
  sin_receta: ['recetas', 'Ver recetas'], costo_cero: ['recetas', 'Ver recetas'], precio_subio: ['proveedores', 'Ver proveedores'],
  merma_alta: ['mermas', 'Ver mermas'], descuadre_cierre: ['cierre', 'Ver cierres'], historial_descuadrado: ['movimientos', 'Ver movimientos'],
};
const INV_SEV = { critica: ['🔴', 'Crítica'], alta: ['🟠', 'Alta'], media: ['🟡', 'Media'], baja: ['⚪', 'Baja'] };

INV_RENDER.alertas = async (mi) => {
  const r = await invApi('GET', `/api/inventario/alertas?sucursal_id=${invSuc()}`);
  if (mi !== INV.token) return;
  if (!r.ok) return invError(r);
  INV.alertasN = r.d.conteo.critica + r.d.conteo.alta;
  invPintarTabs();
  const hayPorSurtir = r.d.alertas.some((a) => ['agotado', 'bajo_minimo'].includes(a.tipo));

  invContenido().innerHTML = `
    ${hayPorSurtir && invEnc() ? '<div style="margin-bottom:10px"><button class="inv-btn primario" data-acc="pedido-sugerido">🛒 Ver pedido sugerido a proveedores</button></div>' : ''}
    ${r.d.alertas.length
      ? r.d.alertas.map((a) => {
          const dest = INV_ALERTA_DESTINO[a.tipo];
          const puede = dest && (invEnc() || !['recetas', 'proveedores'].includes(dest[0]));
          return `<div class="inv-card inv-sev-${a.severidad}">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <div><div style="font-weight:700">${INV_SEV[a.severidad][0]} ${invEsc(a.titulo)}</div><div class="inv-sub" style="margin-top:3px">${invEsc(a.detalle)}</div></div>
              ${puede ? `<button class="inv-btn chico" data-acc="alerta-ver" data-tab="${dest[0]}" data-nombre="${invAttr(a.titulo.split(':')[0])}" style="flex-shrink:0">${dest[1]}</button>` : ''}
            </div></div>`;
        }).join('')
      : '<div class="inv-ok">✅ Todo en orden: no hay alertas en este momento.</div>'}
    <div class="inv-sub" style="margin-top:8px">Las alertas se calculan al abrir esta pestaña con el stock mínimo que configuraste, el ritmo de ventas de los últimos 14 días, tus compras, mermas y cierres de turno.</div>`;
};
INV_ACC['alerta-ver'] = (el) => {
  if (el.dataset.tab === 'stock') INV.stock = { buscar: el.dataset.nombre, filtro: 'todos', categoria: '' };
  invIrA(el.dataset.tab);
};

// ==================== STOCK ====================
INV_RENDER.stock = async (mi) => {
  await invAsegurarInsumos(true);
  if (mi !== INV.token) return;
  const cats = [...new Set(INV.insumos.map((i) => i.categoria).filter(Boolean))].sort();
  const f = INV.stock;
  invContenido().innerHTML = `
    <div class="inv-card" style="padding:10px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="inv-input" id="inv-stock-buscar" data-inp="stock-buscar" placeholder="Buscar insumo…" value="${invAttr(f.buscar)}" style="flex:1;min-width:150px" />
        ${cats.length ? `<select class="inv-input" data-chg="stock-cat" style="width:auto"><option value="">Todas las categorías</option>${cats.map((c) => `<option ${c === f.categoria ? 'selected' : ''}>${invEsc(c)}</option>`).join('')}</select>` : ''}
        ${invEnc() ? '<button class="inv-btn primario" data-acc="nuevo-insumo">+ Insumo</button>' : ''}
      </div>
      <div class="inv-chips" style="margin:10px 0 0">
        ${[['todos', 'Todos'], ['surtir', '⚠️ Por surtir'], ['criticos', '⭐ Críticos']].map(([k, et]) => `<button class="inv-chip ${f.filtro === k ? 'activo' : ''}" data-acc="stock-filtro" data-filtro="${k}">${et}</button>`).join('')}
      </div>
    </div>
    <div class="inv-card" id="inv-stock-lista" style="padding:4px 12px"></div>`;
  invPintarStock();
};
INV_INP['stock-buscar'] = (el) => { INV.stock.buscar = el.value; invPintarStock(); };
INV_CHG['stock-cat'] = (el) => { INV.stock.categoria = el.value; invPintarStock(); };
INV_ACC['stock-filtro'] = (el) => { INV.stock.filtro = el.dataset.filtro; invIrA('stock'); };

function invPintarStock() {
  const f = INV.stock;
  const q = f.buscar.trim().toLowerCase();
  const orden = { agotado: 0, bajo: 1, ok: 2 };
  const lista = INV.insumos
    .filter((i) => !q || i.nombre.toLowerCase().includes(q))
    .filter((i) => !f.categoria || i.categoria === f.categoria)
    .filter((i) => f.filtro === 'todos' || (f.filtro === 'surtir' && i.estado !== 'ok') || (f.filtro === 'criticos' && i.critico))
    .sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre));
  const enc = invEnc();
  const valor = enc ? lista.reduce((s, i) => s + (i.valor || 0), 0) : 0;

  document.getElementById('inv-stock-lista').innerHTML =
    `<div class="inv-sub" style="padding:8px 0">${lista.length} insumo${lista.length === 1 ? '' : 's'}${enc ? ` · valor ${invMoneda(valor, 0)}` : ''}</div>` +
    (lista.length
      ? lista.map((i) => `
        <div class="inv-fila"><div class="cuerpo">
          <div class="nombre">${i.critico ? '⭐ ' : ''}${invEsc(i.nombre)}${i.estado === 'agotado' ? '<span class="inv-estado est-agotado">Agotado</span>' : i.estado === 'bajo' ? '<span class="inv-estado est-bajo">Bajo</span>' : ''}</div>
          <div class="detalle">
            Stock: <b>${invNum(i.stock_actual)} ${invEsc(i.unidad)}</b>
            ${i.stock_minimo > 0 ? ` · mín ${invNum(i.stock_minimo)}` : ''}${i.stock_maximo ? ` · máx ${invNum(i.stock_maximo)}` : ''}
            ${i.cobertura_dias !== null ? ` · alcanza ~${i.cobertura_dias} días` : ''}
            ${enc ? `<br>Costo ${invCosto(i.costo_unitario)}/${invEsc(i.unidad)} · Valor ${invMoneda(i.valor)}${i.proveedor_nombre ? ` · ${invEsc(i.proveedor_nombre)}` : ''}${i.unidad_compra && i.factor_conversion !== 1 ? ` · 1 ${invEsc(i.unidad_compra)} = ${invNum(i.factor_conversion)} ${invEsc(i.unidad)}` : ''}` : ''}
          </div>
          <div class="acciones">
            <button class="inv-btn chico" data-acc="merma" data-id="${i.id}">🗑️ Merma</button>
            ${enc ? `<button class="inv-btn chico" data-acc="entrada" data-id="${i.id}">⬇️ Entrada</button><button class="inv-btn chico" data-acc="ajustar" data-id="${i.id}">✏️ Ajustar</button>` : ''}
            <button class="inv-btn chico" data-acc="historial" data-id="${i.id}">📜 Historial</button>
            ${enc ? `<button class="inv-btn chico" data-acc="editar-insumo" data-id="${i.id}">⚙️</button>` : ''}
          </div>
        </div></div>`).join('')
      : '<div class="inv-vacio">No hay insumos con ese filtro.</div>');
}

const invInsumo = (id) => (INV.insumos || []).find((i) => String(i.id) === String(id));

// ----- Merma -----
INV_ACC.merma = (el) => invModalMerma(el.dataset.id);
function invModalMerma(insumoId) {
  const i = invInsumo(insumoId);
  invModal(`
    <h3 style="margin:0 0 4px">🗑️ Registrar merma</h3>
    <div class="inv-sub">${invEsc(i.nombre)} · hay ${invNum(i.stock_actual)} ${invEsc(i.unidad)}</div>
    <label class="inv-label">Cantidad que se tiró (${invEsc(i.unidad)})</label>
    <input class="inv-input" id="m-cant" inputmode="decimal" placeholder="0" />
    <label class="inv-label">Motivo</label>
    <select class="inv-input" id="m-motivo"><option value="">Elige el motivo…</option>${Object.entries(INV_MOTIVOS_MERMA).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <label class="inv-label">Nota (opcional)</label>
    <input class="inv-input" id="m-nota" maxlength="200" placeholder="Ej. se descompuso el refri" />
    <div id="m-error" class="inv-neg" style="font-size:13px;margin-top:8px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="m-cancelar">Cancelar</button><button class="btn-agregar" id="m-guardar">Registrar</button></div>`,
  () => {
    document.getElementById('m-cant').addEventListener('input', (e) => (e.target.value = e.target.value.replace(/[^0-9.]/g, '')));
    document.getElementById('m-cancelar').addEventListener('click', invCerrarModal);
    document.getElementById('m-guardar').addEventListener('click', async () => {
      const cantidad = Number(document.getElementById('m-cant').value);
      const motivo = document.getElementById('m-motivo').value;
      const err = document.getElementById('m-error');
      if (!(cantidad > 0)) return (err.textContent = 'Escribe cuánto se tiró.');
      if (!motivo) return (err.textContent = 'Elige el motivo.');
      const btn = document.getElementById('m-guardar');
      btn.disabled = true;
      const r = await invApi('POST', '/api/inventario/movimientos', { sucursal_id: invSuc(), insumo_id: i.id, tipo: 'merma', cantidad, motivo, nota: document.getElementById('m-nota').value });
      if (!r.ok) { btn.disabled = false; return (err.textContent = r.d.error || 'No se pudo registrar.'); }
      invCerrarModal();
      invAviso(`Merma registrada. Quedan ${invNum(r.d.saldo_despues)} ${i.unidad} de ${i.nombre}.`);
      INV.insumos = null;
      invIrA(INV.tab);
      invActualizarBadge();
    });
  });
}

// ----- Entrada manual y ajuste (encargado) -----
INV_ACC.entrada = (el) => {
  const i = invInsumo(el.dataset.id);
  invModal(`
    <h3 style="margin:0 0 4px">⬇️ Entrada manual</h3>
    <div class="inv-sub">${invEsc(i.nombre)} · hay ${invNum(i.stock_actual)} ${invEsc(i.unidad)}. Para compras usa la pestaña Entradas (guarda proveedor y costo).</div>
    <label class="inv-label">Cantidad que entra (${invEsc(i.unidad)})</label><input class="inv-input" id="e-cant" inputmode="decimal" />
    <label class="inv-label">Motivo</label><input class="inv-input" id="e-motivo" maxlength="120" placeholder="Ej. donación, error de captura anterior" />
    <div id="e-error" class="inv-neg" style="font-size:13px;margin-top:8px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="e-cancelar">Cancelar</button><button class="btn-agregar" id="e-guardar">Registrar</button></div>`,
  () => {
    document.getElementById('e-cant').addEventListener('input', (e) => (e.target.value = e.target.value.replace(/[^0-9.]/g, '')));
    document.getElementById('e-cancelar').addEventListener('click', invCerrarModal);
    document.getElementById('e-guardar').addEventListener('click', async () => {
      const err = document.getElementById('e-error');
      const cantidad = Number(document.getElementById('e-cant').value);
      const motivo = document.getElementById('e-motivo').value;
      if (!(cantidad > 0)) return (err.textContent = 'Escribe la cantidad.');
      if (motivo.trim().length < 3) return (err.textContent = 'Escribe el motivo.');
      const r = await invApi('POST', '/api/inventario/movimientos', { sucursal_id: invSuc(), insumo_id: i.id, tipo: 'entrada_manual', cantidad, motivo });
      if (!r.ok) return (err.textContent = r.d.error || 'No se pudo registrar.');
      invCerrarModal();
      invAviso(`Entrada registrada. Ahora hay ${invNum(r.d.saldo_despues)} ${i.unidad}.`);
      invIrA(INV.tab);
    });
  });
};

INV_ACC.ajustar = (el) => {
  const i = invInsumo(el.dataset.id);
  invModal(`
    <h3 style="margin:0 0 4px">✏️ Ajustar stock</h3>
    <div class="inv-sub">${invEsc(i.nombre)} · el sistema dice ${invNum(i.stock_actual)} ${invEsc(i.unidad)}. Escribe lo que realmente hay: la diferencia queda registrada.</div>
    <label class="inv-label">Stock real (${invEsc(i.unidad)})</label><input class="inv-input" id="a-real" inputmode="decimal" value="${i.stock_actual}" />
    <label class="inv-label">Motivo</label><input class="inv-input" id="a-motivo" maxlength="120" placeholder="Ej. conteo físico, corrección" />
    <div id="a-error" class="inv-neg" style="font-size:13px;margin-top:8px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="a-cancelar">Cancelar</button><button class="btn-agregar" id="a-guardar">Guardar</button></div>`,
  () => {
    document.getElementById('a-real').addEventListener('input', (e) => (e.target.value = e.target.value.replace(/[^0-9.]/g, '')));
    document.getElementById('a-cancelar').addEventListener('click', invCerrarModal);
    document.getElementById('a-guardar').addEventListener('click', async () => {
      const err = document.getElementById('a-error');
      const real = document.getElementById('a-real').value;
      const motivo = document.getElementById('a-motivo').value;
      if (real === '') return (err.textContent = 'Escribe el stock real.');
      if (motivo.trim().length < 3) return (err.textContent = 'Escribe el motivo.');
      const r = await invApi('POST', '/api/inventario/movimientos', { sucursal_id: invSuc(), insumo_id: i.id, tipo: 'ajuste_manual', nuevo_stock: real, motivo });
      if (!r.ok) return (err.textContent = r.d.error || 'No se pudo ajustar.');
      invCerrarModal();
      invAviso(r.d.diferencia === 0 ? 'El stock ya coincidía: no hubo cambio.' : `Ajustado: ${r.d.diferencia > 0 ? '+' : ''}${invNum(r.d.diferencia)} ${i.unidad}.`);
      invIrA(INV.tab);
    });
  });
};

// ----- Historial de un insumo -----
INV_ACC.historial = async (el) => {
  const i = invInsumo(el.dataset.id);
  invVista(`Historial de ${i.nombre}`, '<div class="inv-vacio">Cargando…</div>');
  const r = await invApi('GET', `/api/inventario/movimientos?sucursal_id=${invSuc()}&insumo_id=${i.id}&limite=150`);
  if (!r.ok) return invError(r);
  invVista(`Historial de ${i.nombre}`, `
    <div class="inv-card" style="padding:4px 12px">
      <div class="inv-sub" style="padding:8px 0">Hay ${invNum(i.stock_actual)} ${invEsc(i.unidad)}. Últimos ${r.d.length} movimientos:</div>
      ${invFilasMovimientos(r.d, false)}
    </div>`);
};

function invFilasMovimientos(lista, mostrarInsumo) {
  if (!lista.length) return '<div class="inv-vacio">Sin movimientos en este periodo.</div>';
  const enc = invEnc();
  return lista.map((m) => {
    const [et, color] = INV_TIPOS[m.tipo] || [m.tipo, '#666'];
    const pos = m.cantidad > 0;
    const detalle = [m.motivo && (INV_MOTIVOS_MERMA[m.motivo] || m.motivo), m.nota, m.empleado_nombre && `por ${m.empleado_nombre}`].filter(Boolean).join(' · ');
    return `<div class="inv-fila"><div class="cuerpo">
      <div class="nombre">${mostrarInsumo ? `${invEsc(m.insumo_nombre)} ` : ''}<span class="inv-estado" style="background:${color}22;color:${color};margin-left:${mostrarInsumo ? 4 : 0}px">${invEsc(et)}</span></div>
      <div class="detalle">${invHora(m.creado_en)}${detalle ? ` · ${invEsc(detalle)}` : ''}${enc && m.valor !== null && m.valor !== undefined ? ` · ${invMoneda(m.valor)}` : ''}</div>
    </div>
    <div style="text-align:right;white-space:nowrap"><div class="${pos ? 'inv-pos' : 'inv-neg'}" style="font-weight:800">${pos ? '+' : ''}${invNum(m.cantidad)} ${invEsc(m.unidad)}</div>
      <div class="inv-sub">${m.saldo_despues === null ? '' : `quedan ${invNum(m.saldo_despues)}`}</div></div></div>`;
  }).join('');
}

// ----- Crear / editar insumo (encargado) -----
INV_ACC['nuevo-insumo'] = () => invFormInsumo(null);
INV_ACC['editar-insumo'] = (el) => invFormInsumo(invInsumo(el.dataset.id));

async function invFormInsumo(i) {
  const provs = await invAsegurarProveedores();
  const cats = [...new Set((INV.insumos || []).map((x) => x.categoria).filter(Boolean))].sort();
  const v = i || { nombre: '', unidad: '', categoria: '', proveedor_id: null, unidad_compra: '', factor_conversion: 1, critico: false, costo_unitario: 0, stock_minimo: 0, stock_maximo: null };
  invModal(`
    <h3 style="margin:0 0 8px">${i ? '⚙️ Editar insumo' : '+ Nuevo insumo'}</h3>
    <div class="inv-grid2">
      <div><label class="inv-label" style="margin-top:0">Nombre</label><input class="inv-input" id="i-nombre" maxlength="80" value="${invAttr(v.nombre)}" /></div>
      <div><label class="inv-label" style="margin-top:0">Unidad base</label><input class="inv-input" id="i-unidad" maxlength="20" placeholder="kg, l, pza…" value="${invAttr(v.unidad)}" /></div>
    </div>
    <label class="inv-label">Categoría</label>
    <input class="inv-input" id="i-cat" list="inv-cats" maxlength="40" placeholder="Carnes, Verduras, Abarrotes…" value="${invAttr(v.categoria)}" />
    <datalist id="inv-cats">${cats.map((c) => `<option value="${invAttr(c)}">`).join('')}</datalist>
    <label class="inv-label">Proveedor habitual</label>
    <select class="inv-input" id="i-prov"><option value="">— Sin proveedor —</option>${provs.filter((p) => p.activo || p.id === v.proveedor_id).map((p) => `<option value="${p.id}" ${p.id === v.proveedor_id ? 'selected' : ''}>${invEsc(p.nombre)}</option>`).join('')}</select>

    <div class="inv-card" style="background:#f7f7f7;margin:12px 0 0;padding:10px">
      <div style="font-weight:700;font-size:13px">Factor de conversión (compras)</div>
      <div class="inv-sub">Si lo compras en caja, bulto o costal, dile cuánto trae: al registrar la compra, el sistema convierte solo a tu unidad base.</div>
      <div class="inv-grid2">
        <div><label class="inv-label">Se compra por</label><input class="inv-input" id="i-ucompra" maxlength="30" placeholder="caja, bulto, costal…" value="${invAttr(v.unidad_compra)}" /></div>
        <div><label class="inv-label">1 de esas trae</label><input class="inv-input" id="i-factor" inputmode="decimal" value="${v.factor_conversion}" /></div>
      </div>
      <div class="inv-sub" id="i-preview" style="margin-top:6px"></div>
    </div>

    <div class="inv-grid2">
      <div><label class="inv-label">Stock mínimo (esta sucursal)</label><input class="inv-input" id="i-min" inputmode="decimal" value="${v.stock_minimo || ''}" placeholder="0" /></div>
      <div><label class="inv-label">Stock máximo (opcional)</label><input class="inv-input" id="i-max" inputmode="decimal" value="${v.stock_maximo || ''}" placeholder="—" /></div>
    </div>
    <label class="inv-label">Costo por unidad base ($)</label>
    <input class="inv-input" id="i-costo" inputmode="decimal" value="${v.costo_unitario || ''}" placeholder="Se actualiza solo con cada compra" />
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:14px"><input type="checkbox" id="i-critico" ${v.critico ? 'checked' : ''} /> ⭐ Crítico: incluirlo en el conteo del cierre de turno</label>
    <div id="i-error" class="inv-neg" style="font-size:13px;margin-top:8px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="i-cancelar">Cancelar</button><button class="btn-agregar" id="i-guardar">Guardar</button></div>`,
  () => {
    const $ = (id) => document.getElementById(id);
    ['i-factor', 'i-min', 'i-max', 'i-costo'].forEach((id) => $(id).addEventListener('input', (e) => (e.target.value = e.target.value.replace(/[^0-9.]/g, ''))));
    const preview = () => {
      const f = Number($('i-factor').value);
      const uc = $('i-ucompra').value.trim();
      const ub = $('i-unidad').value.trim() || 'unidad base';
      $('i-preview').textContent = uc && f > 0 ? `Ejemplo: comprar 2 ${uc}s = ${invNum(2 * f)} ${ub} en tu inventario.` : '';
    };
    ['i-factor', 'i-ucompra', 'i-unidad'].forEach((id) => $(id).addEventListener('input', preview));
    preview();
    $('i-cancelar').addEventListener('click', invCerrarModal);
    $('i-guardar').addEventListener('click', async () => {
      const err = $('i-error');
      const cuerpo = {
        nombre: $('i-nombre').value, unidad: $('i-unidad').value, categoria: $('i-cat').value, proveedor_id: $('i-prov').value || null,
        unidad_compra: $('i-ucompra').value, factor_conversion: $('i-factor').value === '' ? 1 : Number($('i-factor').value),
        critico: $('i-critico').checked, sucursal_id: invSuc(), stock_minimo: $('i-min').value === '' ? 0 : Number($('i-min').value),
        stock_maximo: $('i-max').value === '' ? null : Number($('i-max').value),
      };
      if ($('i-costo').value !== '') cuerpo.costo_unitario = Number($('i-costo').value);
      if (!cuerpo.nombre.trim() || !cuerpo.unidad.trim()) return (err.textContent = 'Falta el nombre o la unidad.');
      if (!(cuerpo.factor_conversion > 0)) return (err.textContent = 'El factor debe ser mayor a cero.');
      const r = i ? await invApi('PATCH', `/api/inventario/insumos/${i.id}`, cuerpo) : await invApi('POST', '/api/inventario/insumos', cuerpo);
      if (!r.ok) return (err.textContent = r.d.error || 'No se pudo guardar.');
      invCerrarModal();
      invAviso(i ? 'Insumo actualizado.' : 'Insumo creado.');
      INV.insumos = null;
      invIrA(INV.tab);
    });
  });
}

// ==================== MOVIMIENTOS (kardex) ====================
const INV_MOV = { tipo: '', insumo: '', dias: 7 };
INV_RENDER.movimientos = async (mi) => {
  await invAsegurarInsumos();
  if (mi !== INV.token) return;
  invContenido().innerHTML = `
    <div class="inv-card">
      <div class="inv-grid2">
        <div><label class="inv-label" style="margin-top:0">Tipo</label><select class="inv-input" data-chg="mov-tipo"><option value="">Todos</option>${Object.entries(INV_TIPOS).map(([k, [et]]) => `<option value="${k}" ${INV_MOV.tipo === k ? 'selected' : ''}>${et}</option>`).join('')}</select></div>
        <div><label class="inv-label" style="margin-top:0">Insumo</label><select class="inv-input" data-chg="mov-insumo">${invOpcionesInsumos(INV.insumos, INV_MOV.insumo, 'Todos')}</select></div>
      </div>
      <div class="inv-chips" style="margin:10px 0 0">${[[1, 'Hoy'], [7, '7 días'], [30, '30 días']].map(([d, et]) => `<button class="inv-chip ${INV_MOV.dias === d ? 'activo' : ''}" data-acc="mov-dias" data-dias="${d}">${et}</button>`).join('')}</div>
    </div>
    <div class="inv-card" id="inv-mov-lista" style="padding:4px 12px"><div class="inv-vacio">Cargando…</div></div>`;
  invPintarMovimientos(mi);
};
INV_CHG['mov-tipo'] = (el) => { INV_MOV.tipo = el.value; invPintarMovimientos(INV.token); };
INV_CHG['mov-insumo'] = (el) => { INV_MOV.insumo = el.value; invPintarMovimientos(INV.token); };
INV_ACC['mov-dias'] = (el) => { INV_MOV.dias = Number(el.dataset.dias); invIrA('movimientos'); };

async function invPintarMovimientos(mi) {
  const { desde, hasta } = invRango(INV_MOV.dias);
  const r = await invApi('GET', `/api/inventario/movimientos?sucursal_id=${invSuc()}&fecha_desde=${desde}&fecha_hasta=${hasta}&limite=300${INV_MOV.tipo ? `&tipo=${INV_MOV.tipo}` : ''}${INV_MOV.insumo ? `&insumo_id=${INV_MOV.insumo}` : ''}`);
  if (mi !== INV.token || INV.tab !== 'movimientos') return;
  const cont = document.getElementById('inv-mov-lista');
  if (!cont) return;
  if (!r.ok) return (cont.innerHTML = `<div class="inv-vacio">${invEsc(r.d.error || 'No se pudo cargar')}</div>`);
  cont.innerHTML = `<div class="inv-sub" style="padding:8px 0">${r.d.length}${r.d.length >= 300 ? '+' : ''} movimiento${r.d.length === 1 ? '' : 's'}</div>${invFilasMovimientos(r.d, true)}`;
}

// ==================== ENTRADAS (compras, traspasos, pedido sugerido) ====================
const INV_ENT = { dias: 30 };
INV_RENDER.entradas = async (mi) => {
  const { desde, hasta } = invRango(INV_ENT.dias);
  const r = await invApi('GET', `/api/inventario/compras?sucursal_id=${invSuc()}&fecha_desde=${desde}&fecha_hasta=${hasta}`);
  if (mi !== INV.token) return;
  if (!r.ok) return invError(r);
  const d = r.d;
  invContenido().innerHTML = `
    <div class="inv-card">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="inv-btn primario" data-acc="nueva-compra">🧾 Nueva compra</button>
        <button class="inv-btn" data-acc="ticket-foto">📷 Compra con foto de ticket</button>
        <button class="inv-btn" data-acc="nuevo-traspaso">🔁 Traspaso</button>
        <button class="inv-btn" data-acc="pedido-sugerido">🛒 Pedido sugerido</button>
        <button class="inv-btn" data-acc="plan-compras">🤖 Plan de compras (IA)</button>
      </div>
      <div class="inv-sub" style="margin-top:8px">Las compras se capturan en la unidad en que las compras (cajas, bultos…) y el sistema las convierte a tu unidad base, actualiza el costo promedio y avisa si un precio subió.</div>
    </div>
    <div class="inv-chips">${[[7, '7 días'], [30, '30 días'], [90, '90 días']].map(([n, et]) => `<button class="inv-chip ${INV_ENT.dias === n ? 'activo' : ''}" data-acc="ent-dias" data-dias="${n}">${et}</button>`).join('')}</div>
    <div class="inv-kpis"><div class="inv-kpi"><div class="et">Comprado en el periodo</div><div class="val">${invMoneda(d.total)}</div><div class="sub">${d.compras.filter((c) => !c.anulada).length} compra${d.compras.filter((c) => !c.anulada).length === 1 ? '' : 's'} vigente${d.compras.filter((c) => !c.anulada).length === 1 ? '' : 's'}</div></div></div>
    ${d.compras.length
      ? d.compras.map((c) => `
        <div class="inv-card" style="${c.anulada ? 'opacity:.55' : ''}">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
            <div><div class="nombre" style="font-weight:700">${dashFechaCorta(c.fecha)} · ${invEsc(c.proveedor_nombre || 'Sin proveedor')}${c.anulada ? ' <span class="inv-estado est-agotado">Anulada</span>' : ''}</div>
              <div class="inv-sub">${c.folio ? `Folio ${invEsc(c.folio)} · ` : ''}${c.items.length} renglón${c.items.length === 1 ? '' : 'es'}${c.empleado_nombre ? ` · ${invEsc(c.empleado_nombre)}` : ''}</div></div>
            <strong style="${c.anulada ? 'text-decoration:line-through' : ''}">${invMoneda(c.total)}</strong>
          </div>
          <details style="margin-top:6px"><summary class="inv-sub" style="cursor:pointer">Ver renglones</summary>
            ${c.items.map((it) => `<div class="inv-sub" style="padding:3px 0">• ${invEsc(it.insumo_nombre)}: ${it.cantidad_compra ? `${invNum(it.cantidad_compra)} ${invEsc(it.unidad_compra || it.unidad)} a ${invMoneda(it.precio_compra)} → ` : ''}${invNum(it.cantidad)} ${invEsc(it.unidad)} (${invCosto(it.costo_unitario)}/${invEsc(it.unidad)})</div>`).join('')}
          </details>
          ${c.anulada ? '' : `<div style="margin-top:8px"><button class="inv-btn chico" data-acc="anular-compra" data-id="${c.id}" data-total="${c.total}">Anular compra</button></div>`}
        </div>`).join('')
      : '<div class="inv-vacio">No hay compras en este periodo.</div>'}`;
};
INV_ACC['ent-dias'] = (el) => { INV_ENT.dias = Number(el.dataset.dias); invIrA('entradas'); };
INV_ACC['ticket-foto'] = () => document.getElementById('btn-abrir-compra-registro').click();
INV_ACC['plan-compras'] = () => document.getElementById('btn-abrir-compras').click();

INV_ACC['anular-compra'] = (el) => {
  invModal(`
    <h3 style="margin:0 0 6px">Anular compra</h3>
    <div class="inv-sub">Se le quitará al inventario lo que entró con esta compra (${invMoneda(el.dataset.total)}). El costo promedio de los insumos no se revierte. Esta acción no se puede deshacer.</div>
    <label class="inv-label">Motivo</label><input class="inv-input" id="an-motivo" maxlength="120" placeholder="Ej. se capturó doble" />
    <div id="an-error" class="inv-neg" style="font-size:13px;margin-top:8px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="an-cancelar">Cancelar</button><button class="btn-agregar" id="an-ok" style="background:#b8232f">Anular</button></div>`,
  () => {
    document.getElementById('an-cancelar').addEventListener('click', invCerrarModal);
    document.getElementById('an-ok').addEventListener('click', async () => {
      const r = await invApi('POST', `/api/inventario/compras/${el.dataset.id}/anular`, { motivo: document.getElementById('an-motivo').value });
      if (!r.ok) return (document.getElementById('an-error').textContent = r.d.error || 'No se pudo anular.');
      invCerrarModal();
      invAviso('Compra anulada y stock revertido.');
      INV.insumos = null;
      invIrA('entradas');
      invActualizarBadge();
    });
  });
};

// ----- Nueva compra -----
const INV_COMPRA = { lineas: [], proveedor_id: '', fecha: '', folio: '', proveedor_nombre: '' };
INV_ACC['nueva-compra'] = async () => {
  if (!invEnc()) return;
  await Promise.all([invAsegurarInsumos(true), invAsegurarProveedores(true)]);
  INV.tab = 'entradas';
  Object.assign(INV_COMPRA, { lineas: [{ insumo_id: '', cant: '', precio: '' }], proveedor_id: '', fecha: fechaNegocioActual(), folio: '', proveedor_nombre: '' });
  invPintarFormCompra();
};

function invPintarFormCompra() {
  const provs = (INV.proveedores || []).filter((p) => p.activo);
  invVista('Nueva compra', `
    <div class="inv-card">
      <label class="inv-label" style="margin-top:0">Proveedor</label>
      <select class="inv-input" data-chg="compra-prov"><option value="">— Sin proveedor registrado —</option>${provs.map((p) => `<option value="${p.id}" ${String(INV_COMPRA.proveedor_id) === String(p.id) ? 'selected' : ''}>${invEsc(p.nombre)}</option>`).join('')}</select>
      ${INV_COMPRA.proveedor_id ? '' : `<input class="inv-input" style="margin-top:6px" data-inp="compra-provnombre" maxlength="80" placeholder="Nombre de la tienda o proveedor (opcional)" value="${invAttr(INV_COMPRA.proveedor_nombre)}" />`}
      <div class="inv-grid2">
        <div><label class="inv-label">Fecha</label><input type="date" class="inv-input" data-chg="compra-fecha" value="${invAttr(INV_COMPRA.fecha)}" /></div>
        <div><label class="inv-label">Folio / factura (opcional)</label><input class="inv-input" data-inp="compra-folio" maxlength="40" value="${invAttr(INV_COMPRA.folio)}" /></div>
      </div>
    </div>
    <div id="compra-lineas"></div>
    <div style="margin-bottom:10px"><button class="inv-btn" data-acc="compra-agregar">+ Agregar renglón</button></div>
    <div class="inv-card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div><div class="inv-sub">Total de la compra</div><div style="font-size:24px;font-weight:800" id="compra-total">$0.00</div></div>
      <button class="inv-btn primario" data-acc="compra-guardar" id="compra-guardar">Guardar compra</button>
    </div>
    <div id="compra-error" class="inv-neg" style="font-size:13px"></div>`);
  invPintarLineasCompra();
}

function invPintarLineasCompra() {
  document.getElementById('compra-lineas').innerHTML = INV_COMPRA.lineas.map((l, n) => {
    const ins = invInsumo(l.insumo_id);
    const uc = ins ? ins.unidad_compra || ins.unidad : 'unidad';
    return `<div class="inv-card">
      <select class="inv-input" data-chg="compra-insumo" data-n="${n}">${invOpcionesInsumos(INV.insumos, l.insumo_id, 'Elige el insumo…')}</select>
      <div class="inv-grid2">
        <div><label class="inv-label">Cantidad (${invEsc(uc)})</label><input class="inv-input" inputmode="decimal" data-inp="compra-cant" data-n="${n}" value="${invAttr(l.cant)}" /></div>
        <div><label class="inv-label">Precio por ${invEsc(uc)} ($)</label><input class="inv-input" inputmode="decimal" data-inp="compra-precio" data-n="${n}" value="${invAttr(l.precio)}" /></div>
      </div>
      <div class="inv-sub" id="compra-prev-${n}" style="margin-top:6px"></div>
      ${INV_COMPRA.lineas.length > 1 ? `<div style="margin-top:6px"><button class="inv-btn chico" data-acc="compra-quitar" data-n="${n}">Quitar renglón</button></div>` : ''}
    </div>`;
  }).join('');
  INV_COMPRA.lineas.forEach((_, n) => invActualizarPrevCompra(n));
  invActualizarTotalCompra();
}

function invActualizarPrevCompra(n) {
  const l = INV_COMPRA.lineas[n];
  const el = document.getElementById(`compra-prev-${n}`);
  if (!el) return;
  const ins = invInsumo(l.insumo_id);
  const cant = Number(l.cant);
  const precio = Number(l.precio);
  if (!ins || !(cant > 0) || l.precio === '' || !(precio >= 0)) return (el.innerHTML = ins && ins.factor_conversion !== 1 ? `<span class="inv-sub">1 ${invEsc(ins.unidad_compra || ins.unidad)} = ${invNum(ins.factor_conversion)} ${invEsc(ins.unidad)}</span>` : '');
  const f = ins.factor_conversion || 1;
  const base = cant * f;
  const costoBase = precio / f;
  const dif = ins.costo_unitario > 0 ? (costoBase - ins.costo_unitario) / ins.costo_unitario : 0;
  el.innerHTML = `Entran <b>${invNum(base)} ${invEsc(ins.unidad)}</b> a ${invCosto(costoBase)}/${invEsc(ins.unidad)} · subtotal <b>${invMoneda(cant * precio)}</b>` +
    (dif > 0.1 ? `<div class="inv-aviso">⚠️ Sube ${Math.round(dif * 100)}% contra tu costo actual (${invCosto(ins.costo_unitario)}/${invEsc(ins.unidad)}).</div>` : '');
}
function invActualizarTotalCompra() {
  const total = INV_COMPRA.lineas.reduce((s, l) => s + (Number(l.cant) > 0 && Number(l.precio) >= 0 ? Number(l.cant) * Number(l.precio) : 0), 0);
  const el = document.getElementById('compra-total');
  if (el) el.textContent = invMoneda(total);
}
INV_CHG['compra-prov'] = (el) => { INV_COMPRA.proveedor_id = el.value; invPintarFormCompra(); };
INV_CHG['compra-fecha'] = (el) => { INV_COMPRA.fecha = el.value; };
INV_INP['compra-folio'] = (el) => { INV_COMPRA.folio = el.value; };
INV_INP['compra-provnombre'] = (el) => { INV_COMPRA.proveedor_nombre = el.value; };
INV_CHG['compra-insumo'] = (el) => { INV_COMPRA.lineas[el.dataset.n].insumo_id = el.value; invPintarLineasCompra(); };
INV_INP['compra-cant'] = (el) => { el.value = el.value.replace(/[^0-9.]/g, ''); INV_COMPRA.lineas[el.dataset.n].cant = el.value; invActualizarPrevCompra(el.dataset.n); invActualizarTotalCompra(); };
INV_INP['compra-precio'] = (el) => { el.value = el.value.replace(/[^0-9.]/g, ''); INV_COMPRA.lineas[el.dataset.n].precio = el.value; invActualizarPrevCompra(el.dataset.n); invActualizarTotalCompra(); };
INV_ACC['compra-agregar'] = () => { INV_COMPRA.lineas.push({ insumo_id: '', cant: '', precio: '' }); invPintarLineasCompra(); };
INV_ACC['compra-quitar'] = (el) => { INV_COMPRA.lineas.splice(Number(el.dataset.n), 1); invPintarLineasCompra(); };
INV_ACC['compra-guardar'] = async () => {
  const err = document.getElementById('compra-error');
  const items = INV_COMPRA.lineas.filter((l) => l.insumo_id || l.cant || l.precio);
  if (!items.length) return (err.textContent = 'Agrega al menos un renglón.');
  for (const l of items) {
    const ins = invInsumo(l.insumo_id);
    if (!ins) return (err.textContent = 'Un renglón no tiene insumo.');
    if (!(Number(l.cant) > 0)) return (err.textContent = `Falta la cantidad de ${ins.nombre}.`);
    if (l.precio === '' || !(Number(l.precio) >= 0)) return (err.textContent = `Falta el precio de ${ins.nombre}.`);
  }
  const btn = document.getElementById('compra-guardar');
  btn.disabled = true;
  err.textContent = '';
  const r = await invApi('POST', '/api/inventario/compras', {
    sucursal_id: invSuc(), proveedor_id: INV_COMPRA.proveedor_id || null, proveedor_nombre: INV_COMPRA.proveedor_nombre,
    fecha: INV_COMPRA.fecha, folio: INV_COMPRA.folio,
    items: items.map((l) => ({ insumo_id: Number(l.insumo_id), cantidad_compra: Number(l.cant), precio_compra: Number(l.precio) })),
  });
  if (!r.ok) { btn.disabled = false; return (err.textContent = r.d.error || 'No se pudo guardar la compra.'); }
  INV.insumos = null;
  INV.proveedores = null;
  const alzas = r.d.alertas_precio || [];
  invAviso(`Compra guardada: ${invMoneda(r.d.compra.total)}`);
  invIrA('entradas');
  invActualizarBadge();
  if (alzas.length) {
    invModal(`<h3 style="margin:0 0 8px">⚠️ Precios que subieron</h3>
      ${alzas.map((a) => `<div class="inv-fila"><div class="cuerpo"><div class="nombre">${invEsc(a.nombre)}</div><div class="detalle">Antes ${invCosto(a.anterior)}/${invEsc(a.unidad)} → ahora ${invCosto(a.nuevo)}/${invEsc(a.unidad)}</div></div><strong class="inv-neg">+${a.pct}%</strong></div>`).join('')}
      <div class="modal-botones"><button class="btn-agregar" id="al-ok">Entendido</button></div>`,
    () => document.getElementById('al-ok').addEventListener('click', invCerrarModal));
  }
};

// ----- Traspaso entre sucursales -----
const INV_TRAS = { destino: '', lineas: [], nota: '' };
INV_ACC['nuevo-traspaso'] = async () => {
  const otras = state.sucursales.filter((s) => String(s.id) !== String(invSuc()));
  if (!otras.length) return invAviso('No hay otra sucursal a la cual mandar.', true);
  await invAsegurarInsumos(true);
  Object.assign(INV_TRAS, { destino: otras[0].id, lineas: [{ insumo_id: '', cant: '' }], nota: '' });
  invPintarFormTraspaso();
};
function invPintarFormTraspaso() {
  const otras = state.sucursales.filter((s) => String(s.id) !== String(invSuc()));
  invVista('Traspaso entre sucursales', `
    <div class="inv-card">
      <div class="inv-sub">Sale de <b>${invEsc(invSucNombre())}</b> y entra a la sucursal que elijas. Queda registrado en el historial de las dos.</div>
      <label class="inv-label">Se manda a</label>
      <select class="inv-input" data-chg="tras-destino">${otras.map((s) => `<option value="${s.id}" ${String(INV_TRAS.destino) === String(s.id) ? 'selected' : ''}>${invEsc(s.nombre)}</option>`).join('')}</select>
      <label class="inv-label">Nota (opcional)</label><input class="inv-input" data-inp="tras-nota" maxlength="200" value="${invAttr(INV_TRAS.nota)}" />
    </div>
    ${INV_TRAS.lineas.map((l, n) => {
      const ins = invInsumo(l.insumo_id);
      return `<div class="inv-card">
        <select class="inv-input" data-chg="tras-insumo" data-n="${n}">${invOpcionesInsumos(INV.insumos.filter((i) => i.stock_actual > 0 || String(i.id) === String(l.insumo_id)), l.insumo_id, 'Elige el insumo…')}</select>
        <label class="inv-label">Cantidad${ins ? ` (${invEsc(ins.unidad)}) · disponible ${invNum(ins.stock_actual)}` : ''}</label>
        <input class="inv-input" inputmode="decimal" data-inp="tras-cant" data-n="${n}" value="${invAttr(l.cant)}" />
        ${INV_TRAS.lineas.length > 1 ? `<div style="margin-top:6px"><button class="inv-btn chico" data-acc="tras-quitar" data-n="${n}">Quitar</button></div>` : ''}
      </div>`;
    }).join('')}
    <div style="display:flex;gap:8px;margin-bottom:10px"><button class="inv-btn" data-acc="tras-agregar">+ Agregar renglón</button><button class="inv-btn primario" data-acc="tras-guardar" id="tras-guardar">Mandar traspaso</button></div>
    <div id="tras-error" class="inv-neg" style="font-size:13px"></div>`);
}
INV_CHG['tras-destino'] = (el) => { INV_TRAS.destino = el.value; };
INV_INP['tras-nota'] = (el) => { INV_TRAS.nota = el.value; };
INV_CHG['tras-insumo'] = (el) => { INV_TRAS.lineas[el.dataset.n].insumo_id = el.value; invPintarFormTraspaso(); };
INV_INP['tras-cant'] = (el) => { el.value = el.value.replace(/[^0-9.]/g, ''); INV_TRAS.lineas[el.dataset.n].cant = el.value; };
INV_ACC['tras-agregar'] = () => { INV_TRAS.lineas.push({ insumo_id: '', cant: '' }); invPintarFormTraspaso(); };
INV_ACC['tras-quitar'] = (el) => { INV_TRAS.lineas.splice(Number(el.dataset.n), 1); invPintarFormTraspaso(); };
INV_ACC['tras-guardar'] = async () => {
  const err = document.getElementById('tras-error');
  const items = INV_TRAS.lineas.filter((l) => l.insumo_id || l.cant);
  if (!items.length || items.some((l) => !l.insumo_id || !(Number(l.cant) > 0))) return (err.textContent = 'Cada renglón necesita insumo y una cantidad mayor a cero.');
  const btn = document.getElementById('tras-guardar');
  btn.disabled = true;
  const r = await invApi('POST', '/api/inventario/traspasos', { origen_id: invSuc(), destino_id: INV_TRAS.destino, nota: INV_TRAS.nota, items: items.map((l) => ({ insumo_id: Number(l.insumo_id), cantidad: Number(l.cant) })) });
  if (!r.ok) { btn.disabled = false; return (err.textContent = r.d.error || 'No se pudo hacer el traspaso.'); }
  INV.insumos = null;
  invAviso(`Traspaso enviado (${r.d.insumos} insumo${r.d.insumos === 1 ? '' : 's'}).`);
  invIrA('entradas');
};

// ----- Pedido sugerido (con WhatsApp) -----
const invTelefonoWA = (t) => {
  const d = String(t || '').replace(/\D/g, '');
  return d.length === 10 ? `52${d}` : d;
};
INV_ACC['pedido-sugerido'] = async () => {
  if (!invEnc()) return;
  INV.tab = 'entradas';
  invVista('Pedido sugerido', '<div class="inv-vacio">Calculando…</div>');
  const r = await invApi('GET', `/api/inventario/pedido-sugerido?sucursal_id=${invSuc()}`);
  if (!r.ok) return invError(r);
  INV.pedidos = r.d;
  invVista('Pedido sugerido', `
    <div class="inv-sub" style="margin-bottom:10px">Lo que está agotado o bajo su mínimo, agrupado por proveedor, para llegar al stock máximo (o al doble del mínimo si no pusiste máximo). Las cantidades ya van en la unidad de compra.</div>
    ${r.d.length
      ? r.d.map((g, n) => `
        <div class="inv-card">
          <div style="font-weight:800;font-size:15px">${invEsc(g.proveedor_nombre)}${g.telefono ? ` <span class="inv-sub">· ${invEsc(g.telefono)}</span>` : ''}</div>
          ${g.items.map((it) => `<div class="inv-fila"><div class="cuerpo"><div class="nombre">${invEsc(it.nombre)}<span class="inv-estado ${it.estado === 'agotado' ? 'est-agotado' : 'est-bajo'}">${it.estado === 'agotado' ? 'Agotado' : 'Bajo'}</span></div><div class="detalle">Hay ${invNum(Math.max(0, it.stock_actual))} ${invEsc(it.unidad)}</div></div><strong>${invNum(it.cantidad_compra)} ${invEsc(it.unidad_compra)}</strong></div>`).join('')}
          ${g.mensaje
            ? `<div class="inv-sub" style="white-space:pre-wrap;background:#f7f7f7;border-radius:8px;padding:8px;margin:8px 0;color:#555">${invEsc(g.mensaje)}</div>
               <div style="display:flex;gap:8px;flex-wrap:wrap">
                 ${g.telefono ? `<button class="inv-btn primario" data-acc="pedido-wa" data-n="${n}">📲 Mandar por WhatsApp</button>` : '<span class="inv-sub">Agrega su teléfono en Proveedores para mandarlo por WhatsApp.</span>'}
                 <button class="inv-btn" data-acc="pedido-copiar" data-n="${n}">📋 Copiar mensaje</button>
               </div>`
            : '<div class="inv-aviso">Estos insumos no tienen proveedor asignado. Asígnalo en ⚙️ de cada insumo (pestaña Stock) para poder mandar el pedido.</div>'}
        </div>`).join('')
      : '<div class="inv-ok">✅ No hace falta pedir nada: todo está arriba de su mínimo.</div>'}`);
};
INV_ACC['pedido-wa'] = (el) => {
  const g = INV.pedidos[Number(el.dataset.n)];
  window.open(`https://wa.me/${invTelefonoWA(g.telefono)}?text=${encodeURIComponent(g.mensaje)}`, '_blank');
};
INV_ACC['pedido-copiar'] = async (el) => {
  const g = INV.pedidos[Number(el.dataset.n)];
  try {
    await navigator.clipboard.writeText(g.mensaje);
    invAviso('Mensaje copiado.');
  } catch (e) {
    invAviso('Tu navegador no permitió copiar: selecciona el texto y cópialo a mano.', true);
  }
};

// ==================== MERMAS ====================
const INV_MER = { dias: 30 };
INV_RENDER.mermas = async (mi) => {
  await invAsegurarInsumos();
  if (mi !== INV.token) return;
  invContenido().innerHTML = `
    <div class="inv-card">
      <h3>Registrar merma</h3>
      <select class="inv-input" id="mer-insumo">${invOpcionesInsumos(INV.insumos, '', 'Elige el insumo…')}</select>
      <div class="inv-grid2">
        <div><label class="inv-label">Cantidad que se tiró</label><input class="inv-input" id="mer-cant" inputmode="decimal" placeholder="0" /></div>
        <div><label class="inv-label">Motivo</label><select class="inv-input" id="mer-motivo"><option value="">Elige…</option>${Object.entries(INV_MOTIVOS_MERMA).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      </div>
      <input class="inv-input" id="mer-nota" style="margin-top:8px" maxlength="200" placeholder="Nota (opcional)" />
      <div id="mer-error" class="inv-neg" style="font-size:13px;margin-top:6px"></div>
      <button class="inv-btn rojo" style="margin-top:8px;width:100%" data-acc="mer-guardar" id="mer-guardar">Registrar merma</button>
    </div>
    <div id="inv-mer-reporte"></div>
    <div class="inv-card" style="padding:4px 12px"><h3 style="padding-top:10px">Últimas mermas (14 días)</h3><div id="inv-mer-lista"><div class="inv-vacio">Cargando…</div></div></div>`;
  document.getElementById('mer-cant').addEventListener('input', (e) => (e.target.value = e.target.value.replace(/[^0-9.]/g, '')));
  invCargarMermas(mi);
};
async function invCargarMermas(mi) {
  const { desde, hasta } = invRango(14);
  const [lista, reporte] = await Promise.all([
    invApi('GET', `/api/inventario/movimientos?sucursal_id=${invSuc()}&tipo=merma&fecha_desde=${desde}&fecha_hasta=${hasta}&limite=100`),
    invEnc() ? invApi('GET', `/api/inventario/mermas/reporte?sucursal_id=${invSuc()}&fecha_desde=${invRango(INV_MER.dias).desde}&fecha_hasta=${invRango(INV_MER.dias).hasta}`) : Promise.resolve(null),
  ]);
  if (mi !== INV.token || INV.tab !== 'mermas') return;
  const cont = document.getElementById('inv-mer-lista');
  if (cont) cont.innerHTML = lista.ok ? invFilasMovimientos(lista.d, true) : `<div class="inv-vacio">${invEsc(lista.d.error || 'No se pudo cargar')}</div>`;
  const rep = document.getElementById('inv-mer-reporte');
  if (rep && reporte && reporte.ok) {
    const d = reporte.d;
    const max = Math.max(1, ...d.por_motivo.map((m) => m.costo));
    rep.innerHTML = `<div class="inv-card"><h3>Reporte de mermas</h3>
      <div class="inv-chips">${[[7, '7 días'], [30, '30 días'], [90, '90 días']].map(([n, et]) => `<button class="inv-chip ${INV_MER.dias === n ? 'activo' : ''}" data-acc="mer-dias" data-dias="${n}">${et}</button>`).join('')}</div>
      <div class="inv-kpis">
        <div class="inv-kpi"><div class="et">Costo de lo tirado</div><div class="val inv-neg">${invMoneda(d.total_costo)}</div><div class="sub">${d.total_movimientos} registro${d.total_movimientos === 1 ? '' : 's'}</div></div>
        <div class="inv-kpi"><div class="et">Sobre lo consumido</div><div class="val">${d.pct_sobre_consumo}%</div><div class="sub">de lo que se usó se tiró</div></div>
      </div>
      ${d.por_motivo.length ? `<div style="font-weight:700;font-size:13px;margin:6px 0">Por motivo</div>${d.por_motivo.map((m) => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${invEsc(INV_MOTIVOS_MERMA[m.motivo] || m.motivo)} <span class="inv-sub">(${m.n})</span></span><b>${invMoneda(m.costo)}</b></div><div class="inv-barra"><i style="width:${Math.round((m.costo / max) * 100)}%"></i></div></div>`).join('')}` : '<div class="inv-vacio">Sin mermas en este periodo 🎉</div>'}
      ${d.por_insumo.length ? `<div style="font-weight:700;font-size:13px;margin:12px 0 4px">Lo que más se tira</div>${d.por_insumo.slice(0, 8).map((i) => `<div class="inv-fila" style="padding:6px 0"><div class="cuerpo"><div class="nombre" style="font-size:13px">${invEsc(i.nombre)}</div><div class="detalle">${invNum(i.cantidad)} ${invEsc(i.unidad)} · ${i.n} vez${i.n === 1 ? '' : 'es'}</div></div><strong class="inv-neg">${invMoneda(i.costo)}</strong></div>`).join('')}` : ''}
    </div>`;
  }
}
INV_ACC['mer-dias'] = (el) => { INV_MER.dias = Number(el.dataset.dias); invIrA('mermas'); };
INV_ACC['mer-guardar'] = async () => {
  const err = document.getElementById('mer-error');
  const insumo = document.getElementById('mer-insumo').value;
  const cantidad = Number(document.getElementById('mer-cant').value);
  const motivo = document.getElementById('mer-motivo').value;
  if (!insumo) return (err.textContent = 'Elige el insumo.');
  if (!(cantidad > 0)) return (err.textContent = 'Escribe cuánto se tiró.');
  if (!motivo) return (err.textContent = 'Elige el motivo.');
  const btn = document.getElementById('mer-guardar');
  btn.disabled = true;
  const ins = invInsumo(insumo);
  const r = await invApi('POST', '/api/inventario/movimientos', { sucursal_id: invSuc(), insumo_id: Number(insumo), tipo: 'merma', cantidad, motivo, nota: document.getElementById('mer-nota').value });
  if (!r.ok) { btn.disabled = false; return (err.textContent = r.d.error || 'No se pudo registrar.'); }
  invAviso(`Merma registrada. Quedan ${invNum(r.d.saldo_despues)} ${ins.unidad} de ${ins.nombre}.`);
  INV.insumos = null;
  invIrA('mermas');
  invActualizarBadge();
};

// ==================== PRODUCCIÓN DIARIA ====================
INV_RENDER.produccion = async (mi) => {
  await invAsegurarInsumos();
  const { desde, hasta } = invRango(14);
  const [sug, hist, recs] = await Promise.all([
    invApi('GET', `/api/inventario/produccion/sugerida?sucursal_id=${invSuc()}`),
    invApi('GET', `/api/inventario/produccion?sucursal_id=${invSuc()}&fecha_desde=${desde}&fecha_hasta=${hasta}`),
    invApi('GET', '/api/inventario/produccion/recetas?todas=1'),
  ]);
  if (mi !== INV.token) return;
  if (!sug.ok || !hist.ok || !recs.ok) return invError(!sug.ok ? sug : !hist.ok ? hist : recs);
  INV.recetasProd = recs.d;
  const activas = recs.d.filter((r) => r.activo);
  const enc = invEnc();

  invContenido().innerHTML = `
    <div class="inv-card">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${activas.length ? '<button class="inv-btn primario" data-acc="producir">🍳 Registrar producción</button>' : ''}
        ${enc ? '<button class="inv-btn" data-acc="rp-lista">⚙️ Recetas de producción</button>' : ''}
      </div>
      <div class="inv-sub" style="margin-top:8px">Aquí registras lo que se prepara cada día (carne adobada, salsas, cebolla picada…). Al producir, el sistema descuenta los ingredientes, suma lo obtenido y calcula cuánto costó realmente cada kilo.</div>
    </div>

    ${activas.length
      ? `<div class="inv-card"><h3>Qué conviene producir hoy</h3>
          ${sug.d.map((x) => `<div class="inv-fila"><div class="cuerpo">
              <div class="nombre">${invEsc(x.nombre)}</div>
              <div class="detalle">Hay ${invNum(x.stock_actual)} ${invEsc(x.unidad)} de ${invEsc(x.insumo_nombre)}.
                ${x.basado_en === 'sin_datos' ? 'Todavía no hay ventas suficientes para sugerir.' : `Se suele usar ~${invNum(x.consumo_esperado)} ${invEsc(x.unidad)} ${x.basado_en === 'mismo_dia' ? 'este día de la semana' : 'al día'}.`}</div>
              ${x.lotes_sugeridos > 0 ? `<div style="margin-top:4px" class="inv-neg"><b>Producir ${invNum(x.lotes_sugeridos)} lote${x.lotes_sugeridos === 1 ? '' : 's'}</b> <span class="inv-sub">(≈ ${invNum(x.cantidad_sugerida)} ${invEsc(x.unidad)})</span></div>` : x.basado_en === 'sin_datos' ? '' : '<div class="inv-pos" style="margin-top:4px;font-size:13px">✅ Alcanza para hoy</div>'}
            </div>
            <button class="inv-btn chico" data-acc="producir" data-receta="${x.receta_id}" data-lotes="${x.lotes_sugeridos || 1}">Producir</button></div>`).join('')}
        </div>`
      : `<div class="inv-card"><div class="inv-vacio">Todavía no hay recetas de producción.${enc ? '<br><br><button class="inv-btn primario" data-acc="rp-nueva">+ Crear la primera receta</button>' : '<br>Pídele al encargado que las cree.'}</div></div>`}

    <div class="inv-card" style="padding:4px 12px"><h3 style="padding-top:10px">Producción de los últimos 14 días</h3>
      ${hist.d.length
        ? hist.d.map((p) => `<div class="inv-fila"><div class="cuerpo">
            <div class="nombre">${invEsc(p.receta_nombre || 'Producción')}</div>
            <div class="detalle">${dashFechaCorta(p.dia)} · ${invNum(p.lotes)} lote${p.lotes === 1 ? '' : 's'}${p.empleado_nombre ? ` · ${invEsc(p.empleado_nombre)}` : ''}${p.nota ? ` · ${invEsc(p.nota)}` : ''}${enc && p.costo_total !== undefined ? ` · costó ${invMoneda(p.costo_total)}` : ''}</div></div>
            <div style="text-align:right"><b>${invNum(p.cantidad_real)} ${invEsc(p.unidad || '')}</b><div class="inv-sub ${p.rendimiento_pct !== null && p.rendimiento_pct < 95 ? 'inv-neg' : ''}">de ${invNum(p.cantidad_teorica)} · ${p.rendimiento_pct === null ? '' : p.rendimiento_pct + '%'}</div></div></div>`).join('')
        : '<div class="inv-vacio">Nada registrado en este periodo.</div>'}
    </div>`;
};

INV_ACC.producir = (el) => {
  const activas = INV.recetasProd.filter((r) => r.activo);
  const preReceta = el.dataset.receta ? Number(el.dataset.receta) : activas[0]?.id;
  const preLotes = el.dataset.lotes || '1';
  invModal(`
    <h3 style="margin:0 0 8px">🍳 Registrar producción</h3>
    <label class="inv-label" style="margin-top:0">Receta</label>
    <select class="inv-input" id="p-receta">${activas.map((r) => `<option value="${r.id}" ${r.id === preReceta ? 'selected' : ''}>${invEsc(r.nombre)}</option>`).join('')}</select>
    <div class="inv-grid2">
      <div><label class="inv-label">Lotes producidos</label><input class="inv-input" id="p-lotes" inputmode="decimal" value="${invAttr(preLotes)}" /></div>
      <div><label class="inv-label">Cantidad realmente obtenida</label><input class="inv-input" id="p-real" inputmode="decimal" placeholder="Igual al teórico" /></div>
    </div>
    <div class="inv-sub" id="p-hint" style="margin-top:6px"></div>
    <label class="inv-label">Nota (opcional)</label><input class="inv-input" id="p-nota" maxlength="200" />
    <div id="p-error" class="inv-neg" style="font-size:13px;margin-top:8px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="p-cancelar">Cancelar</button><button class="btn-agregar" id="p-guardar">Registrar</button></div>`,
  () => {
    const $ = (id) => document.getElementById(id);
    ['p-lotes', 'p-real'].forEach((id) => $(id).addEventListener('input', (e) => (e.target.value = e.target.value.replace(/[^0-9.]/g, ''))));
    const hint = () => {
      const r = activas.find((x) => x.id === Number($('p-receta').value));
      const lotes = Number($('p-lotes').value);
      if (!r || !(lotes > 0)) return ($('p-hint').textContent = '');
      const teo = lotes * r.rendimiento;
      const usa = r.ingredientes.map((x) => `${invNum(x.cantidad * lotes)} ${x.unidad} de ${x.nombre}`).join(', ');
      $('p-real').placeholder = `Teórico: ${invNum(teo)} ${r.unidad}`;
      $('p-hint').innerHTML = `Rinde <b>${invNum(teo)} ${invEsc(r.unidad)}</b> de ${invEsc(r.insumo_nombre)}. Usa: ${invEsc(usa)}.`;
    };
    ['p-receta', 'p-lotes'].forEach((id) => $(id).addEventListener('input', hint));
    hint();
    $('p-cancelar').addEventListener('click', invCerrarModal);
    $('p-guardar').addEventListener('click', async () => {
      const err = $('p-error');
      const lotes = Number($('p-lotes').value);
      if (!(lotes > 0)) return (err.textContent = 'Indica cuántos lotes se produjeron.');
      const cuerpo = { sucursal_id: invSuc(), receta_id: Number($('p-receta').value), lotes, nota: $('p-nota').value };
      if ($('p-real').value !== '') cuerpo.cantidad_real = Number($('p-real').value);
      $('p-guardar').disabled = true;
      const r = await invApi('POST', '/api/inventario/produccion', cuerpo);
      if (!r.ok) { $('p-guardar').disabled = false; return (err.textContent = r.d.error || 'No se pudo registrar.'); }
      INV.insumos = null;
      invModal(`<h3 style="margin:0 0 8px">✅ Producción registrada</h3>
        <div style="font-size:15px">Obtuviste <b>${invNum(r.d.cantidad_real)} ${invEsc(r.d.unidad)}</b> de ${invNum(r.d.cantidad_teorica)} esperados <b class="${r.d.rendimiento_pct < 95 ? 'inv-neg' : 'inv-pos'}">(${r.d.rendimiento_pct}%)</b>.</div>
        ${r.d.costo_unitario !== undefined ? `<div class="inv-sub" style="margin-top:6px">Costo del lote: ${invMoneda(r.d.costo_total)} · ${invMoneda(r.d.costo_unitario, 2)} por ${invEsc(r.d.unidad)}.</div>` : ''}
        ${r.d.avisos.length ? `<div class="inv-aviso">⚠️ ${r.d.avisos.map(invEsc).join('<br>⚠️ ')}<br><span class="inv-sub">El stock de esos ingredientes estaba atrasado: conviene ajustarlo.</span></div>` : ''}
        <div class="modal-botones"><button class="btn-agregar" id="p-ok">Listo</button></div>`,
      () => document.getElementById('p-ok').addEventListener('click', () => { invCerrarModal(); invIrA('produccion'); }));
    });
  });
};

// ----- Recetas de producción (encargado) -----
INV_ACC['rp-lista'] = () => {
  invVista('Recetas de producción', `
    <div style="margin-bottom:10px"><button class="inv-btn primario" data-acc="rp-nueva">+ Nueva receta</button></div>
    ${INV.recetasProd.length
      ? INV.recetasProd.map((r) => `<div class="inv-card" style="${r.activo ? '' : 'opacity:.55'}">
          <div style="display:flex;justify-content:space-between;gap:8px"><div><div class="nombre" style="font-weight:700">${invEsc(r.nombre)}${r.activo ? '' : ' <span class="inv-estado est-agotado">Desactivada</span>'}</div>
            <div class="inv-sub">Rinde ${invNum(r.rendimiento)} ${invEsc(r.unidad)} de ${invEsc(r.insumo_nombre)} por lote</div></div>
            <div style="text-align:right"><b>${invMoneda(r.costo_lote)}</b><div class="inv-sub">${invMoneda(r.costo_unitario)}/${invEsc(r.unidad)}</div></div></div>
          <div class="inv-sub" style="margin-top:6px">${r.ingredientes.map((x) => `${invNum(x.cantidad)} ${invEsc(x.unidad)} ${invEsc(x.nombre)}`).join(' · ')}</div>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button class="inv-btn chico" data-acc="rp-editar" data-id="${r.id}">Editar</button><button class="inv-btn chico" data-acc="rp-activar" data-id="${r.id}">${r.activo ? 'Desactivar' : 'Activar'}</button><button class="inv-btn chico" data-acc="rp-borrar" data-id="${r.id}">Borrar</button></div>
        </div>`).join('')
      : '<div class="inv-vacio">No hay recetas todavía.</div>'}`);
};
INV_ACC['rp-activar'] = async (el) => {
  const r = INV.recetasProd.find((x) => x.id === Number(el.dataset.id));
  const res = await invApi('PUT', `/api/inventario/produccion/recetas/${r.id}`, { nombre: r.nombre, insumo_id: r.insumo_id, rendimiento: r.rendimiento, activo: !r.activo, ingredientes: r.ingredientes.map((x) => ({ insumo_id: x.insumo_id, cantidad: x.cantidad })) });
  if (!res.ok) return invAviso(res.d.error || 'No se pudo cambiar.', true);
  const nueva = await invApi('GET', '/api/inventario/produccion/recetas?todas=1');
  INV.recetasProd = nueva.d;
  INV_ACC['rp-lista']();
};
INV_ACC['rp-borrar'] = (el) => {
  const r = INV.recetasProd.find((x) => x.id === Number(el.dataset.id));
  invModal(`<h3 style="margin:0 0 6px">¿Borrar «${invEsc(r.nombre)}»?</h3><div class="inv-sub">El historial de producciones ya registradas se conserva. El insumo elaborado no se borra.</div>
    <div class="modal-botones"><button class="btn-cancelar" id="rb-no">Cancelar</button><button class="btn-agregar" id="rb-si" style="background:#b8232f">Borrar</button></div>`,
  () => {
    document.getElementById('rb-no').addEventListener('click', invCerrarModal);
    document.getElementById('rb-si').addEventListener('click', async () => {
      await invApi('DELETE', `/api/inventario/produccion/recetas/${r.id}`);
      invCerrarModal();
      const nueva = await invApi('GET', '/api/inventario/produccion/recetas?todas=1');
      INV.recetasProd = nueva.d;
      INV_ACC['rp-lista']();
    });
  });
};

const INV_RP = { id: null, nombre: '', insumo_id: '', nuevo: false, nuevo_nombre: '', nuevo_unidad: '', rendimiento: '', ingredientes: [] };
INV_ACC['rp-nueva'] = async () => {
  await invAsegurarInsumos();
  Object.assign(INV_RP, { id: null, nombre: '', insumo_id: '', nuevo: true, nuevo_nombre: '', nuevo_unidad: 'kg', rendimiento: '', ingredientes: [{ insumo_id: '', cant: '' }] });
  invPintarFormRP();
};
INV_ACC['rp-editar'] = async (el) => {
  await invAsegurarInsumos();
  const r = INV.recetasProd.find((x) => x.id === Number(el.dataset.id));
  Object.assign(INV_RP, { id: r.id, nombre: r.nombre, insumo_id: r.insumo_id, nuevo: false, nuevo_nombre: '', nuevo_unidad: '', rendimiento: String(r.rendimiento), ingredientes: r.ingredientes.map((x) => ({ insumo_id: x.insumo_id, cant: String(x.cantidad) })) });
  invPintarFormRP();
};
function invPintarFormRP() {
  const ins = INV.insumos;
  const sel = invInsumo(INV_RP.insumo_id);
  invVista(INV_RP.id ? 'Editar receta de producción' : 'Nueva receta de producción', `
    <div class="inv-card">
      <label class="inv-label" style="margin-top:0">Nombre de la receta</label>
      <input class="inv-input" data-inp="rp-nombre" maxlength="80" placeholder="Ej. Pastor adobado" value="${invAttr(INV_RP.nombre)}" />
      <label class="inv-label">¿Qué se obtiene?</label>
      <select class="inv-input" data-chg="rp-insumo"><option value="__nuevo" ${INV_RP.nuevo ? 'selected' : ''}>➕ Crear un insumo nuevo…</option>${invOpcionesInsumos(ins, INV_RP.nuevo ? '' : INV_RP.insumo_id)}</select>
      ${INV_RP.nuevo ? `<div class="inv-grid2" style="margin-top:6px"><input class="inv-input" data-inp="rp-nnombre" maxlength="80" placeholder="Nombre del insumo (ej. Pastor adobado)" value="${invAttr(INV_RP.nuevo_nombre)}" /><input class="inv-input" data-inp="rp-nunidad" maxlength="20" placeholder="Unidad (kg, l…)" value="${invAttr(INV_RP.nuevo_unidad)}" /></div>` : ''}
      <label class="inv-label">Rendimiento por lote (${invEsc(INV_RP.nuevo ? INV_RP.nuevo_unidad || 'unidad' : sel?.unidad || 'unidad')} que salen de una tanda)</label>
      <input class="inv-input" inputmode="decimal" data-inp="rp-rend" placeholder="Ej. 10" value="${invAttr(INV_RP.rendimiento)}" />
    </div>
    <div class="inv-card"><h3>Ingredientes por lote</h3>
      ${INV_RP.ingredientes.map((l, n) => {
        const x = invInsumo(l.insumo_id);
        return `<div style="margin-bottom:10px"><select class="inv-input" data-chg="rp-ing" data-n="${n}">${invOpcionesInsumos(ins.filter((i) => String(i.id) !== String(INV_RP.insumo_id)), l.insumo_id, 'Elige el ingrediente…')}</select>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><input class="inv-input" inputmode="decimal" data-inp="rp-cant" data-n="${n}" placeholder="Cantidad" value="${invAttr(l.cant)}" /><span class="inv-sub" style="white-space:nowrap">${x ? invEsc(x.unidad) : ''}</span>
          ${INV_RP.ingredientes.length > 1 ? `<button class="inv-btn chico" data-acc="rp-quitar" data-n="${n}">✕</button>` : ''}</div></div>`;
      }).join('')}
      <button class="inv-btn chico" data-acc="rp-agregar">+ Ingrediente</button>
      <div class="inv-sub" id="rp-costo" style="margin-top:10px"></div>
    </div>
    <button class="inv-btn primario" style="width:100%" data-acc="rp-guardar" id="rp-guardar">Guardar receta</button>
    <div id="rp-error" class="inv-neg" style="font-size:13px;margin-top:8px"></div>`);
  invCostoRP();
}
function invCostoRP() {
  const el = document.getElementById('rp-costo');
  if (!el) return;
  const rend = Number(INV_RP.rendimiento);
  const costo = INV_RP.ingredientes.reduce((s, l) => s + (invInsumo(l.insumo_id) && Number(l.cant) > 0 ? Number(l.cant) * invInsumo(l.insumo_id).costo_unitario : 0), 0);
  el.innerHTML = costo > 0 ? `Costo estimado del lote: <b>${invMoneda(costo)}</b>${rend > 0 ? ` · ${invMoneda(costo / rend)} por unidad obtenida` : ''}` : '';
}
INV_INP['rp-nombre'] = (el) => { INV_RP.nombre = el.value; };
INV_INP['rp-nnombre'] = (el) => { INV_RP.nuevo_nombre = el.value; };
INV_INP['rp-nunidad'] = (el) => { INV_RP.nuevo_unidad = el.value; };
INV_INP['rp-rend'] = (el) => { el.value = el.value.replace(/[^0-9.]/g, ''); INV_RP.rendimiento = el.value; invCostoRP(); };
INV_INP['rp-cant'] = (el) => { el.value = el.value.replace(/[^0-9.]/g, ''); INV_RP.ingredientes[el.dataset.n].cant = el.value; invCostoRP(); };
INV_CHG['rp-insumo'] = (el) => { INV_RP.nuevo = el.value === '__nuevo'; INV_RP.insumo_id = INV_RP.nuevo ? '' : el.value; invPintarFormRP(); };
INV_CHG['rp-ing'] = (el) => { INV_RP.ingredientes[el.dataset.n].insumo_id = el.value; invPintarFormRP(); };
INV_ACC['rp-agregar'] = () => { INV_RP.ingredientes.push({ insumo_id: '', cant: '' }); invPintarFormRP(); };
INV_ACC['rp-quitar'] = (el) => { INV_RP.ingredientes.splice(Number(el.dataset.n), 1); invPintarFormRP(); };
INV_ACC['rp-guardar'] = async () => {
  const err = document.getElementById('rp-error');
  const ing = INV_RP.ingredientes.filter((l) => l.insumo_id || l.cant);
  if (!INV_RP.nombre.trim()) return (err.textContent = 'Escribe el nombre de la receta.');
  if (INV_RP.nuevo && (!INV_RP.nuevo_nombre.trim() || !INV_RP.nuevo_unidad.trim())) return (err.textContent = 'Escribe el nombre y la unidad del insumo que se obtiene.');
  if (!(Number(INV_RP.rendimiento) > 0)) return (err.textContent = 'Escribe cuánto rinde un lote.');
  if (!ing.length || ing.some((l) => !l.insumo_id || !(Number(l.cant) > 0))) return (err.textContent = 'Cada ingrediente necesita insumo y cantidad.');
  const cuerpo = {
    nombre: INV_RP.nombre, rendimiento: Number(INV_RP.rendimiento), ingredientes: ing.map((l) => ({ insumo_id: Number(l.insumo_id), cantidad: Number(l.cant) })),
    ...(INV_RP.nuevo ? { insumo_nuevo: { nombre: INV_RP.nuevo_nombre, unidad: INV_RP.nuevo_unidad } } : { insumo_id: Number(INV_RP.insumo_id) }),
  };
  document.getElementById('rp-guardar').disabled = true;
  const r = INV_RP.id ? await invApi('PUT', `/api/inventario/produccion/recetas/${INV_RP.id}`, cuerpo) : await invApi('POST', '/api/inventario/produccion/recetas', cuerpo);
  if (!r.ok) { document.getElementById('rp-guardar').disabled = false; return (err.textContent = r.d.error || 'No se pudo guardar.'); }
  INV.insumos = null;
  invAviso('Receta guardada.');
  invIrA('produccion');
};

// ==================== RECETAS Y COSTOS ====================
const INV_REC = { orden: 'categoria' };
INV_RENDER.recetas = async (mi) => {
  const r = await invApi('GET', `/api/inventario/recetas-costos?sucursal_id=${invSuc()}`);
  if (mi !== INV.token) return;
  if (!r.ok) return invError(r);
  const { filas, resumen } = r.d;
  const lista = [...filas];
  if (INV_REC.orden === 'caro') lista.sort((a, b) => (b.food_cost_pct ?? -1) - (a.food_cost_pct ?? -1));
  if (INV_REC.orden === 'margen') lista.sort((a, b) => (a.margen ?? 1e9) - (b.margen ?? 1e9));
  const color = (p) => (p === null ? '#999' : p <= 35 ? '#1a7d3a' : p <= 45 ? '#b07a00' : '#b8232f');

  invContenido().innerHTML = `
    <div class="inv-kpis">
      <div class="inv-kpi"><div class="et">Food cost promedio</div><div class="val" style="color:${color(resumen.food_cost_promedio)}">${resumen.food_cost_promedio === null ? '—' : resumen.food_cost_promedio + '%'}</div><div class="sub">lo normal es 28–35%</div></div>
      <div class="inv-kpi"><div class="et">Sin receta</div><div class="val ${resumen.sin_receta ? 'inv-neg' : 'inv-pos'}">${resumen.sin_receta}</div><div class="sub">de ${resumen.total} platillos</div></div>
      <div class="inv-kpi"><div class="et">Costo incompleto</div><div class="val ${resumen.con_costo_incompleto ? 'inv-neg' : 'inv-pos'}">${resumen.con_costo_incompleto}</div><div class="sub">con insumos sin costo</div></div>
    </div>
    <div class="inv-chips">
      ${[['categoria', 'Por categoría'], ['caro', 'Food cost más alto'], ['margen', 'Menor margen']].map(([k, et]) => `<button class="inv-chip ${INV_REC.orden === k ? 'activo' : ''}" data-acc="rec-orden" data-orden="${k}">${et}</button>`).join('')}
      <button class="inv-chip" data-acc="reintentar">↻ Actualizar</button>
    </div>
    <div class="inv-card" style="padding:4px 12px">
      ${lista.map((f) => `<div class="inv-fila"><div class="cuerpo">
          <div class="nombre">${invEsc(f.nombre)}${f.tiene_receta ? '' : ' <span class="inv-estado est-bajo">Sin receta</span>'}${f.tiene_receta && f.n_sin_costo ? ' <span class="inv-estado est-bajo">Costo incompleto</span>' : ''}</div>
          <div class="detalle">${invEsc(f.categoria)} · Precio ${invMoneda(f.precio)}${f.tiene_receta ? ` · Costo ${invMoneda(f.costo)} · Margen <b>${invMoneda(f.margen)}</b>` : ''}</div>
          <div class="acciones"><button class="inv-btn chico" data-acc="editar-receta" data-id="${f.producto_id}">${f.tiene_receta ? '✏️ Editar receta' : '+ Crear receta'}</button></div></div>
          <div style="text-align:right;min-width:62px"><div style="font-size:19px;font-weight:800;color:${color(f.food_cost_pct)}">${f.food_cost_pct === null ? '—' : f.food_cost_pct + '%'}</div><div class="inv-sub">food cost</div></div></div>`).join('') || '<div class="inv-vacio">No hay platillos en el menú de esta sucursal.</div>'}
    </div>
    <div class="inv-sub">El costo se calcula con la receta de cada platillo y el costo actual de los insumos (que se actualiza solo con cada compra). Los platillos con variantes (ej. «Orden» de 5 piezas) se calculan por variante. Al terminar de editar una receta toca «↻ Actualizar».</div>`;
};
INV_ACC['rec-orden'] = (el) => { INV_REC.orden = el.dataset.orden; invIrA('recetas'); };
INV_ACC['editar-receta'] = (el) => abrirModalReceta(Number(el.dataset.id));

// ==================== PROVEEDORES ====================
INV_RENDER.proveedores = async (mi) => {
  const lista = await invAsegurarProveedores(true);
  if (mi !== INV.token) return;
  invContenido().innerHTML = `
    <div style="margin-bottom:10px"><button class="inv-btn primario" data-acc="prov-nuevo">+ Nuevo proveedor</button></div>
    ${lista.length
      ? lista.map((p) => `<div class="inv-card" style="${p.activo ? '' : 'opacity:.55'}">
          <div style="font-weight:800;font-size:15px">${invEsc(p.nombre)}${p.activo ? '' : ' <span class="inv-estado est-agotado">Inactivo</span>'}</div>
          <div class="inv-sub">${[p.contacto, p.telefono, p.dias_entrega && `Entrega: ${p.dias_entrega}`].filter(Boolean).map(invEsc).join(' · ') || 'Sin datos de contacto'}</div>
          <div class="inv-sub" style="margin-top:4px">${p.n_insumos} insumo${p.n_insumos === 1 ? '' : 's'} · comprado en 90 días: <b>${invMoneda(p.comprado_90d)}</b>${p.ultima_compra ? ` · última compra ${dashFechaCorta(p.ultima_compra)}` : ''}</div>
          ${p.notas ? `<div class="inv-sub" style="margin-top:4px">📝 ${invEsc(p.notas)}</div>` : ''}
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="inv-btn chico" data-acc="prov-precios" data-id="${p.id}">💲 Precios</button>
            <button class="inv-btn chico" data-acc="prov-editar" data-id="${p.id}">✏️ Editar</button>
            ${p.telefono ? `<button class="inv-btn chico" data-acc="prov-wa" data-id="${p.id}">📲 WhatsApp</button>` : ''}
            <button class="inv-btn chico" data-acc="prov-activo" data-id="${p.id}">${p.activo ? 'Desactivar' : 'Activar'}</button>
          </div></div>`).join('')
      : '<div class="inv-vacio">Aún no tienes proveedores. Agrega el primero para ligarlo a tus insumos y a tus compras.</div>'}`;
};
const invProv = (id) => (INV.proveedores || []).find((p) => String(p.id) === String(id));
INV_ACC['prov-nuevo'] = () => invModalProveedor(null);
INV_ACC['prov-editar'] = (el) => invModalProveedor(invProv(el.dataset.id));
INV_ACC['prov-wa'] = (el) => window.open(`https://wa.me/${invTelefonoWA(invProv(el.dataset.id).telefono)}`, '_blank');
INV_ACC['prov-activo'] = async (el) => {
  const p = invProv(el.dataset.id);
  const r = await invApi('PATCH', `/api/inventario/proveedores/${p.id}`, { activo: !p.activo });
  if (!r.ok) return invAviso(r.d.error || 'No se pudo cambiar.', true);
  invIrA('proveedores');
};
function invModalProveedor(p) {
  const v = p || { nombre: '', contacto: '', telefono: '', dias_entrega: '', notas: '' };
  invModal(`
    <h3 style="margin:0 0 8px">${p ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
    <label class="inv-label" style="margin-top:0">Nombre</label><input class="inv-input" id="pv-nombre" maxlength="80" value="${invAttr(v.nombre)}" />
    <div class="inv-grid2"><div><label class="inv-label">Contacto</label><input class="inv-input" id="pv-contacto" maxlength="80" value="${invAttr(v.contacto)}" /></div>
      <div><label class="inv-label">Teléfono</label><input class="inv-input" id="pv-tel" type="tel" maxlength="30" placeholder="10 dígitos" value="${invAttr(v.telefono)}" /></div></div>
    <label class="inv-label">Días de entrega</label><input class="inv-input" id="pv-dias" maxlength="80" placeholder="Ej. Lunes y jueves" value="${invAttr(v.dias_entrega)}" />
    <label class="inv-label">Notas</label><input class="inv-input" id="pv-notas" maxlength="300" placeholder="Condiciones, crédito, etc." value="${invAttr(v.notas)}" />
    <div id="pv-error" class="inv-neg" style="font-size:13px;margin-top:8px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="pv-cancelar">Cancelar</button><button class="btn-agregar" id="pv-guardar">Guardar</button></div>`,
  () => {
    document.getElementById('pv-cancelar').addEventListener('click', invCerrarModal);
    document.getElementById('pv-guardar').addEventListener('click', async () => {
      const cuerpo = { nombre: document.getElementById('pv-nombre').value, contacto: document.getElementById('pv-contacto').value, telefono: document.getElementById('pv-tel').value, dias_entrega: document.getElementById('pv-dias').value, notas: document.getElementById('pv-notas').value };
      if (!cuerpo.nombre.trim()) return (document.getElementById('pv-error').textContent = 'Escribe el nombre.');
      const r = p ? await invApi('PATCH', `/api/inventario/proveedores/${p.id}`, cuerpo) : await invApi('POST', '/api/inventario/proveedores', cuerpo);
      if (!r.ok) return (document.getElementById('pv-error').textContent = r.d.error || 'No se pudo guardar.');
      invCerrarModal();
      invAviso('Proveedor guardado.');
      INV.proveedores = null;
      invIrA('proveedores');
    });
  });
}
INV_ACC['prov-precios'] = async (el) => {
  const p = invProv(el.dataset.id);
  invVista(`Precios de ${p.nombre}`, '<div class="inv-vacio">Cargando…</div>');
  const r = await invApi('GET', `/api/inventario/proveedores/${p.id}/precios`);
  if (!r.ok) return invError(r);
  invVista(`Precios de ${p.nombre}`, `<div class="inv-card" style="padding:4px 12px">
    ${r.d.length
      ? r.d.map((x) => `<div class="inv-fila"><div class="cuerpo"><div class="nombre">${invEsc(x.nombre)}</div><div class="detalle">Última compra ${dashFechaCorta(x.fecha)} · ${invCosto(x.costo_unitario)}/${invEsc(x.unidad)}</div></div>
          <div style="text-align:right"><b>${x.precio_compra !== null ? `${invMoneda(x.precio_compra)} / ${invEsc(x.unidad_compra || x.unidad)}` : '—'}</b>
          ${x.cambio_pct === null ? '<div class="inv-sub">primera compra</div>' : `<div class="${x.cambio_pct > 0 ? 'inv-neg' : x.cambio_pct < 0 ? 'inv-pos' : 'inv-sub'}" style="font-size:12px;font-weight:700">${x.cambio_pct > 0 ? '▲' : x.cambio_pct < 0 ? '▼' : '='} ${Math.abs(x.cambio_pct)}% vs. la compra anterior</div>`}</div></div>`).join('')
      : '<div class="inv-vacio">Todavía no le has comprado nada a este proveedor.</div>'}
  </div>`);
};

// ==================== CIERRE DE TURNO ====================
const INV_CIERRE = { turno: 'Cierre del día', todos: false, conteos: {}, motivos: {}, notas: '', ajustar: true };
INV_RENDER.cierre = async (mi) => {
  let prep = await invApi('GET', `/api/inventario/cierre-turno/preparar?sucursal_id=${invSuc()}${INV_CIERRE.todos ? '&todos=1' : ''}`);
  if (mi !== INV.token) return;
  if (!prep.ok) return invError(prep);
  // Si todavía no hay insumos marcados como críticos, se cuentan todos
  let sinCriticos = false;
  if (!prep.d.hay_criticos && !INV_CIERRE.todos) {
    sinCriticos = true;
    prep = await invApi('GET', `/api/inventario/cierre-turno/preparar?sucursal_id=${invSuc()}&todos=1`);
    if (!prep.ok) return invError(prep);
  }
  const hist = await invApi('GET', `/api/inventario/cierre-turno?sucursal_id=${invSuc()}`);
  if (mi !== INV.token) return;
  INV.cierrePrep = prep.d;
  const rd = prep.d.resumen_dia;
  const enc = invEnc();

  invContenido().innerHTML = `
    <div class="inv-card"><h3>Resumen de hoy</h3>
      <div class="inv-sub" style="font-size:13px">🗑️ ${rd.mermas_n} merma${rd.mermas_n === 1 ? '' : 's'}${enc && rd.mermas_costo !== undefined ? ` (${invMoneda(rd.mermas_costo)})` : ''} · 🍳 ${rd.producciones_n} producci${rd.producciones_n === 1 ? 'ón' : 'ones'} · ⬇️ ${rd.entradas_n} entrada${rd.entradas_n === 1 ? '' : 's'}</div>
    </div>
    <div class="inv-card">
      <h3>Conteo de cierre</h3>
      <div class="inv-chips">${prep.d.turnos.map((t) => `<button class="inv-chip ${INV_CIERRE.turno === t ? 'activo' : ''}" data-acc="cz-turno" data-turno="${invAttr(t)}">${invEsc(t)}</button>`).join('')}</div>
      ${sinCriticos
        ? '<div class="inv-aviso">Aún no marcas insumos como críticos, así que se cuentan todos. Marca los importantes (carnes, tortilla…) con ⚙️ → «Crítico» en la pestaña Stock y el cierre será más rápido.</div>'
        : `<div class="inv-chips"><button class="inv-chip ${!INV_CIERRE.todos ? 'activo' : ''}" data-acc="cz-modo" data-todos="0">⭐ Solo críticos</button><button class="inv-chip ${INV_CIERRE.todos ? 'activo' : ''}" data-acc="cz-modo" data-todos="1">Todos</button></div>`}
      <div class="inv-sub">Cuenta lo que realmente hay y escríbelo. Lo que no cuentes se deja como está.</div>
      ${prep.d.insumos.map((i) => `<div class="inv-fila"><div class="cuerpo"><div class="nombre">${i.critico ? '⭐ ' : ''}${invEsc(i.nombre)}</div>
          <div class="detalle">Sistema: ${invNum(i.stock_actual)} ${invEsc(i.unidad)}</div>
          <div id="cz-mot-${i.id}" style="display:none;margin-top:6px"><input class="inv-input" data-inp="cz-motivo" data-id="${i.id}" maxlength="120" placeholder="¿Qué pasó? (opcional)" value="${invAttr(INV_CIERRE.motivos[i.id] || '')}" /></div></div>
          <div style="width:120px"><input class="inv-input" inputmode="decimal" data-inp="cz-cont" data-id="${i.id}" placeholder="Contado" value="${invAttr(INV_CIERRE.conteos[i.id] ?? '')}" /><div class="inv-sub" id="cz-dif-${i.id}" style="text-align:right;margin-top:3px;font-weight:700"></div></div></div>`).join('') || '<div class="inv-vacio">No hay insumos para contar.</div>'}
      <label style="display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-size:13px"><input type="checkbox" data-chg="cz-ajustar" ${INV_CIERRE.ajustar ? 'checked' : ''} style="margin-top:3px" /> Ajustar el sistema a lo contado (las diferencias quedan registradas en el historial)</label>
      <input class="inv-input" style="margin-top:8px" data-inp="cz-notas" maxlength="300" placeholder="Notas del cierre (opcional)" value="${invAttr(INV_CIERRE.notas)}" />
      <div id="cz-error" class="inv-neg" style="font-size:13px;margin-top:6px"></div>
      <button class="inv-btn primario" style="width:100%;margin-top:8px" data-acc="cz-guardar" id="cz-guardar">Guardar cierre</button>
      <div style="margin-top:8px"><button class="inv-chip" data-acc="conteo-libre">Conteo libre (sin turno)</button></div>
    </div>

    <div class="inv-card" style="padding:4px 12px"><h3 style="padding-top:10px">Cierres anteriores</h3>
      ${hist.ok && hist.d.length
        ? hist.d.map((c) => `<div class="inv-fila"><div class="cuerpo">
            <div class="nombre">${invEsc(c.turno)} <span class="inv-sub">· ${invHora(c.creado_en)}</span></div>
            <div class="detalle">${c.empleado_nombre ? `${invEsc(c.empleado_nombre)} · ` : ''}${c.contados} contado${c.contados === 1 ? '' : 's'} · ${c.con_diferencia ? `<b class="inv-neg">${c.con_diferencia} con diferencia</b>` : '<b class="inv-pos">sin diferencias</b>'}${c.ajustado ? '' : ' · sin ajustar'}${c.faltante_costo !== undefined && c.faltante_costo > 0 ? ` · faltante ${invMoneda(c.faltante_costo)}` : ''}${c.notas ? ` · ${invEsc(c.notas)}` : ''}</div>
            ${c.con_diferencia ? `<details style="margin-top:4px"><summary class="inv-sub" style="cursor:pointer">Ver diferencias</summary>${c.resumen.filter((x) => x.diferencia !== 0).map((x) => `<div class="inv-sub" style="padding:2px 0">• ${invEsc(x.nombre)}: sistema ${invNum(x.teorico)} → contado ${invNum(x.contado)} <b class="${x.diferencia > 0 ? 'inv-pos' : 'inv-neg'}">(${x.diferencia > 0 ? '+' : ''}${invNum(x.diferencia)} ${invEsc(x.unidad)})</b>${x.motivo ? ` — ${invEsc(x.motivo)}` : ''}</div>`).join('')}</details>` : ''}
          </div></div>`).join('')
        : '<div class="inv-vacio">Aún no hay cierres registrados.</div>'}
    </div>`;
  // Si ya había conteos capturados (por cambiar de turno o de modo), se vuelve a mostrar su diferencia
  prep.d.insumos.forEach((i) => invActualizarDifCierre(i.id));
};
function invActualizarDifCierre(id) {
  const i = (INV.cierrePrep?.insumos || []).find((x) => String(x.id) === String(id));
  const dif = document.getElementById(`cz-dif-${id}`);
  const mot = document.getElementById(`cz-mot-${id}`);
  if (!i || !dif) return;
  const v = INV_CIERRE.conteos[id];
  if (v === undefined || v === '') { dif.textContent = ''; if (mot) mot.style.display = 'none'; return; }
  const d = Math.round((Number(v) - i.stock_actual) * 1000) / 1000;
  dif.textContent = d === 0 ? '✓ coincide' : `${d > 0 ? '+' : ''}${invNum(d)} ${i.unidad}`;
  dif.className = `inv-sub ${d === 0 ? 'inv-pos' : d > 0 ? 'inv-pos' : 'inv-neg'}`;
  dif.style.fontWeight = '700';
  if (mot) mot.style.display = d === 0 ? 'none' : 'block';
}
INV_INP['cz-cont'] = (el) => { el.value = el.value.replace(/[^0-9.]/g, ''); INV_CIERRE.conteos[el.dataset.id] = el.value; invActualizarDifCierre(el.dataset.id); };
INV_INP['cz-motivo'] = (el) => { INV_CIERRE.motivos[el.dataset.id] = el.value; };
INV_INP['cz-notas'] = (el) => { INV_CIERRE.notas = el.value; };
INV_CHG['cz-ajustar'] = (el) => { INV_CIERRE.ajustar = el.checked; };
INV_ACC['cz-turno'] = (el) => { INV_CIERRE.turno = el.dataset.turno; document.querySelectorAll('[data-acc="cz-turno"]').forEach((b) => b.classList.toggle('activo', b === el)); };
INV_ACC['cz-modo'] = (el) => { INV_CIERRE.todos = el.dataset.todos === '1'; invIrA('cierre'); };
INV_ACC['conteo-libre'] = () => document.getElementById('btn-abrir-conteo').click();
INV_ACC['cz-guardar'] = async () => {
  const err = document.getElementById('cz-error');
  const lineas = Object.keys(INV_CIERRE.conteos).filter((id) => INV_CIERRE.conteos[id] !== '' && (INV.cierrePrep.insumos || []).some((i) => String(i.id) === String(id)))
    .map((id) => ({ insumo_id: Number(id), contado: Number(INV_CIERRE.conteos[id]), motivo: INV_CIERRE.motivos[id] || '' }));
  if (!lineas.length) return (err.textContent = 'Captura al menos un conteo.');
  const btn = document.getElementById('cz-guardar');
  btn.disabled = true;
  err.textContent = '';
  const r = await invApi('POST', '/api/inventario/cierre-turno', { sucursal_id: invSuc(), turno: INV_CIERRE.turno, lineas, notas: INV_CIERRE.notas, ajustar: INV_CIERRE.ajustar });
  if (!r.ok) { btn.disabled = false; return (err.textContent = r.d.error || 'No se pudo guardar el cierre.'); }
  Object.assign(INV_CIERRE, { conteos: {}, motivos: {}, notas: '' });
  INV.insumos = null;
  invAviso(r.d.con_diferencia ? `Cierre guardado: ${r.d.con_diferencia} insumo${r.d.con_diferencia === 1 ? '' : 's'} con diferencia.` : 'Cierre guardado: todo coincide ✓');
  invIrA('cierre');
  invActualizarBadge();
};
