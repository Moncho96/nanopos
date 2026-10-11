// ==================== EDITOR DE RECETAS ====================
// Pantalla completa para armar la receta de un platillo: ingredientes editables al momento (se guardan solos),
// variantes y extras con su costo y margen reales, copiar la receta de otro platillo, y un resumen fijo arriba
// con el costo y el food cost que se actualiza mientras escribes.
// Se carga después de app.js (usa state, escapeHtml y recargarCategoriasYProductos).

const REC = { id: null, d: null, insumos: [], token: 0, guardando: 0, timerOk: null, timerToast: null };
const REC_META_FC = 30; // food cost objetivo para sugerir precio
const REC_ACC = {}; // acciones por data-r-acc (clics)

// Cantidades en gramos / mililitros (lo natural en cocina) o en kg / litros. Siempre se GUARDAN en la unidad del insumo,
// con 3 decimales (la precisión de la base de datos: 1 g si el insumo está en kg).
REC.gramos = (() => { try { return localStorage.getItem('rec_gramos') !== '0'; } catch (e) { return true; } })();
const recUnidad = (u) => (REC.gramos && u === 'kg' ? { u: 'g', f: 1000 } : REC.gramos && u === 'l' ? { u: 'ml', f: 1000 } : { u, f: 1 });
const recVer = (cant, unidad) => Number((Number(cant) * recUnidad(unidad).f).toFixed(6)); // lo que se muestra
const recGuardable = (visto, unidad) => Math.round((visto / recUnidad(unidad).f) * 1000) / 1000; // lo que se guarda

// ---------- Utilidades ----------
const recEsc = (s) => escapeHtml(s === null || s === undefined ? '' : s);
const recAttr = (s) => recEsc(s).replace(/"/g, '&quot;');
const recNum = (n) => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 3 });
const recMon = (n) => (n < 0 ? '-$' : '$') + Math.abs(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const recNorm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const recSuc = () => document.getElementById('sucursal-select').value;
const recAbierto = () => document.getElementById('overlay-receta').classList.contains('abierto');
const recSoloNum = (el) => { el.value = el.value.replace(',', '.').replace(/[^0-9.]/g, ''); };
const recLeer = (el) => Number(String(el.value).replace(',', '.'));

async function recApi(metodo, url, cuerpo) {
  try {
    const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, d };
  } catch (e) {
    return { ok: false, status: 0, d: { error: 'No se pudo conectar. Revisa tu internet e intenta de nuevo.' } };
  }
}

// ---------- Modelo y costos ----------
const recOpcion = (id) => {
  for (const g of REC.d.grupos) {
    const op = g.opciones.find((o) => o.id === id);
    if (op) return { g, op };
  }
  return null;
};
const recCostoBase = () => REC.d.receta.reduce((s, r) => s + r.cantidad * r.costo_unitario, 0);
const recCostoExtras = (op) => op.insumos.reduce((s, r) => s + r.cantidad * r.costo_unitario, 0);
// Una variante gasta la receta base × sus piezas, más sus insumos extra; un extra solo gasta lo suyo
const recCostoOpcion = (g, op) => (g.tipo === 'variante' ? recCostoBase() * (op.multiplicador || 1) : 0) + recCostoExtras(op);
const recFC = (costo, precio) => (precio > 0 && costo > 0 ? (costo / precio) * 100 : null);
const recColorFC = (p) => (p === null ? '#999' : p <= 35 ? '#1a7d3a' : p <= 45 ? '#b07a00' : '#b8232f');

function recSinCosto() {
  const nombres = new Map();
  REC.d.receta.forEach((r) => r.costo_unitario <= 0 && nombres.set(r.insumo_id, r.nombre));
  REC.d.grupos.forEach((g) => g.opciones.forEach((o) => o.insumos.forEach((r) => r.costo_unitario <= 0 && nombres.set(r.insumo_id, r.nombre))));
  return [...nombres.values()];
}

// ---------- Avisos ----------
function recEstado(tipo, texto) {
  const el = document.getElementById('receta-estado');
  clearTimeout(REC.timerOk);
  if (tipo === 'guardando') el.textContent = 'Guardando…';
  else if (tipo === 'ok') {
    el.textContent = '✓ Guardado';
    REC.timerOk = setTimeout(() => { if (!REC.guardando) el.textContent = ''; }, 2200);
  } else el.textContent = '⚠️ ' + texto;
}

// Envuelve una petición de guardado: muestra "Guardando…/✓ Guardado" y devuelve la respuesta, o null si falló
async function recGuardar(promesa) {
  REC.guardando++;
  recEstado('guardando');
  const r = await promesa;
  REC.guardando--;
  if (r.ok) {
    if (!REC.guardando) recEstado('ok');
    return r;
  }
  recEstado('error', 'No se guardó');
  recToast(r.d?.error || 'No se pudo guardar el cambio', null, null, 4500, true);
  return null;
}

function recToast(mensaje, accion, fn, ms, error) {
  document.getElementById('rec-toast')?.remove();
  clearTimeout(REC.timerToast);
  const el = document.createElement('div');
  el.id = 'rec-toast';
  el.style.cssText = `position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:92vw;padding:11px 16px;border-radius:24px;z-index:500;font-size:14px;font-weight:600;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.3);display:flex;gap:14px;align-items:center;background:${error ? '#b8232f' : '#2a231c'}`;
  el.innerHTML = `<span>${recEsc(mensaje)}</span>${accion ? `<button id="rec-toast-btn" style="background:none;border:none;color:#ffd966;font-weight:800;font-size:14px;cursor:pointer;padding:0;font-family:inherit">${recEsc(accion)}</button>` : ''}`;
  document.body.appendChild(el);
  if (accion) el.querySelector('#rec-toast-btn').addEventListener('click', () => { el.remove(); fn(); });
  REC.timerToast = setTimeout(() => el.remove(), ms || (accion ? 6500 : 2600));
}

function recModal(html, onMount) {
  const cont = document.getElementById('modal-container');
  cont.innerHTML = `<div class="modal-overlay" id="rec-modal-overlay"><div class="modal-box">${html}</div></div>`;
  document.getElementById('rec-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'rec-modal-overlay') recCerrarModal();
  });
  if (onMount) onMount();
}
function recCerrarModal() {
  document.getElementById('modal-container').innerHTML = '';
}

// ---------- Carga ----------
async function recCargarDatos(productoId) {
  const [rc, ins] = await Promise.all([
    recApi('GET', `/api/productos/${productoId}/receta-completa`),
    recApi('GET', `/api/insumos?sucursal_id=${recSuc()}`),
  ]);
  if (!rc.ok) return { error: rc.d?.error || 'No se pudo cargar la receta' };
  const d = rc.d;
  // Copias "guardadas": permiten revertir un campo si el servidor no aceptó el cambio
  d.receta.forEach((r) => (r._g = r.cantidad));
  d.grupos.forEach((g) => {
    g._g = { nombre: g.nombre };
    g.opciones.forEach((o) => {
      o._g = { nombre: o.nombre, precio: o.precio, multiplicador: o.multiplicador };
      o.insumos.forEach((r) => (r._g = r.cantidad));
    });
  });
  REC.d = d;
  REC.insumos = ins.ok ? ins.d.map((i) => ({ id: i.id, nombre: i.nombre, unidad: i.unidad, costo_unitario: Number(i.costo_unitario), stock_actual: Number(i.stock_actual) })) : [];
  return { ok: true };
}

async function abrirModalReceta(productoId) {
  REC.id = productoId;
  const mi = ++REC.token;
  document.getElementById('rec-toast')?.remove(); // un «Deshacer» pendiente no debe actuar sobre otro platillo
  document.getElementById('overlay-receta').classList.add('abierto');
  document.getElementById('overlay-receta').scrollTop = 0;
  document.getElementById('receta-titulo').textContent = 'Receta';
  document.getElementById('receta-estado').textContent = '';
  document.getElementById('receta-resumen').innerHTML = '';
  document.getElementById('receta-cuerpo').innerHTML = '<div class="rec-vacio">Cargando…</div>';
  recPintarNav();
  const r = await recCargarDatos(productoId);
  if (mi !== REC.token) return; // se abrió otro platillo mientras cargaba este
  if (!r.ok) {
    document.getElementById('receta-cuerpo').innerHTML = `<div class="rec-vacio">${recEsc(r.error)}<br><br><button class="inv-btn" data-r-acc="reintentar">Reintentar</button></div>`;
    return;
  }
  document.getElementById('receta-titulo').textContent = REC.d.producto.nombre;
  recPintarTodo();
}
REC_ACC.reintentar = () => abrirModalReceta(REC.id);

async function recCerrar() {
  document.getElementById('overlay-receta').classList.remove('abierto');
  document.getElementById('rec-toast')?.remove();
  recCerrarModal();
  REC.token++;
  // Si acabas de editar un campo y cerraste enseguida, el guardado puede seguir en camino: se espera a que
  // termine (máx. 4 s) para que las listas se refresquen con el dato ya guardado y no con el anterior
  const inicio = Date.now();
  while (REC.guardando > 0 && Date.now() - inicio < 4000) await new Promise((fin) => setTimeout(fin, 60));
  await recargarCategoriasYProductos(); // el menú puede haber cambiado (variantes, precios de opciones)
  if (typeof invAbierto === 'function' && invAbierto() && INV.tab === 'recetas') invIrA('recetas'); // refresca los costos del inventario
}
document.getElementById('btn-cerrar-receta').addEventListener('click', recCerrar);

// ‹ › para pasar al platillo anterior o siguiente sin cerrar
function recPintarNav() {
  const i = state.productos.findIndex((p) => p.id === REC.id);
  document.getElementById('receta-prev').disabled = i <= 0;
  document.getElementById('receta-next').disabled = i < 0 || i >= state.productos.length - 1;
}
function recNavegar(dir) {
  const i = state.productos.findIndex((p) => p.id === REC.id);
  const destino = state.productos[i + dir];
  if (destino) abrirModalReceta(destino.id);
}
document.getElementById('receta-prev').addEventListener('click', () => recNavegar(-1));
document.getElementById('receta-next').addEventListener('click', () => recNavegar(1));

// ---------- Resumen fijo (costo, margen, food cost) ----------
function recFilasPrecio() {
  const d = REC.d;
  const variantes = d.grupos.filter((g) => g.tipo === 'variante');
  if (!variantes.length) return { conVariantes: false, filas: [{ nombre: d.producto.nombre, precio: d.producto.precio, costo: recCostoBase() }] };
  const varias = variantes.length > 1;
  return {
    conVariantes: true,
    filas: variantes.flatMap((g) => g.opciones.map((op) => ({ nombre: varias ? `${g.nombre}: ${op.nombre}` : op.nombre, precio: op.precio, costo: recCostoOpcion(g, op) }))),
  };
}

function recPintarResumen() {
  const d = REC.d;
  const base = recCostoBase();
  const { conVariantes, filas } = recFilasPrecio();
  const sinCosto = recSinCosto();
  const avisoCosto = sinCosto.length ? `<div class="rec-pista" style="color:#9a6a00">⚠️ ${sinCosto.length === 1 ? 'Falta el costo de' : 'Faltan los costos de'} <b>${recEsc(sinCosto.slice(0, 3).join(', '))}</b>${sinCosto.length > 3 ? ` y ${sinCosto.length - 3} más` : ''}: el costo real es mayor al mostrado.</div>` : '';
  let html;
  let detalle = '';

  if (!conVariantes) {
    const f = filas[0];
    const fc = recFC(f.costo, f.precio);
    const margen = f.precio - f.costo;
    let pista;
    if (!REC.d.receta.length) pista = 'Agrega los ingredientes para saber cuánto cuesta este platillo.';
    else if (!(f.precio > 0)) pista = 'Este platillo no tiene precio, así que no se puede calcular el food cost.';
    else if (fc === null) pista = 'Ponle costo a los ingredientes para calcular el food cost.';
    else if (fc <= 35) pista = `✅ Food cost sano (lo normal es 28–35%).`;
    else pista = `Para un food cost de ${REC_META_FC}% tendrías que cobrar <b>${recMon(f.costo / (REC_META_FC / 100))}</b> (hoy cobras ${recMon(f.precio)}).`;
    html = `
      <div class="rec-top"><div><div class="rec-nombre">${recEsc(d.producto.nombre)}</div><div class="rec-cat">${recEsc(d.producto.categoria)}</div></div><div style="font-weight:800;font-size:16px">${recMon(d.producto.precio)}</div></div>
      <div class="rec-stats">
        <div class="rec-stat"><div class="et">Costo</div><div class="val">${REC.d.receta.length ? recMon(f.costo) : '—'}</div></div>
        <div class="rec-stat"><div class="et">Margen</div><div class="val">${REC.d.receta.length ? recMon(margen) : '—'}</div></div>
        <div class="rec-stat"><div class="et">Food cost</div><div class="val" style="color:${recColorFC(fc)}">${fc === null ? '—' : Math.round(fc) + '%'}</div></div>
      </div>
      <div class="rec-medidor"><i style="width:${fc === null ? 0 : Math.min(100, (fc / 60) * 100)}%;background:${recColorFC(fc)}"></i></div>`;
    detalle = `<div class="rec-seccion"><div class="rec-pista">${pista}</div>${avisoCosto}</div>`;
  } else {
    const masCaro = d.receta.map((r) => ({ n: r.nombre, c: r.cantidad * r.costo_unitario })).sort((a, b) => b.c - a.c)[0];
    const caras = filas.filter((f) => { const fc = recFC(f.costo, f.precio); return fc !== null && fc > 35; });
    const pista = !d.receta.length
      ? 'Agrega los ingredientes de la receta base para ver cuánto cuesta cada presentación.'
      : caras.length
      ? `Con food cost alto: ${caras.slice(0, 2).map((f) => `<b>${recEsc(f.nombre)}</b> (para ${REC_META_FC}% cobra ${recMon(f.costo / (REC_META_FC / 100))})`).join(' · ')}.`
      : '✅ Todas las presentaciones tienen un food cost sano (lo normal es 28–35%).';
    html = `
      <div class="rec-top"><div><div class="rec-nombre">${recEsc(d.producto.nombre)}</div><div class="rec-cat">${recEsc(d.producto.categoria)} · el precio depende de la presentación</div></div></div>
      <div class="rec-stats">
        <div class="rec-stat"><div class="et">Costo / pieza</div><div class="val">${d.receta.length ? recMon(base) : '—'}</div></div>
        <div class="rec-stat"><div class="et">Ingredientes</div><div class="val">${d.receta.length}</div></div>
        <div class="rec-stat"><div class="et">Pesa más</div><div class="val" style="font-size:13px;line-height:1.3;white-space:normal">${masCaro && masCaro.c > 0 ? recEsc(masCaro.n) : '—'}</div></div>
      </div>`;
    detalle = `<div class="rec-seccion">
      <div class="rec-tabla" style="margin-top:0"><span class="h">Presentación</span><span class="h">Precio</span><span class="h">Costo</span><span class="h">Food cost</span>
        ${filas.map((f) => { const fc = recFC(f.costo, f.precio); return `<span style="font-weight:700">${recEsc(f.nombre)}</span><span class="n">${recMon(f.precio)}</span><span class="n">${d.receta.length ? recMon(f.costo) : '—'}</span><span class="n" style="color:${recColorFC(fc)}">${fc === null ? '—' : Math.round(fc) + '%'}</span>`; }).join('')}
      </div>
      <div class="rec-pista">${pista}</div>${avisoCosto}</div>`;
  }
  document.getElementById('receta-detalle').innerHTML = detalle;
  document.getElementById('receta-resumen').innerHTML = html;
}

// ---------- Cuerpo ----------
function recFila(ctx, r, base, opId) {
  const costo = r.cantidad * r.costo_unitario;
  const pct = ctx === 'base' && base > 0 ? (costo / base) * 100 : 0;
  const attrs = `data-ctx="${ctx}" data-id="${r.insumo_id}"${ctx === 'op' ? ` data-op="${opId}"` : ''}`;
  const k = ctx === 'base' ? `base-${r.insumo_id}` : `op-${opId}-${r.insumo_id}`;
  return `<div class="rec-fila" id="rf-${k}">
    <div><div class="nombre">${recEsc(r.nombre)}${r.costo_unitario <= 0 ? `<span class="rec-sincosto" data-r-acc="poner-costo" data-id="${r.insumo_id}">⚠️ sin costo · poner</span>` : ''}</div>
      <div class="det">${recMon(r.costo_unitario)} por ${recEsc(r.unidad)}</div></div>
    <div class="rec-costo"><span id="rcosto-${k}">${recMon(costo)}</span>${ctx === 'base' ? `<small id="rpct-${k}">${Math.round(pct)}% del costo</small>` : ''}</div>
    <div class="rec-cant"><input inputmode="decimal" value="${recVer(r.cantidad, r.unidad)}" data-f="${ctx === 'base' ? 'cant-base' : 'cant-op'}" ${attrs} aria-label="Cantidad de ${recAttr(r.nombre)}"><span>${recEsc(recUnidad(r.unidad).u)}</span></div>
    <button class="rec-quitar" data-r-acc="quitar" ${attrs} title="Quitar">✕</button>
    ${ctx === 'base' ? `<div class="rec-barra"><i id="rbar-${k}" style="width:${pct}%"></i></div>` : ''}
  </div>`;
}

function recPildoras(g, op) {
  const costo = recCostoOpcion(g, op);
  const margen = op.precio - costo;
  const fc = recFC(costo, op.precio);
  if (g.tipo === 'extra') {
    if (!op.insumos.length) return '<span class="inv-sub">No gasta insumos: no descuenta nada del inventario.</span>';
    return `<span class="rec-pildora">Costo del extra ${recMon(costo)}</span><span class="rec-pildora">Margen ${recMon(margen)}</span>${fc === null ? '' : `<span class="rec-pildora" style="color:${recColorFC(fc)}">Food cost ${Math.round(fc)}%</span>`}`;
  }
  if (!REC.d.receta.length && !op.insumos.length) return '<span class="inv-sub">Agrega ingredientes a la receta base para ver su costo.</span>';
  return `<span class="rec-pildora">Costo ${recMon(costo)}</span><span class="rec-pildora">Margen ${recMon(margen)}</span>${fc === null ? '' : `<span class="rec-pildora" style="color:${recColorFC(fc)}">Food cost ${Math.round(fc)}%</span>`}`;
}

function recTarjetaOpcion(g, op) {
  const esVar = g.tipo === 'variante';
  return `<div class="rec-opcion" id="ro-${op.id}">
    <div class="rec-op-top">
      <input style="flex:1" value="${recAttr(op.nombre)}" data-f="op-nombre" data-op="${op.id}" maxlength="60" aria-label="Nombre de la opción" />
      <span style="color:#888">$</span><input inputmode="decimal" style="width:74px;text-align:right" value="${op.precio}" data-f="op-precio" data-op="${op.id}" aria-label="Precio" />
      <button class="rec-quitar" data-r-acc="borrar-op" data-op="${op.id}" title="Borrar esta opción">✕</button>
    </div>
    ${esVar ? `<div class="rec-op-mult"><span>Equivale a</span><input inputmode="decimal" value="${op.multiplicador}" data-f="op-mult" data-op="${op.id}" aria-label="Piezas" /><span>pieza(s)</span></div><div class="rec-op-hint">Cuántas piezas de la receta base gasta (una «Orden» de 5 piezas = 5).</div>` : ''}
    <div class="rec-pildoras" id="roc-${op.id}">${recPildoras(g, op)}</div>
    <div class="rec-op-insumos">
      <div class="inv-sub"><b>${esVar ? 'Insumos extra de esta opción' : 'Insumos que gasta este extra'}</b>${esVar ? ' — se suman a la receta base' : ''}</div>
      ${op.insumos.map((r) => recFila('op', r, 0, op.id)).join('')}
      <button class="inv-btn chico" data-r-acc="picker-op" data-op="${op.id}" style="margin-top:6px">＋ Insumo</button>
    </div>
  </div>`;
}

function recTarjetaGrupo(g) {
  const esVar = g.tipo === 'variante';
  return `<div class="rec-grupo" id="rg-${g.id}">
    <div class="rec-grupo-top">
      <input class="nombre" value="${recAttr(g.nombre)}" data-f="grupo-nombre" data-grupo="${g.id}" maxlength="60" aria-label="Nombre del grupo" />
      <button class="rec-quitar" data-r-acc="borrar-grupo" data-grupo="${g.id}" title="Borrar este grupo">🗑️</button>
      <div class="rec-seg"><button class="${esVar ? 'activo' : ''}" data-r-acc="grupo-tipo" data-grupo="${g.id}" data-tipo="variante">Elegir una</button><button class="${!esVar ? 'activo' : ''}" data-r-acc="grupo-tipo" data-grupo="${g.id}" data-tipo="extra">Extras (varios)</button></div>
    </div>
    <div class="inv-sub" style="margin-top:6px">${esVar ? 'El cliente elige una opción y su precio <b>reemplaza</b> al del platillo.' : 'El cliente puede elegir varias y su precio <b>se suma</b>.'}
      <label style="margin-left:8px;white-space:nowrap"><input type="checkbox" data-f="grupo-obl" data-grupo="${g.id}" ${g.obligatorio ? 'checked' : ''} /> Obligatorio</label></div>
    ${g.opciones.map((op) => recTarjetaOpcion(g, op)).join('') || '<div class="rec-vacio">Todavía no hay opciones: agrega la primera aquí abajo.</div>'}
    <div class="rec-nueva-op" id="rn-${g.id}">
      <input placeholder="Nueva opción (ej. ${esVar ? 'Orden' : 'Queso'})" data-nuevo="nombre" style="flex:1;min-width:120px" maxlength="60" />
      <input inputmode="decimal" placeholder="$ precio" data-nuevo="precio" style="width:80px" />
      ${esVar ? '<input inputmode="decimal" placeholder="piezas" value="1" data-nuevo="mult" style="width:66px" title="Piezas de la receta base que gasta" />' : ''}
      <button class="inv-btn chico primario" data-r-acc="nueva-opcion" data-grupo="${g.id}">＋ Agregar</button>
    </div>
  </div>`;
}

function recPintarCuerpo() {
  const d = REC.d;
  const base = recCostoBase();
  document.getElementById('receta-cuerpo').innerHTML = `
    <div class="rec-seccion">
      <div class="rec-sec-top"><h3>🥣 Ingredientes</h3>
        <div class="rec-seg" title="Cómo ver las cantidades"><button class="${REC.gramos ? 'activo' : ''}" data-r-acc="unidades" data-g="1">g · ml</button><button class="${!REC.gramos ? 'activo' : ''}" data-r-acc="unidades" data-g="0">kg · l</button></div></div>
      <div class="sub">Lo que se gasta por <b>cada pieza</b> (o unidad) de este platillo. Cambia la cantidad directo y se guarda sola.</div>
      <div id="rec-filas-base">${d.receta.map((r) => recFila('base', r, base)).join('') || '<div class="rec-vacio">Este platillo todavía no tiene receta.<br>Agrega lo que lleva para saber cuánto te cuesta y para que descuente del inventario.</div>'}</div>
      <button class="rec-add" data-r-acc="picker-base">＋ Agregar ingrediente</button>
      <div style="margin-top:8px"><button class="inv-btn chico" data-r-acc="copiar">📋 Copiar la receta de otro platillo</button></div>
    </div>
    <div class="rec-seccion">
      <h3>🔀 Presentaciones y extras</h3>
      <div class="sub">Lo que el cliente puede elegir al pedir este platillo.</div>
      <details class="rec-ayuda"><summary><b>¿Cómo funciona?</b></summary>
        <p style="margin:6px 0 0"><b>Elegir una:</b> el cliente escoge una presentación (ej. «Pieza» u «Orden», «Maíz» o «Harina»). Su precio <b>reemplaza</b> al del platillo. En «Equivale a» indicas cuántas piezas de la receta base gasta: una Orden de 5 piezas = 5.</p>
        <p style="margin:6px 0 0"><b>Extras:</b> cosas que el cliente puede sumar (queso, tocino…). Su precio <b>se suma</b>, y puedes indicar qué insumos gastan para que también descuenten del inventario.</p>
      </details>
      ${d.grupos.map(recTarjetaGrupo).join('')}
      <button class="rec-add" data-r-acc="nuevo-grupo">＋ Nuevo grupo de opciones</button>
    </div>`;
}

function recPintarTodo() {
  recPintarResumen();
  recPintarCuerpo();
  recPintarNav();
}

// Actualiza solo los números (sin volver a dibujar, para no perder el cursor mientras escribes)
function recActualizarCostos() {
  recPintarResumen();
  const base = recCostoBase();
  REC.d.receta.forEach((r) => {
    const c = r.cantidad * r.costo_unitario;
    const pct = base > 0 ? (c / base) * 100 : 0;
    const k = `base-${r.insumo_id}`;
    const e1 = document.getElementById(`rcosto-${k}`), e2 = document.getElementById(`rpct-${k}`), e3 = document.getElementById(`rbar-${k}`);
    if (e1) e1.textContent = recMon(c);
    if (e2) e2.textContent = `${Math.round(pct)}% del costo`;
    if (e3) e3.style.width = `${pct}%`;
  });
  REC.d.grupos.forEach((g) => g.opciones.forEach((op) => {
    op.insumos.forEach((r) => {
      const e = document.getElementById(`rcosto-op-${op.id}-${r.insumo_id}`);
      if (e) e.textContent = recMon(r.cantidad * r.costo_unitario);
    });
    const el = document.getElementById(`roc-${op.id}`);
    if (el) el.innerHTML = recPildoras(g, op);
  }));
}

function recEnfocarFila(k) {
  const fila = document.getElementById(`rf-${k}`);
  if (!fila) return;
  fila.scrollIntoView({ block: 'center', behavior: 'smooth' });
  fila.classList.add('rec-flash');
  const inp = fila.querySelector('input');
  if (inp) inp.focus({ preventScroll: true });
}

// g · ml  ⇄  kg · l (solo cambia cómo se ve y se escribe; siempre se guarda en la unidad del insumo)
REC_ACC.unidades = (el) => {
  REC.gramos = el.dataset.g === '1';
  try { localStorage.setItem('rec_gramos', REC.gramos ? '1' : '0'); } catch (e) { /* sin almacenamiento: queda solo esta sesión */ }
  recPintarCuerpo();
};

// ---------- Eventos del cuerpo ----------
const recCuerpo = document.getElementById('receta-cuerpo');
recCuerpo.addEventListener('click', (e) => {
  const el = e.target.closest('[data-r-acc]');
  if (el && REC_ACC[el.dataset.rAcc]) REC_ACC[el.dataset.rAcc](el, e);
});
recCuerpo.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.type === 'checkbox') return;
  const nueva = e.target.closest('.rec-nueva-op');
  if (nueva) nueva.querySelector('[data-r-acc="nueva-opcion"]').click();
  else e.target.blur(); // al salir del campo se guarda
});
document.getElementById('receta-resumen').addEventListener('click', (e) => {
  const el = e.target.closest('[data-r-acc]');
  if (el && REC_ACC[el.dataset.rAcc]) REC_ACC[el.dataset.rAcc](el, e);
});

// Escribiendo: se ven los costos al instante (todavía sin guardar)
recCuerpo.addEventListener('input', (e) => {
  // Los campos de «Nueva opción»: el precio y las piezas son números; el nombre es texto libre
  if (e.target.dataset.nuevo) {
    if (e.target.dataset.nuevo !== 'nombre') recSoloNum(e.target);
    return;
  }
  const f = e.target.dataset.f;
  if (!f) return;
  if (['cant-base', 'cant-op', 'op-precio', 'op-mult'].includes(f)) recSoloNum(e.target);
  const v = recLeer(e.target);
  if (f === 'cant-base') { const fila = REC.d.receta.find((r) => r.insumo_id === Number(e.target.dataset.id)); const c = recGuardable(v, fila.unidad); if (c > 0) { fila.cantidad = c; recActualizarCostos(); } }
  if (f === 'cant-op') { const fila = recOpcion(Number(e.target.dataset.op)).op.insumos.find((r) => r.insumo_id === Number(e.target.dataset.id)); const c = recGuardable(v, fila.unidad); if (c > 0) { fila.cantidad = c; recActualizarCostos(); } }
  if (f === 'op-precio' && v >= 0 && e.target.value !== '') { recOpcion(Number(e.target.dataset.op)).op.precio = v; recActualizarCostos(); }
  if (f === 'op-mult' && v > 0) { recOpcion(Number(e.target.dataset.op)).op.multiplicador = v; recActualizarCostos(); }
});

// Al salir del campo (o Enter): se guarda
function recInvalido(input, restaurar) {
  input.classList.add('invalido');
  recEstado('error', 'Revisa el valor');
  setTimeout(() => input.classList.remove('invalido'), 1400);
  restaurar();
  recActualizarCostos();
}
recCuerpo.addEventListener('change', async (e) => {
  const el = e.target;
  const f = el.dataset.f;
  if (!f) return;

  if (f === 'cant-base') {
    const r = REC.d.receta.find((x) => x.insumo_id === Number(el.dataset.id));
    const v = recGuardable(recLeer(el), r.unidad);
    if (!(v > 0)) return recInvalido(el, () => { r.cantidad = r._g; el.value = recVer(r._g, r.unidad); });
    el.value = recVer(v, r.unidad); // lo que se ve es lo que se guarda (la BD guarda 3 decimales)
    if (Math.abs(v - r._g) < 1e-9) { r.cantidad = r._g; return recActualizarCostos(); }
    r.cantidad = v;
    const ok = await recGuardar(recApi('POST', `/api/productos/${REC.id}/receta`, { insumo_id: r.insumo_id, cantidad: v }));
    if (ok) r._g = v;
    else { r.cantidad = r._g; el.value = recVer(r._g, r.unidad); recActualizarCostos(); }
  } else if (f === 'cant-op') {
    const { op } = recOpcion(Number(el.dataset.op));
    const r = op.insumos.find((x) => x.insumo_id === Number(el.dataset.id));
    const v = recGuardable(recLeer(el), r.unidad);
    if (!(v > 0)) return recInvalido(el, () => { r.cantidad = r._g; el.value = recVer(r._g, r.unidad); });
    el.value = recVer(v, r.unidad);
    if (Math.abs(v - r._g) < 1e-9) { r.cantidad = r._g; return recActualizarCostos(); }
    r.cantidad = v;
    const ok = await recGuardar(recApi('POST', `/api/opciones/${op.id}/insumos`, { insumo_id: r.insumo_id, cantidad: v }));
    if (ok) r._g = v;
    else { r.cantidad = r._g; el.value = recVer(r._g, r.unidad); recActualizarCostos(); }
  } else if (['op-nombre', 'op-precio', 'op-mult'].includes(f)) {
    const { op } = recOpcion(Number(el.dataset.op));
    const campo = { 'op-nombre': 'nombre', 'op-precio': 'precio', 'op-mult': 'multiplicador' }[f];
    let v = f === 'op-nombre' ? el.value.trim() : recLeer(el);
    const valido = f === 'op-nombre' ? v.length > 0 : f === 'op-precio' ? el.value !== '' && v >= 0 : v > 0;
    if (!valido) return recInvalido(el, () => { op[campo] = op._g[campo]; el.value = op._g[campo]; });
    if (v === op._g[campo]) return;
    op[campo] = v;
    const ok = await recGuardar(recApi('PATCH', `/api/opciones/${op.id}`, { [campo]: v }));
    if (ok) { op._g[campo] = v; recActualizarCostos(); }
    else { op[campo] = op._g[campo]; el.value = op._g[campo]; recActualizarCostos(); }
  } else if (f === 'grupo-nombre') {
    const g = REC.d.grupos.find((x) => x.id === Number(el.dataset.grupo));
    const v = el.value.trim();
    if (!v) return recInvalido(el, () => { el.value = g._g.nombre; });
    if (v === g._g.nombre) return;
    const ok = await recGuardar(recApi('PATCH', `/api/grupos/${g.id}`, { nombre: v }));
    if (ok) { g.nombre = v; g._g.nombre = v; recActualizarCostos(); }
    else el.value = g._g.nombre;
  } else if (f === 'grupo-obl') {
    const g = REC.d.grupos.find((x) => x.id === Number(el.dataset.grupo));
    const ok = await recGuardar(recApi('PATCH', `/api/grupos/${g.id}`, { obligatorio: el.checked }));
    if (ok) g.obligatorio = el.checked;
    else el.checked = g.obligatorio;
  }
});

// ---------- Acciones ----------
REC_ACC.quitar = async (el) => {
  const ctx = el.dataset.ctx;
  const id = Number(el.dataset.id);
  const lista = ctx === 'base' ? REC.d.receta : recOpcion(Number(el.dataset.op)).op.insumos;
  const url = ctx === 'base' ? `/api/productos/${REC.id}/receta` : `/api/opciones/${el.dataset.op}/insumos`;
  const previo = lista.find((r) => r.insumo_id === id);
  const ok = await recGuardar(recApi('DELETE', `${url}/${id}`));
  if (!ok) return;
  lista.splice(lista.indexOf(previo), 1);
  recPintarTodo();
  recToast(`Quitaste «${previo.nombre}»`, 'Deshacer', async () => {
    const r = await recGuardar(recApi('POST', url, { insumo_id: id, cantidad: previo.cantidad }));
    if (!r) return;
    lista.push({ ...previo, _g: previo.cantidad });
    recPintarTodo();
    recEnfocarFila(ctx === 'base' ? `base-${id}` : `op-${el.dataset.op}-${id}`);
  });
};

REC_ACC['grupo-tipo'] = async (el) => {
  const g = REC.d.grupos.find((x) => x.id === Number(el.dataset.grupo));
  if (g.tipo === el.dataset.tipo) return;
  const ok = await recGuardar(recApi('PATCH', `/api/grupos/${g.id}`, { tipo: el.dataset.tipo }));
  if (!ok) return;
  g.tipo = el.dataset.tipo;
  recPintarTodo();
};

REC_ACC['borrar-grupo'] = async (el) => {
  const g = REC.d.grupos.find((x) => x.id === Number(el.dataset.grupo));
  if (!confirm(`¿Borrar el grupo «${g.nombre}»${g.opciones.length ? ` con sus ${g.opciones.length} opción(es)` : ''}? No se puede deshacer.`)) return;
  const ok = await recGuardar(recApi('DELETE', `/api/grupos/${g.id}`));
  if (!ok) return;
  REC.d.grupos = REC.d.grupos.filter((x) => x.id !== g.id);
  recPintarTodo();
};

REC_ACC['borrar-op'] = async (el) => {
  const { g, op } = recOpcion(Number(el.dataset.op));
  if (!confirm(`¿Borrar la opción «${op.nombre}»${op.insumos.length ? ' y sus insumos extra' : ''}? No se puede deshacer.`)) return;
  const ok = await recGuardar(recApi('DELETE', `/api/opciones/${op.id}`));
  if (!ok) return;
  g.opciones = g.opciones.filter((x) => x.id !== op.id);
  recPintarTodo();
};

REC_ACC['nueva-opcion'] = async (el) => {
  const g = REC.d.grupos.find((x) => x.id === Number(el.dataset.grupo));
  const caja = document.getElementById(`rn-${g.id}`);
  const nombre = caja.querySelector('[data-nuevo="nombre"]').value.trim();
  const precioTxt = caja.querySelector('[data-nuevo="precio"]').value;
  const multEl = caja.querySelector('[data-nuevo="mult"]');
  const mult = multEl ? recLeer(multEl) : 1;
  if (!nombre) { caja.querySelector('[data-nuevo="nombre"]').focus(); return recToast('Escribe el nombre de la opción', null, null, 2600, true); }
  if (precioTxt === '' || !(Number(precioTxt) >= 0)) { caja.querySelector('[data-nuevo="precio"]').focus(); return recToast('Escribe el precio (0 si no cuesta extra)', null, null, 2600, true); }
  if (!(mult > 0)) return recToast('Las piezas deben ser mayores a cero', null, null, 2600, true);
  const r = await recGuardar(recApi('POST', `/api/grupos/${g.id}/opciones`, { nombre, precio: Number(precioTxt), multiplicador: mult }));
  if (!r) return;
  const op = { id: r.d.id, nombre: r.d.nombre, precio: Number(r.d.precio), multiplicador: Number(r.d.multiplicador) || 1, insumos: [] };
  op._g = { nombre: op.nombre, precio: op.precio, multiplicador: op.multiplicador };
  g.opciones.push(op);
  recPintarTodo();
  const nuevo = document.getElementById(`ro-${op.id}`);
  if (nuevo) { nuevo.scrollIntoView({ block: 'center', behavior: 'smooth' }); nuevo.classList.add('rec-flash'); }
};

// ---------- Elegir ingrediente (buscador) ----------
REC_ACC['picker-base'] = () => recAbrirPicker({ tipo: 'base' });
REC_ACC['picker-op'] = (el) => recAbrirPicker({ tipo: 'op', opcionId: Number(el.dataset.op) });

function recContexto(ctx) {
  if (ctx.tipo === 'base') return { titulo: 'Agregar ingrediente', detalle: 'Se descontará por cada pieza (o unidad) que se venda.', usados: REC.d.receta, url: `/api/productos/${REC.id}/receta`, clave: (id) => `base-${id}` };
  const { op } = recOpcion(ctx.opcionId);
  return { titulo: `Agregar insumo a «${op.nombre}»`, detalle: 'Se suma a lo que gasta esta opción cuando el cliente la elige.', usados: op.insumos, url: `/api/opciones/${op.id}/insumos`, clave: (id) => `op-${op.id}-${id}` };
}

function recAbrirPicker(ctx, textoInicial) {
  const c = recContexto(ctx);
  const usados = new Set(c.usados.map((r) => r.insumo_id));
  recModal(`
    <h3 style="margin:0 0 2px">${recEsc(c.titulo)}</h3>
    <div class="inv-sub">${recEsc(c.detalle)}</div>
    <input class="inv-input" id="rp-buscar" placeholder="Buscar… (ej. tortilla, carne)" autocomplete="off" style="margin-top:8px" value="${recAttr(textoInicial || '')}" />
    <div class="rec-lista" id="rp-lista"></div>
    <button class="inv-btn" id="rp-nuevo" style="width:100%">➕ Crear un insumo nuevo</button>
    <div class="modal-botones"><button class="btn-cancelar" id="rp-cancelar">Cancelar</button></div>`,
  () => {
    const pintar = () => {
      const q = recNorm(document.getElementById('rp-buscar').value.trim());
      const lista = REC.insumos.filter((i) => !q || recNorm(i.nombre).includes(q)).slice(0, 80);
      document.getElementById('rp-lista').innerHTML = lista.length
        ? lista.map((i) => `<div class="rec-item ${usados.has(i.id) ? 'usado' : ''}" data-id="${i.id}"><div><div class="n">${recEsc(i.nombre)}</div><div class="s">${recMon(i.costo_unitario)} por ${recEsc(i.unidad)} · hay ${recNum(Math.max(0, i.stock_actual))}</div></div>${usados.has(i.id) ? '<span class="inv-sub">ya está</span>' : '<span style="color:#b8232f;font-weight:800">＋</span>'}</div>`).join('')
        : `<div class="rec-vacio">No hay insumos que coincidan.<br>Puedes crearlo con el botón de abajo.</div>`;
      document.querySelectorAll('#rp-lista .rec-item').forEach((el) => el.addEventListener('click', () => {
        const ins = REC.insumos.find((i) => i.id === Number(el.dataset.id));
        if (usados.has(ins.id)) { recCerrarModal(); return recEnfocarFila(c.clave(ins.id)); } // ya está: se va directo a su cantidad
        recPickerCantidad(ctx, ins);
      }));
    };
    document.getElementById('rp-buscar').addEventListener('input', pintar);
    document.getElementById('rp-cancelar').addEventListener('click', recCerrarModal);
    document.getElementById('rp-nuevo').addEventListener('click', () => recPickerNuevoInsumo(ctx, document.getElementById('rp-buscar').value.trim()));
    pintar();
    document.getElementById('rp-buscar').focus();
  });
}

function recPickerCantidad(ctx, ins) {
  const c = recContexto(ctx);
  recModal(`
    <h3 style="margin:0 0 2px">${recEsc(ins.nombre)}</h3>
    <div class="inv-sub">${ctx.tipo === 'base' ? 'Cantidad que se gasta por cada pieza (o unidad) del platillo.' : 'Cantidad que se suma cuando el cliente elige esta opción.'}</div>
    <label class="inv-label">Cantidad (${recEsc(recUnidad(ins.unidad).u)})</label>
    <input class="inv-input" id="rq-cant" inputmode="decimal" placeholder="${['pza', 'paquete'].includes(ins.unidad) ? 'Ej. 1' : recUnidad(ins.unidad).f === 1000 ? 'Ej. 60' : 'Ej. 0.06'}" autocomplete="off" style="font-size:22px;padding:12px" />
    <div class="inv-sub" id="rq-prev" style="margin-top:8px;min-height:18px"></div>
    <div id="rq-error" class="inv-neg" style="font-size:13px;margin-top:6px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="rq-atras">← Atrás</button><button class="btn-agregar" id="rq-ok">Agregar</button></div>`,
  () => {
    const inp = document.getElementById('rq-cant');
    const minimo = () => `${recVer(0.001, ins.unidad)} ${recUnidad(ins.unidad).u}`;
    const prev = () => {
      const tecleado = recLeer(inp);
      const v = recGuardable(tecleado, ins.unidad); // lo que realmente se guardará (3 decimales)
      document.getElementById('rq-prev').innerHTML = tecleado > 0 && !(v > 0)
        ? `⚠️ Es muy poco: la cantidad mínima es <b>${minimo()}</b>.`
        : v > 0
        ? (ins.costo_unitario > 0 ? `Cuesta <b>${recMon(v * ins.costo_unitario)}</b> por cada pieza.` : '⚠️ Este insumo no tiene costo todavía; podrás ponérselo después.')
        : '';
    };
    inp.addEventListener('input', () => { recSoloNum(inp); prev(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('rq-ok').click(); });
    document.getElementById('rq-atras').addEventListener('click', () => recAbrirPicker(ctx));
    document.getElementById('rq-ok').addEventListener('click', async () => {
      const tecleado = recLeer(inp);
      const v = recGuardable(tecleado, ins.unidad);
      if (!(v > 0)) { document.getElementById('rq-error').textContent = tecleado > 0 ? `Es muy poco: la cantidad mínima es ${minimo()}.` : 'Escribe una cantidad mayor a cero.'; return; }
      document.getElementById('rq-ok').disabled = true;
      const r = await recGuardar(recApi('POST', c.url, { insumo_id: ins.id, cantidad: v }));
      if (!r) { document.getElementById('rq-ok').disabled = false; return; }
      c.usados.push({ insumo_id: ins.id, nombre: ins.nombre, unidad: ins.unidad, cantidad: v, costo_unitario: ins.costo_unitario, _g: v });
      recCerrarModal();
      recPintarTodo();
      recEnfocarFila(c.clave(ins.id));
    });
    inp.focus();
  });
}

function recPickerNuevoInsumo(ctx, nombreInicial) {
  const unidades = ['kg', 'g', 'l', 'ml', 'pza', 'paquete'];
  recModal(`
    <h3 style="margin:0 0 6px">Crear insumo nuevo</h3>
    <label class="inv-label" style="margin-top:0">Nombre</label><input class="inv-input" id="rn-nombre" maxlength="80" value="${recAttr(nombreInicial)}" />
    <div class="inv-grid2">
      <div><label class="inv-label">Se mide en</label><select class="inv-input" id="rn-unidad">${unidades.map((u) => `<option>${u}</option>`).join('')}</select></div>
      <div><label class="inv-label">Costo por unidad ($)</label><input class="inv-input" id="rn-costo" inputmode="decimal" placeholder="Opcional" /></div>
    </div>
    <div class="inv-sub" style="margin-top:6px">Si no sabes el costo, déjalo vacío: se actualiza solo cuando registres una compra.</div>
    <div id="rn-error" class="inv-neg" style="font-size:13px;margin-top:6px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="rn-atras">← Atrás</button><button class="btn-agregar" id="rn-ok">Crear y seguir</button></div>`,
  () => {
    document.getElementById('rn-costo').addEventListener('input', (e) => recSoloNum(e.target));
    document.getElementById('rn-atras').addEventListener('click', () => recAbrirPicker(ctx, nombreInicial));
    document.getElementById('rn-ok').addEventListener('click', async () => {
      const nombre = document.getElementById('rn-nombre').value.trim();
      if (!nombre) { document.getElementById('rn-error').textContent = 'Escribe el nombre del insumo.'; return; }
      document.getElementById('rn-ok').disabled = true;
      const r = await recApi('POST', '/api/insumos', { nombre, unidad: document.getElementById('rn-unidad').value, costo_unitario: Number(document.getElementById('rn-costo').value) || 0 });
      if (!r.ok) { document.getElementById('rn-ok').disabled = false; document.getElementById('rn-error').textContent = r.d.error || 'No se pudo crear el insumo.'; return; }
      const ins = { id: r.d.id, nombre: r.d.nombre, unidad: r.d.unidad, costo_unitario: Number(r.d.costo_unitario) || 0, stock_actual: 0 };
      REC.insumos.push(ins);
      REC.insumos.sort((a, b) => a.nombre.localeCompare(b.nombre));
      recPickerCantidad(ctx, ins);
    });
    document.getElementById('rn-nombre').focus();
  });
}

// ---------- Poner costo a un insumo que no lo tiene ----------
REC_ACC['poner-costo'] = (el) => {
  const id = Number(el.dataset.id);
  const ins = REC.insumos.find((i) => i.id === id) || [...REC.d.receta, ...REC.d.grupos.flatMap((g) => g.opciones.flatMap((o) => o.insumos))].find((r) => r.insumo_id === id);
  const nombre = ins.nombre;
  const unidad = ins.unidad;
  recModal(`
    <h3 style="margin:0 0 4px">Costo de «${recEsc(nombre)}»</h3>
    <div class="inv-sub">Cuánto te cuesta 1 ${recEsc(unidad)}. Se usa en todas las recetas que lleven este insumo, y se actualiza solo con tus compras.</div>
    <label class="inv-label">Costo por ${recEsc(unidad)} ($)</label>
    <input class="inv-input" id="rk-costo" inputmode="decimal" placeholder="Ej. 150" autocomplete="off" style="font-size:20px;padding:12px" />
    <div id="rk-error" class="inv-neg" style="font-size:13px;margin-top:6px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="rk-cancelar">Cancelar</button><button class="btn-agregar" id="rk-ok">Guardar</button></div>`,
  () => {
    const inp = document.getElementById('rk-costo');
    inp.addEventListener('input', () => recSoloNum(inp));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('rk-ok').click(); });
    document.getElementById('rk-cancelar').addEventListener('click', recCerrarModal);
    document.getElementById('rk-ok').addEventListener('click', async () => {
      const v = recLeer(inp);
      if (!(v > 0)) { document.getElementById('rk-error').textContent = 'Escribe un costo mayor a cero.'; return; }
      const r = await recGuardar(recApi('PATCH', `/api/insumos/${id}`, { costo_unitario: v }));
      if (!r) return;
      REC.insumos.forEach((i) => i.id === id && (i.costo_unitario = v));
      REC.d.receta.forEach((x) => x.insumo_id === id && (x.costo_unitario = v));
      REC.d.grupos.forEach((g) => g.opciones.forEach((o) => o.insumos.forEach((x) => x.insumo_id === id && (x.costo_unitario = v))));
      recCerrarModal();
      recPintarTodo();
    });
    inp.focus();
  });
};

// ---------- Copiar la receta de otro platillo ----------
REC_ACC.copiar = () => {
  const productos = state.productos.filter((p) => p.id !== REC.id);
  const nombreCat = {};
  state.categorias.forEach((c) => (nombreCat[c.id] = c.nombre));
  recModal(`
    <h3 style="margin:0 0 2px">Copiar receta de otro platillo</h3>
    <div class="inv-sub">Elige el platillo del que quieres copiar los ingredientes. Después puedes ajustar las cantidades.</div>
    <input class="inv-input" id="rc-buscar" placeholder="Buscar platillo…" autocomplete="off" style="margin-top:8px" />
    <div class="rec-lista" id="rc-lista"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="rc-cancelar">Cancelar</button></div>`,
  () => {
    const pintar = () => {
      const q = recNorm(document.getElementById('rc-buscar').value.trim());
      const lista = productos.filter((p) => !q || recNorm(p.nombre).includes(q));
      document.getElementById('rc-lista').innerHTML = lista.length
        ? lista.map((p) => `<div class="rec-item" data-id="${p.id}"><div><div class="n">${recEsc(p.nombre)}</div><div class="s">${recEsc(nombreCat[p.categoria_id] || '')}</div></div><span style="color:#b8232f;font-weight:800">›</span></div>`).join('')
        : '<div class="rec-vacio">No hay platillos que coincidan.</div>';
      document.querySelectorAll('#rc-lista .rec-item').forEach((el) => el.addEventListener('click', () => recElegirModoCopia(productos.find((p) => p.id === Number(el.dataset.id)))));
    };
    document.getElementById('rc-buscar').addEventListener('input', pintar);
    document.getElementById('rc-cancelar').addEventListener('click', recCerrarModal);
    pintar();
    document.getElementById('rc-buscar').focus();
  });
};

function recElegirModoCopia(origen) {
  if (!REC.d.receta.length) return recEjecutarCopia(origen, 'combinar'); // no hay nada que pisar
  recModal(`
    <h3 style="margin:0 0 4px">Copiar de «${recEsc(origen.nombre)}»</h3>
    <div class="inv-sub">Este platillo ya tiene ${REC.d.receta.length} ingrediente(s). ¿Qué hacemos?</div>
    <button class="inv-btn" id="rm-combinar" style="width:100%;text-align:left;margin-top:10px"><b>Combinar</b><br><span class="inv-sub">Agrega los que faltan y actualiza las cantidades de los que se repiten.</span></button>
    <button class="inv-btn" id="rm-reemplazar" style="width:100%;text-align:left;margin-top:8px"><b>Reemplazar</b><br><span class="inv-sub">Borra la receta actual y deja la de «${recEsc(origen.nombre)}».</span></button>
    <div id="rm-error" class="inv-neg" style="font-size:13px;margin-top:6px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="rm-atras">← Atrás</button></div>`,
  () => {
    document.getElementById('rm-atras').addEventListener('click', REC_ACC.copiar);
    document.getElementById('rm-combinar').addEventListener('click', () => recEjecutarCopia(origen, 'combinar'));
    document.getElementById('rm-reemplazar').addEventListener('click', () => recEjecutarCopia(origen, 'reemplazar'));
  });
}

async function recEjecutarCopia(origen, modo) {
  const r = await recGuardar(recApi('POST', `/api/productos/${REC.id}/receta/copiar`, { origen_id: origen.id, modo }));
  if (!r) {
    const err = document.getElementById('rm-error');
    if (err) err.textContent = 'No se pudo copiar. Revisa que ese platillo ya tenga receta.';
    return;
  }
  const carga = await recCargarDatos(REC.id);
  recCerrarModal();
  if (carga.ok) recPintarTodo();
  recToast(`Receta copiada de «${origen.nombre}» (${r.d.copiados} ingrediente${r.d.copiados === 1 ? '' : 's'})`);
}

// ---------- Grupo nuevo ----------
REC_ACC['nuevo-grupo'] = () => {
  recModal(`
    <h3 style="margin:0 0 6px">Nuevo grupo de opciones</h3>
    <label class="inv-label" style="margin-top:0">Nombre</label>
    <input class="inv-input" id="rg-nombre" maxlength="60" placeholder="Ej. Presentación, Tortilla, Extras" autocomplete="off" />
    <label class="inv-label">¿Cómo lo elige el cliente?</label>
    <label class="inv-card" style="display:block;cursor:pointer;margin:0 0 8px;border:2px solid #b8232f"><input type="radio" name="rg-tipo" value="variante" checked style="margin-right:6px" /><b>Elegir una</b><div class="inv-sub">Escoge una opción (ej. Pieza u Orden, Maíz o Harina). Cada una tiene su propio precio.</div></label>
    <label class="inv-card" style="display:block;cursor:pointer;margin:0;border:2px solid #e5e5e5"><input type="radio" name="rg-tipo" value="extra" style="margin-right:6px" /><b>Extras</b><div class="inv-sub">Puede sumar varios (ej. queso, tocino). Su precio se suma al del platillo.</div></label>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:14px"><input type="checkbox" id="rg-obl" checked /> Obligatorio (el cliente debe elegir)</label>
    <div id="rg-error" class="inv-neg" style="font-size:13px;margin-top:6px"></div>
    <div class="modal-botones"><button class="btn-cancelar" id="rg-cancelar">Cancelar</button><button class="btn-agregar" id="rg-ok">Crear grupo</button></div>`,
  () => {
    document.querySelectorAll('input[name="rg-tipo"]').forEach((r) => r.addEventListener('change', () => {
      document.querySelectorAll('input[name="rg-tipo"]').forEach((x) => (x.closest('label').style.borderColor = x.checked ? '#b8232f' : '#e5e5e5'));
      document.getElementById('rg-obl').checked = r.value === 'variante';
    }));
    document.getElementById('rg-cancelar').addEventListener('click', recCerrarModal);
    document.getElementById('rg-ok').addEventListener('click', async () => {
      const nombre = document.getElementById('rg-nombre').value.trim();
      if (!nombre) { document.getElementById('rg-error').textContent = 'Escribe el nombre del grupo.'; return; }
      const tipo = document.querySelector('input[name="rg-tipo"]:checked').value;
      document.getElementById('rg-ok').disabled = true;
      const r = await recGuardar(recApi('POST', `/api/productos/${REC.id}/grupos`, { nombre, tipo, obligatorio: document.getElementById('rg-obl').checked }));
      if (!r) { document.getElementById('rg-ok').disabled = false; return; }
      REC.d.grupos.push({ id: r.d.id, nombre: r.d.nombre, tipo: r.d.tipo, obligatorio: r.d.obligatorio, opciones: [], _g: { nombre: r.d.nombre } });
      recCerrarModal();
      recPintarTodo();
      const el = document.getElementById(`rg-${r.d.id}`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('rec-flash'); }
    });
    document.getElementById('rg-nombre').focus();
  });
};

// Mosaico «Recetas» del tablero: abre la lista de platillos con su costo y food cost (Inventario → Recetas y costos)
document.getElementById('btn-abrir-recetas').addEventListener('click', () => {
  INV.tab = 'recetas';
  document.getElementById('btn-abrir-inventario').click();
});
