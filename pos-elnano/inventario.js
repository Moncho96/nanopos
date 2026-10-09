// =====================================================================
// INVENTARIO AVANZADO
// Kardex (historial de movimientos), mermas, compras con factor de conversión, proveedores,
// producción diaria, recetas y costos, cierre de turno y alertas.
//
// Regla de oro: TODO cambio de stock pasa por mover() o fijar(), que actualizan el stock y dejan
// su fila en movimientos_inventario en la misma instrucción SQL. Así el historial siempre cuadra.
// =====================================================================

module.exports = function crearInventario({ pool }) {
  const num = (v, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const r4 = (n) => Math.round(n * 10000) / 10000;
  const texto = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

  const MOTIVOS_MERMA = ['caducidad', 'accidente', 'sobreproduccion', 'error_cocina', 'devolucion_cliente', 'faltante', 'otro'];
  const TURNOS = ['Matutino', 'Vespertino', 'Nocturno', 'Cierre del día'];

  let avisoMigracion = false;

  // ---------- Núcleo: mover y fijar stock ----------

  // Suma o resta stock (cantidad con signo) y registra el movimiento, todo en una sola instrucción.
  // `db` puede ser el pool o un cliente dentro de una transacción.
  async function mover(db, m) {
    const cantidad = r3(num(m.cantidad));
    if (cantidad === 0) return { id: null, saldo_despues: null };
    const params = [
      m.insumo_id, m.sucursal_id, cantidad, m.tipo, m.motivo || null, m.nota || null,
      m.referencia_tipo || null, m.referencia_id || null,
      m.empleado?.id ?? null, m.empleado?.nombre ?? null,
      m.costo_unitario === undefined || m.costo_unitario === null ? null : num(m.costo_unitario),
    ];
    try {
      const { rows } = await db.query(
        `WITH s AS (
           INSERT INTO inventario_stock (insumo_id, sucursal_id, stock_actual) VALUES ($1::int, $2::int, $3::numeric)
           ON CONFLICT (insumo_id, sucursal_id) DO UPDATE SET stock_actual = inventario_stock.stock_actual + $3::numeric
           RETURNING stock_actual
         )
         INSERT INTO movimientos_inventario
           (sucursal_id, insumo_id, tipo, cantidad, saldo_despues, costo_unitario, motivo, nota, referencia_tipo, referencia_id, empleado_id, empleado_nombre)
         SELECT $2::int, $1::int, $4::text, $3::numeric, s.stock_actual,
                COALESCE($11::numeric, (SELECT costo_unitario FROM insumos WHERE id = $1::int)),
                $5::text, $6::text, $7::text, $8::int, $9::int, $10::text
         FROM s
         RETURNING id, saldo_despues`,
        params
      );
      return rows[0];
    } catch (err) {
      // Si todavía no se corrió la migración, NO se deben romper las ventas: solo se mueve el stock.
      // (Solo aplica fuera de transacciones; dentro de una, el error se propaga.)
      if (db !== pool || !['42P01', '42703'].includes(err.code)) throw err;
      if (!avisoMigracion) {
        avisoMigracion = true;
        console.warn('[inventario] Falta correr db/migracion-inventario-avanzado.sql: el stock se mueve pero no queda historial.');
      }
      await db.query(
        `INSERT INTO inventario_stock (insumo_id, sucursal_id, stock_actual) VALUES ($1,$2,$3)
         ON CONFLICT (insumo_id, sucursal_id) DO UPDATE SET stock_actual = inventario_stock.stock_actual + $3`,
        [m.insumo_id, m.sucursal_id, cantidad]
      );
      return { id: null, saldo_despues: null };
    }
  }

  // Deja el stock en un valor exacto (conteos, ajustes): registra la diferencia como movimiento.
  async function fijar(db, m) {
    const { rows } = await db.query('SELECT stock_actual FROM inventario_stock WHERE insumo_id = $1 AND sucursal_id = $2', [m.insumo_id, m.sucursal_id]);
    const actual = rows.length ? num(rows[0].stock_actual) : 0;
    const delta = r3(num(m.nuevo) - actual);
    if (delta === 0) return { delta: 0, anterior: actual, saldo_despues: actual, id: null };
    const r = await mover(db, { ...m, cantidad: delta });
    return { ...r, delta, anterior: actual };
  }

  // Costo promedio ponderado: mezcla lo que ya hay (en todas las sucursales) con lo que entra.
  async function costoPromedioNuevo(db, insumoId, cantidadEntrada, costoEntrada) {
    const { rows } = await db.query(
      `SELECT i.costo_unitario,
              COALESCE((SELECT SUM(GREATEST(stock_actual, 0)) FROM inventario_stock WHERE insumo_id = i.id), 0) AS stock_total
       FROM insumos i WHERE i.id = $1`,
      [insumoId]
    );
    if (!rows.length) return r4(costoEntrada);
    const costoActual = num(rows[0].costo_unitario);
    const stock = num(rows[0].stock_total);
    if (stock <= 0 || costoActual <= 0) return r4(costoEntrada);
    return r4((stock * costoActual + cantidadEntrada * costoEntrada) / (stock + cantidadEntrada));
  }

  const esEncargado = (req) => req.empleado?.puesto === 'encargado';
  const quitarCostos = (req, obj, campos) => {
    if (esEncargado(req)) return obj;
    const copia = { ...obj };
    campos.forEach((c) => delete copia[c]);
    return copia;
  };

  // Consumo promedio diario (ventas + producción) de los últimos 14 días, por insumo, de una sucursal
  async function consumoDiario(sucursalId) {
    const { rows } = await pool.query(
      `WITH dias AS (
         SELECT GREATEST(1, LEAST(14, CEIL(EXTRACT(EPOCH FROM (now() - MIN(creado_en))) / 86400)))::numeric AS d
         FROM movimientos_inventario WHERE sucursal_id = $1 AND tipo = 'venta'
       )
       SELECT m.insumo_id, -SUM(m.cantidad) / (SELECT d FROM dias) AS diario
       FROM movimientos_inventario m
       WHERE m.sucursal_id = $1 AND m.tipo IN ('venta', 'devolucion_venta', 'produccion_consumo')
         AND m.creado_en >= now() - interval '14 days'
       GROUP BY m.insumo_id`,
      [sucursalId]
    );
    const mapa = {};
    rows.forEach((r) => (mapa[r.insumo_id] = Math.max(0, num(r.diario))));
    return mapa;
  }

  function calcularEstado(i) {
    const stock = num(i.stock_actual);
    const minimo = num(i.stock_minimo);
    const consumo = num(i.consumo_diario);
    if (stock <= 0 && (minimo > 0 || consumo > 0)) return 'agotado';
    if (minimo > 0 && stock <= minimo) return 'bajo';
    return 'ok';
  }

  // Lista de insumos de una sucursal con stock, mínimos, consumo y estado
  async function listarInsumos(sucursalId) {
    const [{ rows }, consumo] = await Promise.all([
      pool.query(
        `SELECT i.id, i.nombre, i.unidad, i.categoria, i.proveedor_id, p.nombre AS proveedor_nombre,
                i.unidad_compra, i.factor_conversion, i.critico, i.costo_unitario,
                COALESCE(s.stock_actual, 0) AS stock_actual, COALESCE(s.stock_minimo, 0) AS stock_minimo, s.stock_maximo
         FROM insumos i
         LEFT JOIN inventario_stock s ON s.insumo_id = i.id AND s.sucursal_id = $1
         LEFT JOIN proveedores p ON p.id = i.proveedor_id
         ORDER BY i.nombre`,
        [sucursalId]
      ),
      consumoDiario(sucursalId),
    ]);
    return rows.map((i) => {
      const stock = num(i.stock_actual);
      const diario = consumo[i.id] || 0;
      const item = {
        id: i.id, nombre: i.nombre, unidad: i.unidad, categoria: i.categoria || '',
        proveedor_id: i.proveedor_id, proveedor_nombre: i.proveedor_nombre || '',
        unidad_compra: i.unidad_compra || '', factor_conversion: num(i.factor_conversion, 1), critico: i.critico,
        costo_unitario: num(i.costo_unitario), stock_actual: r3(stock), stock_minimo: num(i.stock_minimo),
        stock_maximo: i.stock_maximo === null ? null : num(i.stock_maximo),
        consumo_diario: r3(diario),
        cobertura_dias: diario > 0 && stock > 0 ? Math.round((stock / diario) * 10) / 10 : null,
        valor: r2(Math.max(0, stock) * num(i.costo_unitario)),
      };
      item.estado = calcularEstado(item);
      return item;
    });
  }

  function registrarRutas(app, { requierePuesto, fechaNegocioSQL, fechaNegocioActualJS }) {
    const ruta = (fn) => async (req, res) => {
      try {
        await fn(req, res);
      } catch (err) {
        console.error('[inventario]', req.method, req.path, err);
        if (!res.headersSent) res.status(500).json({ error: 'No se pudo completar la operación de inventario' });
      }
    };
    const soloCajero = requierePuesto('cajero'); // cajero y encargado
    const soloEncargado = requierePuesto(); // solo encargado
    const err400 = (res, mensaje) => res.status(400).json({ error: mensaje });
    const sucursalDe = (req) => Number(req.query.sucursal_id || req.body?.sucursal_id) || null;

    // ====================== INSUMOS (catálogo + stock) ======================
    app.get('/api/inventario/insumos', soloCajero, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const insumos = await listarInsumos(sucursalId);
      res.json(esEncargado(req) ? insumos : insumos.map((i) => quitarCostos(req, i, ['costo_unitario', 'valor'])));
    }));

    app.post('/api/inventario/insumos', soloEncargado, ruta(async (req, res) => {
      const b = req.body;
      const nombre = texto(b.nombre, 80);
      const unidad = texto(b.unidad, 20);
      if (!nombre || !unidad) return err400(res, 'Falta el nombre o la unidad');
      const factor = b.factor_conversion === undefined || b.factor_conversion === '' ? 1 : num(b.factor_conversion);
      if (factor <= 0) return err400(res, 'El factor de conversión debe ser mayor a cero');
      try {
        const { rows } = await pool.query(
          `INSERT INTO insumos (nombre, unidad, costo_unitario, categoria, proveedor_id, unidad_compra, factor_conversion, critico)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [nombre, unidad, Math.max(0, num(b.costo_unitario)), texto(b.categoria, 40) || null, b.proveedor_id || null,
           texto(b.unidad_compra, 30) || null, factor, !!b.critico]
        );
        if (b.sucursal_id && (b.stock_minimo || b.stock_maximo)) {
          await pool.query(
            `INSERT INTO inventario_stock (insumo_id, sucursal_id, stock_actual, stock_minimo, stock_maximo) VALUES ($1,$2,0,$3,$4)
             ON CONFLICT (insumo_id, sucursal_id) DO UPDATE SET stock_minimo = $3, stock_maximo = $4`,
            [rows[0].id, b.sucursal_id, Math.max(0, num(b.stock_minimo)), b.stock_maximo ? num(b.stock_maximo) : null]
          );
        }
        res.json(rows[0]);
      } catch (e) {
        if (e.code === '23505') return err400(res, 'Ya existe un insumo con ese nombre');
        throw e;
      }
    }));

    app.patch('/api/inventario/insumos/:id', soloEncargado, ruta(async (req, res) => {
      const b = req.body;
      const tiene = (k) => Object.prototype.hasOwnProperty.call(b, k);
      const { rows: actual } = await pool.query('SELECT * FROM insumos WHERE id = $1', [req.params.id]);
      if (!actual.length) return res.status(404).json({ error: 'Insumo no encontrado' });
      const a = actual[0];

      const factor = tiene('factor_conversion') ? num(b.factor_conversion) : num(a.factor_conversion, 1);
      if (factor <= 0) return err400(res, 'El factor de conversión debe ser mayor a cero');
      const nombre = tiene('nombre') ? texto(b.nombre, 80) : a.nombre;
      const unidad = tiene('unidad') ? texto(b.unidad, 20) : a.unidad;
      if (!nombre || !unidad) return err400(res, 'El nombre y la unidad no pueden quedar vacíos');

      try {
        const { rows } = await pool.query(
          `UPDATE insumos SET nombre=$1, unidad=$2, costo_unitario=$3, categoria=$4, proveedor_id=$5,
                  unidad_compra=$6, factor_conversion=$7, critico=$8 WHERE id=$9 RETURNING *`,
          [nombre, unidad,
           tiene('costo_unitario') ? Math.max(0, num(b.costo_unitario)) : a.costo_unitario,
           tiene('categoria') ? texto(b.categoria, 40) || null : a.categoria,
           tiene('proveedor_id') ? b.proveedor_id || null : a.proveedor_id,
           tiene('unidad_compra') ? texto(b.unidad_compra, 30) || null : a.unidad_compra,
           factor, tiene('critico') ? !!b.critico : a.critico, req.params.id]
        );
        // Mínimo y máximo son por sucursal
        if (b.sucursal_id && (tiene('stock_minimo') || tiene('stock_maximo'))) {
          await pool.query(
            `INSERT INTO inventario_stock (insumo_id, sucursal_id, stock_actual, stock_minimo, stock_maximo) VALUES ($1,$2,0,$3,$4)
             ON CONFLICT (insumo_id, sucursal_id) DO UPDATE SET
               stock_minimo = CASE WHEN $5 THEN $3 ELSE inventario_stock.stock_minimo END,
               stock_maximo = CASE WHEN $6 THEN $4 ELSE inventario_stock.stock_maximo END`,
            [req.params.id, b.sucursal_id, Math.max(0, num(b.stock_minimo)), b.stock_maximo ? num(b.stock_maximo) : null, tiene('stock_minimo'), tiene('stock_maximo')]
          );
        }
        res.json(rows[0]);
      } catch (e) {
        if (e.code === '23505') return err400(res, 'Ya existe otro insumo con ese nombre');
        throw e;
      }
    }));

    // ====================== MOVIMIENTOS (kardex) ======================
    // Registrar: merma (cajero y encargado), entrada manual y ajuste (solo encargado)
    app.post('/api/inventario/movimientos', soloCajero, ruta(async (req, res) => {
      const b = req.body;
      const sucursalId = sucursalDe(req);
      if (!sucursalId || !b.insumo_id) return err400(res, 'Falta la sucursal o el insumo');
      const tipo = b.tipo;
      if (!['merma', 'entrada_manual', 'ajuste_manual'].includes(tipo)) return err400(res, 'Tipo de movimiento no válido');
      if (tipo !== 'merma' && !esEncargado(req)) return res.status(403).json({ error: 'Solo el encargado puede registrar entradas manuales o ajustes' });

      const { rows: ins } = await pool.query('SELECT id, nombre, unidad FROM insumos WHERE id = $1', [b.insumo_id]);
      if (!ins.length) return res.status(404).json({ error: 'Insumo no encontrado' });
      const empleado = { id: req.empleado?.id, nombre: req.empleado?.nombre };
      const nota = texto(b.nota, 200) || null;

      if (tipo === 'merma') {
        const cantidad = num(b.cantidad);
        if (cantidad <= 0) return err400(res, 'La cantidad debe ser mayor a cero');
        if (!MOTIVOS_MERMA.includes(b.motivo)) return err400(res, 'Elige el motivo de la merma');
        const r = await mover(pool, { insumo_id: ins[0].id, sucursal_id: sucursalId, cantidad: -cantidad, tipo, motivo: b.motivo, nota, empleado });
        return res.json({ ok: true, movimiento_id: r.id, saldo_despues: r.saldo_despues === null ? null : num(r.saldo_despues), insumo: ins[0].nombre, unidad: ins[0].unidad });
      }
      const motivo = texto(b.motivo, 120);
      if (motivo.length < 3) return err400(res, 'Escribe el motivo (ej. donación, corrección de captura)');
      if (tipo === 'entrada_manual') {
        const cantidad = num(b.cantidad);
        if (cantidad <= 0) return err400(res, 'La cantidad debe ser mayor a cero');
        const r = await mover(pool, { insumo_id: ins[0].id, sucursal_id: sucursalId, cantidad, tipo, motivo, nota, empleado });
        return res.json({ ok: true, movimiento_id: r.id, saldo_despues: r.saldo_despues === null ? null : num(r.saldo_despues), insumo: ins[0].nombre, unidad: ins[0].unidad });
      }
      // ajuste_manual: dejar el stock en un valor exacto
      if (b.nuevo_stock === undefined || b.nuevo_stock === '' || num(b.nuevo_stock, -1) < 0) return err400(res, 'Escribe el stock real (cero o más)');
      const r = await fijar(pool, { insumo_id: ins[0].id, sucursal_id: sucursalId, nuevo: num(b.nuevo_stock), tipo, motivo, nota, empleado });
      res.json({ ok: true, movimiento_id: r.id, anterior: r.anterior, saldo_despues: r.saldo_despues === null ? null : num(r.saldo_despues), diferencia: r.delta, insumo: ins[0].nombre, unidad: ins[0].unidad });
    }));

    app.get('/api/inventario/movimientos', soloCajero, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const cond = ['m.sucursal_id = $1'];
      const params = [sucursalId];
      const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
      if (req.query.insumo_id) add('m.insumo_id = ?', Number(req.query.insumo_id));
      if (req.query.tipo) {
        const tipos = String(req.query.tipo).split(',').map((t) => t.trim()).filter(Boolean);
        add('m.tipo = ANY(?)', tipos);
      }
      if (req.query.fecha_desde) add(`${fechaNegocioSQL('m.creado_en')} >= ?`, req.query.fecha_desde);
      if (req.query.fecha_hasta) add(`${fechaNegocioSQL('m.creado_en')} <= ?`, req.query.fecha_hasta);
      const limite = Math.min(1000, Math.max(1, parseInt(req.query.limite, 10) || 200));
      const { rows } = await pool.query(
        `SELECT m.id, m.insumo_id, i.nombre AS insumo_nombre, i.unidad, m.tipo, m.cantidad, m.saldo_despues, m.costo_unitario,
                m.motivo, m.nota, m.referencia_tipo, m.referencia_id, m.empleado_nombre, m.creado_en
         FROM movimientos_inventario m JOIN insumos i ON i.id = m.insumo_id
         WHERE ${cond.join(' AND ')} ORDER BY m.creado_en DESC, m.id DESC LIMIT ${limite}`,
        params
      );
      const lista = rows.map((m) => ({
        ...m, cantidad: num(m.cantidad), saldo_despues: m.saldo_despues === null ? null : num(m.saldo_despues),
        costo_unitario: m.costo_unitario === null ? null : num(m.costo_unitario),
        valor: m.costo_unitario === null ? null : r2(num(m.cantidad) * num(m.costo_unitario)),
      }));
      res.json(esEncargado(req) ? lista : lista.map((m) => quitarCostos(req, m, ['costo_unitario', 'valor'])));
    }));

    const hoyISO = () => fechaNegocioActualJS();
    const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || '') && !Number.isNaN(new Date(`${f}T00:00:00Z`).getTime());
    const sumarDias = (f, n) => {
      const d = new Date(`${f}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const empleadoDe = (req) => ({ id: req.empleado?.id, nombre: req.empleado?.nombre });
    const bloqueadoPorSucursal = (req, sucursalId) => req.empleado?.sucursal_id && Number(req.empleado.sucursal_id) !== Number(sucursalId);

    // ====================== COMPRAS (con factor de conversión) ======================
    // Se captura en la UNIDAD DE COMPRA (ej. 2 cajas a $480); el sistema convierte a la unidad base
    // (ej. 24 kg a $40/kg), actualiza el costo promedio ponderado y deja el movimiento en el historial.
    app.post('/api/inventario/compras', soloEncargado, ruta(async (req, res) => {
      const b = req.body;
      const sucursalId = sucursalDe(req);
      const items = Array.isArray(b.items) ? b.items : [];
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      if (!items.length) return err400(res, 'Agrega al menos un insumo a la compra');
      const fecha = fechaValida(b.fecha) ? b.fecha : hoyISO();

      let proveedorId = null;
      let proveedorNombre = texto(b.proveedor_nombre, 80) || null;
      if (b.proveedor_id) {
        const { rows } = await pool.query('SELECT id, nombre FROM proveedores WHERE id = $1', [b.proveedor_id]);
        if (!rows.length) return err400(res, 'Proveedor no encontrado');
        proveedorId = rows[0].id;
        proveedorNombre = rows[0].nombre;
      }

      const { rows: insumos } = await pool.query(
        'SELECT id, nombre, unidad, unidad_compra, factor_conversion, costo_unitario FROM insumos WHERE id = ANY($1)',
        [items.map((it) => Number(it.insumo_id))]
      );
      const porId = new Map(insumos.map((i) => [i.id, i]));
      for (const it of items) {
        const ins = porId.get(Number(it.insumo_id));
        if (!ins) return err400(res, 'Un insumo de la compra ya no existe');
        if (!(num(it.cantidad_compra) > 0)) return err400(res, `Cantidad inválida en «${ins.nombre}»`);
        if (it.precio_compra === undefined || it.precio_compra === '' || num(it.precio_compra, -1) < 0) return err400(res, `Falta el precio de «${ins.nombre}»`);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const total = r2(items.reduce((acc, it) => acc + num(it.cantidad_compra) * num(it.precio_compra), 0));
        const { rows: cr } = await client.query(
          `INSERT INTO compras (sucursal_id, proveedor, proveedor_id, fecha, total, folio, empleado_nombre)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [sucursalId, proveedorNombre, proveedorId, fecha, total, texto(b.folio, 40) || null, req.empleado?.nombre || null]
        );
        const compra = cr[0];
        const alertasPrecio = [];

        for (const it of items) {
          const ins = porId.get(Number(it.insumo_id));
          const factor = num(ins.factor_conversion, 1);
          const cantidadCompra = num(it.cantidad_compra);
          const precioCompra = num(it.precio_compra);
          const cantidadBase = r3(cantidadCompra * factor);
          const costoBase = r4(precioCompra / factor);
          const anterior = num(ins.costo_unitario);
          const nuevoCosto = await costoPromedioNuevo(client, ins.id, cantidadBase, costoBase);

          if (anterior > 0 && costoBase > anterior * 1.1) {
            alertasPrecio.push({ insumo_id: ins.id, nombre: ins.nombre, unidad: ins.unidad, anterior, nuevo: costoBase, pct: Math.round(((costoBase - anterior) / anterior) * 100) });
          }
          await client.query(
            `INSERT INTO compra_items (compra_id, insumo_id, descripcion_ticket, cantidad, costo_unitario, subtotal, cantidad_compra, unidad_compra, factor, precio_compra)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [compra.id, ins.id, null, cantidadBase, costoBase, r2(cantidadCompra * precioCompra), cantidadCompra, ins.unidad_compra || ins.unidad, factor, precioCompra]
          );
          await client.query('UPDATE insumos SET costo_unitario = $1 WHERE id = $2', [nuevoCosto, ins.id]);
          await mover(client, {
            insumo_id: ins.id, sucursal_id: sucursalId, cantidad: cantidadBase, tipo: 'entrada_compra',
            referencia_tipo: 'compra', referencia_id: compra.id, costo_unitario: costoBase,
            nota: proveedorNombre ? `Compra a ${proveedorNombre}` : null, empleado: empleadoDe(req),
          });
        }
        await client.query('COMMIT');
        res.json({ compra, alertas_precio: alertasPrecio });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }));

    app.get('/api/inventario/compras', soloEncargado, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const hasta = fechaValida(req.query.fecha_hasta) ? req.query.fecha_hasta : hoyISO();
      const desde = fechaValida(req.query.fecha_desde) ? req.query.fecha_desde : sumarDias(hasta, -29);
      const params = [sucursalId, desde, hasta];
      let filtroProv = '';
      if (req.query.proveedor_id) {
        params.push(Number(req.query.proveedor_id));
        filtroProv = ` AND c.proveedor_id = $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT c.id, c.sucursal_id, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.total, c.folio, c.anulada, c.empleado_nombre, c.creado_en,
                c.proveedor_id, COALESCE(p.nombre, c.proveedor) AS proveedor_nombre,
                COALESCE((SELECT json_agg(json_build_object(
                    'insumo_id', ci.insumo_id, 'insumo_nombre', i.nombre, 'unidad', i.unidad, 'cantidad', ci.cantidad,
                    'cantidad_compra', ci.cantidad_compra, 'unidad_compra', ci.unidad_compra,
                    'precio_compra', ci.precio_compra, 'costo_unitario', ci.costo_unitario, 'subtotal', ci.subtotal) ORDER BY ci.id)
                  FROM compra_items ci JOIN insumos i ON i.id = ci.insumo_id WHERE ci.compra_id = c.id), '[]'::json) AS items
         FROM compras c LEFT JOIN proveedores p ON p.id = c.proveedor_id
         WHERE c.sucursal_id = $1 AND c.fecha BETWEEN $2 AND $3${filtroProv}
         ORDER BY c.fecha DESC, c.id DESC LIMIT 300`,
        params
      );
      const vigentes = rows.filter((c) => !c.anulada);
      res.json({
        desde, hasta,
        total: r2(vigentes.reduce((acc, c) => acc + num(c.total), 0)),
        compras: rows.map((c) => ({ ...c, total: num(c.total) })),
      });
    }));

    app.post('/api/inventario/compras/:id/anular', soloEncargado, ruta(async (req, res) => {
      const { rows } = await pool.query('SELECT * FROM compras WHERE id = $1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Compra no encontrada' });
      const compra = rows[0];
      if (bloqueadoPorSucursal(req, compra.sucursal_id)) return res.status(403).json({ error: 'Esa compra es de otra sucursal' });
      if (compra.anulada) return err400(res, 'Esa compra ya estaba anulada');
      const motivo = texto(req.body?.motivo, 120) || 'Compra anulada';
      const { rows: items } = await pool.query('SELECT insumo_id, cantidad FROM compra_items WHERE compra_id = $1', [compra.id]);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const it of items) {
          await mover(client, {
            insumo_id: it.insumo_id, sucursal_id: compra.sucursal_id, cantidad: -num(it.cantidad), tipo: 'anulacion_compra',
            motivo, referencia_tipo: 'compra', referencia_id: compra.id, empleado: empleadoDe(req),
          });
        }
        await client.query('UPDATE compras SET anulada = true WHERE id = $1', [compra.id]);
        await client.query('COMMIT');
        res.json({ ok: true, insumos_revertidos: items.length });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }));

    // ====================== TRASPASOS ENTRE SUCURSALES ======================
    app.post('/api/inventario/traspasos', soloEncargado, ruta(async (req, res) => {
      if (req.empleado?.sucursal_id) return res.status(403).json({ error: 'Tu acceso está limitado a una sola sucursal' });
      const origen = Number(req.body.origen_id);
      const destino = Number(req.body.destino_id);
      if (!origen || !destino) return err400(res, 'Elige la sucursal de origen y la de destino');
      if (origen === destino) return err400(res, 'El origen y el destino deben ser distintos');

      // Junta renglones repetidos del mismo insumo
      const pedido = new Map();
      for (const it of Array.isArray(req.body.items) ? req.body.items : []) {
        const cant = num(it.cantidad);
        if (!it.insumo_id || !(cant > 0)) return err400(res, 'Cada renglón necesita insumo y una cantidad mayor a cero');
        pedido.set(Number(it.insumo_id), r3((pedido.get(Number(it.insumo_id)) || 0) + cant));
      }
      if (!pedido.size) return err400(res, 'Agrega al menos un insumo al traspaso');

      const { rows: suc } = await pool.query('SELECT id, nombre FROM sucursales WHERE id = ANY($1)', [[origen, destino]]);
      const nombreSuc = Object.fromEntries(suc.map((x) => [x.id, x.nombre]));
      if (!nombreSuc[origen] || !nombreSuc[destino]) return err400(res, 'Sucursal no encontrada');

      const { rows: stocks } = await pool.query(
        `SELECT i.id, i.nombre, i.unidad, i.costo_unitario, COALESCE(s.stock_actual, 0) AS stock
         FROM insumos i LEFT JOIN inventario_stock s ON s.insumo_id = i.id AND s.sucursal_id = $1 WHERE i.id = ANY($2)`,
        [origen, [...pedido.keys()]]
      );
      if (stocks.length !== pedido.size) return err400(res, 'Un insumo del traspaso ya no existe');
      for (const st of stocks) {
        if (num(st.stock) < pedido.get(st.id)) {
          return err400(res, `No hay suficiente «${st.nombre}» en ${nombreSuc[origen]} (hay ${r3(num(st.stock))} ${st.unidad} y quieres mandar ${pedido.get(st.id)})`);
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'INSERT INTO traspasos (origen_id, destino_id, nota, empleado_nombre) VALUES ($1,$2,$3,$4) RETURNING *',
          [origen, destino, texto(req.body.nota, 200) || null, req.empleado?.nombre || null]
        );
        for (const st of stocks) {
          const cant = pedido.get(st.id);
          await mover(client, { insumo_id: st.id, sucursal_id: origen, cantidad: -cant, tipo: 'traspaso_salida', referencia_tipo: 'traspaso', referencia_id: rows[0].id, costo_unitario: num(st.costo_unitario), nota: `Enviado a ${nombreSuc[destino]}`, empleado: empleadoDe(req) });
          await mover(client, { insumo_id: st.id, sucursal_id: destino, cantidad: cant, tipo: 'traspaso_entrada', referencia_tipo: 'traspaso', referencia_id: rows[0].id, costo_unitario: num(st.costo_unitario), nota: `Recibido de ${nombreSuc[origen]}`, empleado: empleadoDe(req) });
        }
        await client.query('COMMIT');
        res.json({ ok: true, traspaso_id: rows[0].id, insumos: stocks.length });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }));

    // ====================== REPORTE DE MERMAS ======================
    app.get('/api/inventario/mermas/reporte', soloEncargado, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const hasta = fechaValida(req.query.fecha_hasta) ? req.query.fecha_hasta : hoyISO();
      const desde = fechaValida(req.query.fecha_desde) ? req.query.fecha_desde : sumarDias(hasta, -29);
      const p = [sucursalId, desde, hasta];
      const rango = `m.sucursal_id = $1 AND ${fechaNegocioSQL('m.creado_en')} BETWEEN $2 AND $3`;

      const [porMotivo, porInsumo, porDia, consumo] = await Promise.all([
        pool.query(`SELECT COALESCE(m.motivo, 'otro') AS motivo, COUNT(*)::int AS n, COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)), 0) AS costo
                    FROM movimientos_inventario m WHERE m.tipo = 'merma' AND ${rango} GROUP BY 1 ORDER BY costo DESC`, p),
        pool.query(`SELECT m.insumo_id, i.nombre, i.unidad, COUNT(*)::int AS n, SUM(-m.cantidad) AS cantidad,
                           COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)), 0) AS costo
                    FROM movimientos_inventario m JOIN insumos i ON i.id = m.insumo_id
                    WHERE m.tipo = 'merma' AND ${rango} GROUP BY m.insumo_id, i.nombre, i.unidad ORDER BY costo DESC LIMIT 15`, p),
        pool.query(`SELECT to_char(${fechaNegocioSQL('m.creado_en')}, 'YYYY-MM-DD') AS dia, COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)), 0) AS costo
                    FROM movimientos_inventario m WHERE m.tipo = 'merma' AND ${rango} GROUP BY 1 ORDER BY 1`, p),
        pool.query(`SELECT COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)), 0) AS costo
                    FROM movimientos_inventario m WHERE m.tipo IN ('venta', 'devolucion_venta', 'produccion_consumo') AND ${rango}`, p),
      ]);
      const totalMerma = r2(porMotivo.rows.reduce((acc, r) => acc + num(r.costo), 0));
      const costoConsumo = r2(num(consumo.rows[0].costo));
      res.json({
        desde, hasta,
        total_costo: totalMerma,
        total_movimientos: porMotivo.rows.reduce((acc, r) => acc + r.n, 0),
        pct_sobre_consumo: totalMerma + costoConsumo > 0 ? r2((totalMerma / (totalMerma + costoConsumo)) * 100) : 0,
        por_motivo: porMotivo.rows.map((r) => ({ motivo: r.motivo, n: r.n, costo: r2(num(r.costo)) })),
        por_insumo: porInsumo.rows.map((r) => ({ insumo_id: r.insumo_id, nombre: r.nombre, unidad: r.unidad, n: r.n, cantidad: r3(num(r.cantidad)), costo: r2(num(r.costo)) })),
        por_dia: porDia.rows.map((r) => ({ dia: r.dia, costo: r2(num(r.costo)) })),
      });
    }));

    // ====================== PROVEEDORES ======================
    app.get('/api/inventario/proveedores', soloEncargado, ruta(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT p.id, p.nombre, p.contacto, p.telefono, p.dias_entrega, p.notas, p.activo,
                (SELECT COUNT(*)::int FROM insumos i WHERE i.proveedor_id = p.id) AS n_insumos,
                COALESCE((SELECT SUM(c.total) FROM compras c WHERE c.proveedor_id = p.id AND NOT c.anulada AND c.fecha >= CURRENT_DATE - 90), 0) AS comprado_90d,
                (SELECT to_char(MAX(c.fecha), 'YYYY-MM-DD') FROM compras c WHERE c.proveedor_id = p.id AND NOT c.anulada) AS ultima_compra
         FROM proveedores p ORDER BY p.activo DESC, p.nombre`
      );
      res.json(rows.map((r) => ({ ...r, comprado_90d: r2(num(r.comprado_90d)) })));
    }));

    const datosProveedor = (b) => ({
      nombre: texto(b.nombre, 80), contacto: texto(b.contacto, 80) || null, telefono: texto(b.telefono, 30) || null,
      dias_entrega: texto(b.dias_entrega, 80) || null, notas: texto(b.notas, 300) || null,
    });

    app.post('/api/inventario/proveedores', soloEncargado, ruta(async (req, res) => {
      const d = datosProveedor(req.body);
      if (!d.nombre) return err400(res, 'Falta el nombre del proveedor');
      try {
        const { rows } = await pool.query(
          'INSERT INTO proveedores (nombre, contacto, telefono, dias_entrega, notas) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [d.nombre, d.contacto, d.telefono, d.dias_entrega, d.notas]
        );
        res.json(rows[0]);
      } catch (e) {
        if (e.code === '23505') return err400(res, 'Ya existe un proveedor con ese nombre');
        throw e;
      }
    }));

    app.patch('/api/inventario/proveedores/:id', soloEncargado, ruta(async (req, res) => {
      const b = req.body;
      const tiene = (k) => Object.prototype.hasOwnProperty.call(b, k);
      const { rows: act } = await pool.query('SELECT * FROM proveedores WHERE id = $1', [req.params.id]);
      if (!act.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
      const a = act[0];
      const d = datosProveedor({ ...a, ...b });
      if (!d.nombre) return err400(res, 'El nombre no puede quedar vacío');
      try {
        const { rows } = await pool.query(
          `UPDATE proveedores SET nombre=$1, contacto=$2, telefono=$3, dias_entrega=$4, notas=$5, activo=$6 WHERE id=$7 RETURNING *`,
          [d.nombre, d.contacto, d.telefono, d.dias_entrega, d.notas, tiene('activo') ? !!b.activo : a.activo, req.params.id]
        );
        res.json(rows[0]);
      } catch (e) {
        if (e.code === '23505') return err400(res, 'Ya existe otro proveedor con ese nombre');
        throw e;
      }
    }));

    app.delete('/api/inventario/proveedores/:id', soloEncargado, ruta(async (req, res) => {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM compras WHERE proveedor_id = $1', [req.params.id]);
      if (rows[0].n > 0) return err400(res, 'Ese proveedor ya tiene compras registradas: mejor desactívalo para conservar el historial');
      await pool.query('DELETE FROM proveedores WHERE id = $1', [req.params.id]); // sus insumos quedan sin proveedor
      res.json({ ok: true });
    }));

    // Último precio pagado a este proveedor por cada insumo, y cuánto cambió contra la compra anterior
    app.get('/api/inventario/proveedores/:id/precios', soloEncargado, ruta(async (req, res) => {
      const { rows } = await pool.query(
        `WITH h AS (
           SELECT ci.insumo_id, ci.precio_compra, ci.unidad_compra, ci.costo_unitario, c.fecha,
                  LAG(ci.costo_unitario) OVER (PARTITION BY ci.insumo_id ORDER BY c.fecha, c.id) AS costo_anterior,
                  ROW_NUMBER() OVER (PARTITION BY ci.insumo_id ORDER BY c.fecha DESC, c.id DESC) AS rn
           FROM compra_items ci JOIN compras c ON c.id = ci.compra_id
           WHERE c.proveedor_id = $1 AND NOT c.anulada
         )
         SELECT h.insumo_id, i.nombre, i.unidad, h.unidad_compra, h.precio_compra, h.costo_unitario, h.costo_anterior,
                to_char(h.fecha, 'YYYY-MM-DD') AS fecha
         FROM h JOIN insumos i ON i.id = h.insumo_id WHERE h.rn = 1 ORDER BY i.nombre`,
        [req.params.id]
      );
      res.json(rows.map((r) => ({
        ...r,
        precio_compra: r.precio_compra === null ? null : num(r.precio_compra),
        costo_unitario: num(r.costo_unitario),
        cambio_pct: r.costo_anterior && num(r.costo_anterior) > 0 ? Math.round(((num(r.costo_unitario) - num(r.costo_anterior)) / num(r.costo_anterior)) * 1000) / 10 : null,
      })));
    }));

    // Qué conviene pedir, agrupado por proveedor, con el mensaje listo para mandar por WhatsApp
    app.get('/api/inventario/pedido-sugerido', soloEncargado, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const [insumos, { rows: suc }, { rows: provs }] = await Promise.all([
        listarInsumos(sucursalId),
        pool.query('SELECT nombre FROM sucursales WHERE id = $1', [sucursalId]),
        pool.query('SELECT id, nombre, telefono, contacto FROM proveedores WHERE activo'),
      ]);
      const provPorId = new Map(provs.map((p) => [p.id, p]));
      const grupos = new Map();

      for (const i of insumos) {
        if (i.estado === 'ok') continue;
        // Meta: el máximo si lo definiste; si no, el doble del mínimo; si tampoco, 3 días de consumo
        const objetivo = i.stock_maximo || (i.stock_minimo > 0 ? i.stock_minimo * 2 : i.consumo_diario * 3);
        const faltante = objetivo - Math.max(0, i.stock_actual);
        if (!(faltante > 0)) continue;
        const factor = i.factor_conversion > 0 ? i.factor_conversion : 1;
        const cantidadCompra = Math.ceil(faltante / factor - 1e-9);
        const llave = i.proveedor_id && provPorId.has(i.proveedor_id) ? i.proveedor_id : 0;
        if (!grupos.has(llave)) grupos.set(llave, []);
        grupos.get(llave).push({
          insumo_id: i.id, nombre: i.nombre, estado: i.estado, stock_actual: i.stock_actual, unidad: i.unidad,
          unidad_compra: i.unidad_compra || i.unidad, cantidad_compra: cantidadCompra, cantidad_base: r3(cantidadCompra * factor),
        });
      }

      const sucNombre = suc[0]?.nombre || '';
      const lista = [...grupos.entries()].map(([pid, items]) => {
        const prov = pid ? provPorId.get(pid) : null;
        const lineas = items.map((it) => {
          const base = it.unidad_compra !== it.unidad ? ` (${it.cantidad_base} ${it.unidad})` : '';
          return `- ${it.cantidad_compra} ${it.unidad_compra}${base} de ${it.nombre}`;
        });
        return {
          proveedor_id: pid || null,
          proveedor_nombre: prov ? prov.nombre : 'Sin proveedor asignado',
          telefono: prov?.telefono || null,
          items,
          mensaje: prov ? `Hola${prov.contacto ? ' ' + prov.contacto : ''}, buen día. Pedido para Tacos El Nano (${sucNombre}):\n${lineas.join('\n')}\nGracias.` : null,
        };
      });
      lista.sort((a, b) => (a.proveedor_id ? 0 : 1) - (b.proveedor_id ? 0 : 1) || a.proveedor_nombre.localeCompare(b.proveedor_nombre));
      res.json(lista);
    }));

    // ====================== PRODUCCIÓN DIARIA ======================
    // Un "insumo elaborado" (ej. carne adobada) se produce a partir de otros insumos. Producir descuenta
    // los ingredientes, suma lo producido y recalcula su costo con lo que realmente costó el lote.
    async function cargarRecetasProduccion(soloActivas) {
      const [{ rows: rs }, { rows: its }] = await Promise.all([
        pool.query(
          `SELECT r.id, r.nombre, r.insumo_id, r.rendimiento, r.activo, i.nombre AS insumo_nombre, i.unidad
           FROM recetas_produccion r JOIN insumos i ON i.id = r.insumo_id ${soloActivas ? 'WHERE r.activo' : ''} ORDER BY r.nombre`
        ),
        pool.query(
          `SELECT ri.receta_id, ri.insumo_id, ri.cantidad, i.nombre, i.unidad, i.costo_unitario
           FROM receta_produccion_items ri JOIN insumos i ON i.id = ri.insumo_id ORDER BY ri.id`
        ),
      ]);
      return rs.map((r) => {
        const ingredientes = its.filter((x) => x.receta_id === r.id).map((x) => ({
          insumo_id: x.insumo_id, nombre: x.nombre, unidad: x.unidad, cantidad: num(x.cantidad), costo_unitario: num(x.costo_unitario),
        }));
        const costoLote = r2(ingredientes.reduce((acc, x) => acc + x.cantidad * x.costo_unitario, 0));
        return {
          id: r.id, nombre: r.nombre, insumo_id: r.insumo_id, insumo_nombre: r.insumo_nombre, unidad: r.unidad,
          rendimiento: num(r.rendimiento), activo: r.activo, ingredientes, costo_lote: costoLote,
          costo_unitario: num(r.rendimiento) > 0 ? r4(costoLote / num(r.rendimiento)) : 0,
        };
      });
    }
    const sinCostosReceta = (r) => ({
      ...r, costo_lote: undefined, costo_unitario: undefined,
      ingredientes: r.ingredientes.map((x) => ({ ...x, costo_unitario: undefined })),
    });

    app.get('/api/inventario/produccion/recetas', soloCajero, ruta(async (req, res) => {
      const recetas = await cargarRecetasProduccion(req.query.todas !== '1' && !esEncargado(req));
      res.json(esEncargado(req) ? recetas : recetas.map(sinCostosReceta));
    }));

    async function guardarRecetaProduccion(req, res, id) {
      const b = req.body;
      const nombre = texto(b.nombre, 80);
      const rendimiento = num(b.rendimiento);
      if (!nombre) return err400(res, 'Falta el nombre de la receta');
      if (!(rendimiento > 0)) return err400(res, 'El rendimiento por lote debe ser mayor a cero');

      // Ingredientes: se juntan los repetidos y se valida cada uno
      const ing = new Map();
      for (const x of Array.isArray(b.ingredientes) ? b.ingredientes : []) {
        const cant = num(x.cantidad);
        if (!x.insumo_id || !(cant > 0)) return err400(res, 'Cada ingrediente necesita insumo y una cantidad mayor a cero');
        ing.set(Number(x.insumo_id), r3((ing.get(Number(x.insumo_id)) || 0) + cant));
      }
      if (!ing.size) return err400(res, 'Agrega al menos un ingrediente');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let insumoId = Number(b.insumo_id) || null;
        if (!insumoId) {
          // Crear el insumo elaborado al vuelo (ej. "Carne adobada")
          const nuevo = b.insumo_nuevo || {};
          const nombreIns = texto(nuevo.nombre, 80);
          const unidad = texto(nuevo.unidad, 20);
          if (!nombreIns || !unidad) { await client.query('ROLLBACK'); return err400(res, 'Elige el insumo que se produce, o escribe su nombre y unidad para crearlo'); }
          const { rows } = await client.query(`INSERT INTO insumos (nombre, unidad, categoria) VALUES ($1,$2,'Elaborados') RETURNING id`, [nombreIns, unidad]);
          insumoId = rows[0].id;
        } else {
          const { rows } = await client.query('SELECT id FROM insumos WHERE id = $1', [insumoId]);
          if (!rows.length) { await client.query('ROLLBACK'); return err400(res, 'El insumo que se produce ya no existe'); }
        }
        if (ing.has(insumoId)) { await client.query('ROLLBACK'); return err400(res, 'Un insumo no puede ser ingrediente de sí mismo'); }
        const { rows: existentes } = await client.query('SELECT id FROM insumos WHERE id = ANY($1)', [[...ing.keys()]]);
        if (existentes.length !== ing.size) { await client.query('ROLLBACK'); return err400(res, 'Un ingrediente ya no existe'); }

        let recetaId = id;
        if (id) {
          const { rowCount } = await client.query('UPDATE recetas_produccion SET nombre=$1, insumo_id=$2, rendimiento=$3, activo=$4 WHERE id=$5', [nombre, insumoId, rendimiento, b.activo === undefined ? true : !!b.activo, id]);
          if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Receta no encontrada' }); }
          await client.query('DELETE FROM receta_produccion_items WHERE receta_id = $1', [id]);
        } else {
          const { rows } = await client.query('INSERT INTO recetas_produccion (nombre, insumo_id, rendimiento) VALUES ($1,$2,$3) RETURNING id', [nombre, insumoId, rendimiento]);
          recetaId = rows[0].id;
        }
        for (const [insId, cant] of ing) {
          await client.query('INSERT INTO receta_produccion_items (receta_id, insumo_id, cantidad) VALUES ($1,$2,$3)', [recetaId, insId, cant]);
        }
        await client.query('COMMIT');
        res.json({ ok: true, id: recetaId, insumo_id: insumoId });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }
    app.post('/api/inventario/produccion/recetas', soloEncargado, ruta((req, res) => guardarRecetaProduccion(req, res, null)));
    app.put('/api/inventario/produccion/recetas/:id', soloEncargado, ruta((req, res) => guardarRecetaProduccion(req, res, Number(req.params.id))));
    app.delete('/api/inventario/produccion/recetas/:id', soloEncargado, ruta(async (req, res) => {
      await pool.query('DELETE FROM recetas_produccion WHERE id = $1', [req.params.id]); // el historial de producciones se conserva
      res.json({ ok: true });
    }));

    // Registrar una producción
    app.post('/api/inventario/produccion', soloCajero, ruta(async (req, res) => {
      const b = req.body;
      const sucursalId = sucursalDe(req);
      if (!sucursalId || !b.receta_id) return err400(res, 'Falta la sucursal o la receta');
      const recetas = (await cargarRecetasProduccion(false)).filter((r) => r.id === Number(b.receta_id));
      if (!recetas.length) return res.status(404).json({ error: 'Receta no encontrada' });
      const receta = recetas[0];
      if (!receta.activo) return err400(res, 'Esa receta está desactivada');

      const lotes = num(b.lotes);
      if (!(lotes > 0)) return err400(res, 'Indica cuántos lotes se produjeron');
      const teorica = r3(lotes * receta.rendimiento);
      const real = b.cantidad_real === undefined || b.cantidad_real === '' || b.cantidad_real === null ? teorica : num(b.cantidad_real);
      if (!(real > 0)) return err400(res, 'La cantidad realmente obtenida debe ser mayor a cero');

      // ¿Alcanzaba el stock? Se avisa, pero no se bloquea (el stock del sistema puede ir atrasado)
      const { rows: stocks } = await pool.query('SELECT insumo_id, stock_actual FROM inventario_stock WHERE sucursal_id = $1 AND insumo_id = ANY($2)', [sucursalId, receta.ingredientes.map((x) => x.insumo_id)]);
      const stockDe = new Map(stocks.map((x) => [x.insumo_id, num(x.stock_actual)]));
      const avisos = [];
      receta.ingredientes.forEach((x) => {
        const necesita = r3(x.cantidad * lotes);
        const hay = stockDe.get(x.insumo_id) || 0;
        if (hay < necesita) avisos.push(`Había ${r3(hay)} ${x.unidad} de ${x.nombre} y la producción usó ${necesita}`);
      });

      const costoTotal = r2(receta.ingredientes.reduce((acc, x) => acc + x.cantidad * lotes * x.costo_unitario, 0));
      const costoUnitario = r4(costoTotal / real);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO producciones (sucursal_id, receta_id, receta_nombre, insumo_id, lotes, cantidad_teorica, cantidad_real, costo_total, nota, empleado_nombre)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [sucursalId, receta.id, receta.nombre, receta.insumo_id, lotes, teorica, real, costoTotal, texto(b.nota, 200) || null, req.empleado?.nombre || null]
        );
        const prod = rows[0];
        for (const x of receta.ingredientes) {
          await mover(client, {
            insumo_id: x.insumo_id, sucursal_id: sucursalId, cantidad: -r3(x.cantidad * lotes), tipo: 'produccion_consumo',
            referencia_tipo: 'produccion', referencia_id: prod.id, nota: receta.nombre, empleado: empleadoDe(req),
          });
        }
        // El costo del elaborado se mezcla (promedio ponderado) con lo que ya había
        if (costoUnitario > 0) {
          const nuevoCosto = await costoPromedioNuevo(client, receta.insumo_id, real, costoUnitario);
          await client.query('UPDATE insumos SET costo_unitario = $1 WHERE id = $2', [nuevoCosto, receta.insumo_id]);
        }
        await mover(client, {
          insumo_id: receta.insumo_id, sucursal_id: sucursalId, cantidad: real, tipo: 'produccion_entrada',
          referencia_tipo: 'produccion', referencia_id: prod.id, costo_unitario: costoUnitario || undefined, nota: receta.nombre, empleado: empleadoDe(req),
        });
        await client.query('COMMIT');
        res.json({
          ok: true, produccion_id: prod.id, cantidad_teorica: teorica, cantidad_real: real, unidad: receta.unidad,
          rendimiento_pct: teorica > 0 ? Math.round((real / teorica) * 1000) / 10 : null, avisos,
          ...(esEncargado(req) ? { costo_total: costoTotal, costo_unitario: costoUnitario } : {}),
        });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }));

    app.get('/api/inventario/produccion', soloCajero, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const hasta = fechaValida(req.query.fecha_hasta) ? req.query.fecha_hasta : hoyISO();
      const desde = fechaValida(req.query.fecha_desde) ? req.query.fecha_desde : sumarDias(hasta, -13);
      const { rows } = await pool.query(
        `SELECT p.id, to_char(${fechaNegocioSQL('p.creado_en')}, 'YYYY-MM-DD') AS dia, p.creado_en, COALESCE(p.receta_nombre, r.nombre) AS receta_nombre,
                i.nombre AS insumo_nombre, i.unidad, p.lotes, p.cantidad_teorica, p.cantidad_real, p.costo_total, p.nota, p.empleado_nombre
         FROM producciones p LEFT JOIN recetas_produccion r ON r.id = p.receta_id LEFT JOIN insumos i ON i.id = p.insumo_id
         WHERE p.sucursal_id = $1 AND ${fechaNegocioSQL('p.creado_en')} BETWEEN $2 AND $3 ORDER BY p.creado_en DESC, p.id DESC LIMIT 300`,
        [sucursalId, desde, hasta]
      );
      const lista = rows.map((p) => ({
        ...p, lotes: num(p.lotes), cantidad_teorica: num(p.cantidad_teorica), cantidad_real: num(p.cantidad_real), costo_total: num(p.costo_total),
        rendimiento_pct: num(p.cantidad_teorica) > 0 ? Math.round((num(p.cantidad_real) / num(p.cantidad_teorica)) * 1000) / 10 : null,
      }));
      res.json(esEncargado(req) ? lista : lista.map((p) => quitarCostos(req, p, ['costo_total'])));
    }));

    // Cuánto conviene producir hoy: lo que se suele consumir ese día de la semana, menos lo que ya hay
    app.get('/api/inventario/produccion/sugerida', soloCajero, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const recetas = await cargarRecetasProduccion(true);
      if (!recetas.length) return res.json([]);
      const dow = new Date(`${hoyISO()}T12:00:00Z`).getUTCDay(); // 0 = domingo, igual que Postgres
      const ids = recetas.map((r) => r.insumo_id);

      const [{ rows: hist }, { rows: stocks }] = await Promise.all([
        pool.query(
          `WITH dias AS (
             SELECT m.insumo_id, ${fechaNegocioSQL('m.creado_en')} AS dia, -SUM(m.cantidad) AS consumo
             FROM movimientos_inventario m
             WHERE m.sucursal_id = $1 AND m.insumo_id = ANY($2) AND m.tipo IN ('venta', 'devolucion_venta', 'produccion_consumo')
               AND m.creado_en >= now() - interval '56 days'
             GROUP BY 1, 2
           )
           SELECT insumo_id,
                  AVG(consumo) FILTER (WHERE EXTRACT(DOW FROM dia) = $3) AS mismo_dia,
                  COUNT(*) FILTER (WHERE EXTRACT(DOW FROM dia) = $3)::int AS n_mismo_dia,
                  AVG(consumo) AS general
           FROM dias GROUP BY insumo_id`,
          [sucursalId, ids, dow]
        ),
        pool.query('SELECT insumo_id, stock_actual FROM inventario_stock WHERE sucursal_id = $1 AND insumo_id = ANY($2)', [sucursalId, ids]),
      ]);
      const histDe = new Map(hist.map((h) => [h.insumo_id, h]));
      const stockDe = new Map(stocks.map((x) => [x.insumo_id, num(x.stock_actual)]));

      res.json(recetas.map((r) => {
        const h = histDe.get(r.insumo_id);
        const stock = Math.max(0, stockDe.get(r.insumo_id) || 0);
        let base = 0;
        let basadoEn = 'sin_datos';
        if (h && h.n_mismo_dia >= 2) { base = Math.max(0, num(h.mismo_dia)); basadoEn = 'mismo_dia'; }
        else if (h && num(h.general) > 0) { base = Math.max(0, num(h.general)); basadoEn = 'general'; }
        const objetivo = r3(base * 1.1); // 10% de colchón
        const faltante = Math.max(0, objetivo - stock);
        const lotes = faltante > 0 ? Math.ceil((faltante / r.rendimiento) * 2) / 2 : 0; // de medio en medio lote
        return {
          receta_id: r.id, nombre: r.nombre, insumo_nombre: r.insumo_nombre, unidad: r.unidad, rendimiento: r.rendimiento,
          stock_actual: r3(stock), consumo_esperado: r3(base), basado_en: basadoEn, objetivo,
          lotes_sugeridos: lotes, cantidad_sugerida: r3(lotes * r.rendimiento),
        };
      }));
    }));

    // ====================== RECETAS Y COSTOS ======================
    // Costo de cada platillo según su receta y el costo actual de los insumos, y su margen.
    app.get('/api/inventario/recetas-costos', soloEncargado, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const { rows: productos } = await pool.query(
        `SELECT p.id, p.nombre, p.precio, c.nombre AS categoria,
                COALESCE((SELECT SUM(pi.cantidad * i.costo_unitario) FROM producto_insumos pi JOIN insumos i ON i.id = pi.insumo_id WHERE pi.producto_id = p.id), 0) AS costo,
                (SELECT COUNT(*)::int FROM producto_insumos pi WHERE pi.producto_id = p.id) AS n_insumos,
                (SELECT COUNT(*)::int FROM producto_insumos pi JOIN insumos i ON i.id = pi.insumo_id WHERE pi.producto_id = p.id AND i.costo_unitario <= 0) AS n_sin_costo
         FROM productos p JOIN categorias c ON c.id = p.categoria_id
         WHERE p.sucursal_id = $1 AND p.disponible ORDER BY c.id, p.nombre`,
        [sucursalId]
      );
      const { rows: variantes } = await pool.query(
        `SELECT om.id, gm.producto_id, om.nombre, om.precio, om.multiplicador,
                COALESCE((SELECT SUM(oi.cantidad * i.costo_unitario) FROM opcion_insumos oi JOIN insumos i ON i.id = oi.insumo_id WHERE oi.opcion_id = om.id), 0) AS costo_extra
         FROM opciones_modificador om JOIN grupos_modificadores gm ON gm.id = om.grupo_id
         WHERE gm.tipo = 'variante' AND gm.producto_id = ANY($1) ORDER BY gm.orden, om.orden, om.id`,
        [productos.map((p) => p.id)]
      );

      const filas = [];
      for (const p of productos) {
        const costoBase = num(p.costo);
        const vars = variantes.filter((v) => v.producto_id === p.id);
        const armar = (nombre, precio, costo, varianteId) => {
          // Sin receta no hay costo real: se deja vacío (un "costo 0" haría ver el platillo como 100% rentable)
          const conReceta = p.n_insumos > 0;
          return {
            producto_id: p.id, variante_id: varianteId || null, nombre, categoria: p.categoria, precio: r2(precio),
            costo: conReceta ? r2(costo) : null, margen: conReceta ? r2(precio - costo) : null,
            food_cost_pct: conReceta && precio > 0 ? Math.round((costo / precio) * 1000) / 10 : null,
            tiene_receta: conReceta, n_sin_costo: p.n_sin_costo,
          };
        };
        if (!vars.length) filas.push(armar(p.nombre, num(p.precio), costoBase));
        // Una variante REEMPLAZA el precio y multiplica la receta base (ej. "Orden" = 5 piezas)
        else vars.forEach((v) => filas.push(armar(`${p.nombre} — ${v.nombre}`, num(v.precio), costoBase * (num(v.multiplicador) || 1) + num(v.costo_extra), v.id)));
      }
      const conReceta = filas.filter((f) => f.tiene_receta && f.precio > 0);
      res.json({
        filas,
        resumen: {
          total: filas.length,
          sin_receta: filas.filter((f) => !f.tiene_receta).length,
          con_costo_incompleto: filas.filter((f) => f.tiene_receta && f.n_sin_costo > 0).length,
          food_cost_promedio: conReceta.length ? Math.round((conReceta.reduce((acc, f) => acc + f.food_cost_pct, 0) / conReceta.length) * 10) / 10 : null,
        },
      });
    }));

    // ====================== CIERRE DE TURNO ======================
    app.get('/api/inventario/cierre-turno/preparar', soloCajero, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const todos = req.query.todos === '1';
      const insumos = await listarInsumos(sucursalId);
      const lista = todos ? insumos : insumos.filter((i) => i.critico);
      const hoy = hoyISO();
      const { rows } = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE m.tipo = 'merma')::int AS mermas_n,
           COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)) FILTER (WHERE m.tipo = 'merma'), 0) AS mermas_costo,
           COUNT(*) FILTER (WHERE m.tipo = 'produccion_entrada')::int AS producciones_n,
           COUNT(*) FILTER (WHERE m.tipo IN ('entrada_compra', 'entrada_manual', 'traspaso_entrada'))::int AS entradas_n
         FROM movimientos_inventario m WHERE m.sucursal_id = $1 AND ${fechaNegocioSQL('m.creado_en')} = $2`,
        [sucursalId, hoy]
      );
      const r = rows[0];
      res.json({
        hay_criticos: insumos.some((i) => i.critico),
        modo: todos ? 'todos' : 'criticos',
        turnos: TURNOS,
        insumos: lista.map((i) => ({ id: i.id, nombre: i.nombre, unidad: i.unidad, categoria: i.categoria, critico: i.critico, stock_actual: i.stock_actual })),
        resumen_dia: {
          fecha: hoy, mermas_n: r.mermas_n, producciones_n: r.producciones_n, entradas_n: r.entradas_n,
          ...(esEncargado(req) ? { mermas_costo: r2(num(r.mermas_costo)) } : {}),
        },
      });
    }));

    app.post('/api/inventario/cierre-turno', soloCajero, ruta(async (req, res) => {
      const b = req.body;
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const turno = TURNOS.includes(b.turno) ? b.turno : 'Cierre del día';
      const ajustar = b.ajustar !== false;
      const lineas = (Array.isArray(b.lineas) ? b.lineas : []).filter((l) => l && l.insumo_id && l.contado !== '' && l.contado !== null && l.contado !== undefined && Number.isFinite(Number(l.contado)) && Number(l.contado) >= 0);
      if (!lineas.length) return err400(res, 'Captura al menos un conteo');

      const { rows: info } = await pool.query(
        `SELECT i.id, i.nombre, i.unidad, i.costo_unitario, COALESCE(s.stock_actual, 0) AS stock
         FROM insumos i LEFT JOIN inventario_stock s ON s.insumo_id = i.id AND s.sucursal_id = $1 WHERE i.id = ANY($2)`,
        [sucursalId, lineas.map((l) => Number(l.insumo_id))]
      );
      const porId = new Map(info.map((i) => [i.id, i]));

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resumen = [];
        let faltante = 0;
        let sobrante = 0;
        const vistos = new Set();
        for (const l of lineas) {
          const ins = porId.get(Number(l.insumo_id));
          if (!ins || vistos.has(ins.id)) continue;
          vistos.add(ins.id);
          const teorico = num(ins.stock);
          const contado = r3(num(l.contado));
          const diferencia = r3(contado - teorico);
          const costoDif = r2(diferencia * num(ins.costo_unitario));
          if (diferencia < 0) faltante += -costoDif;
          if (diferencia > 0) sobrante += costoDif;
          resumen.push({ insumo_id: ins.id, nombre: ins.nombre, unidad: ins.unidad, teorico: r3(teorico), contado, diferencia, costo_dif: costoDif, motivo: texto(l.motivo, 120) });
          if (ajustar && diferencia !== 0) {
            await fijar(client, {
              insumo_id: ins.id, sucursal_id: sucursalId, nuevo: contado, tipo: 'ajuste_conteo',
              motivo: `Cierre de turno (${turno})`, nota: texto(l.motivo, 120) || null, empleado: empleadoDe(req),
            });
          }
        }
        const { rows } = await client.query(
          `INSERT INTO cierres_turno (sucursal_id, turno, empleado_nombre, resumen, faltante_costo, sobrante_costo, ajustado, notas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, creado_en`,
          [sucursalId, turno, req.empleado?.nombre || null, JSON.stringify(resumen), r2(faltante), r2(sobrante), ajustar, texto(b.notas, 300) || null]
        );
        await client.query('COMMIT');
        const conDif = resumen.filter((x) => x.diferencia !== 0).length;
        res.json({
          ok: true, id: rows[0].id, turno, contados: resumen.length, con_diferencia: conDif, ajustado: ajustar,
          ...(esEncargado(req) ? { faltante_costo: r2(faltante), sobrante_costo: r2(sobrante) } : {}),
        });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }));

    app.get('/api/inventario/cierre-turno', soloCajero, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const { rows } = await pool.query(
        `SELECT id, turno, empleado_nombre, resumen, faltante_costo, sobrante_costo, ajustado, notas, creado_en
         FROM cierres_turno WHERE sucursal_id = $1 ORDER BY creado_en DESC, id DESC LIMIT 30`,
        [sucursalId]
      );
      const ver = esEncargado(req);
      res.json(rows.map((c) => ({
        id: c.id, turno: c.turno, empleado_nombre: c.empleado_nombre, ajustado: c.ajustado, notas: c.notas, creado_en: c.creado_en,
        contados: c.resumen.length, con_diferencia: c.resumen.filter((x) => x.diferencia !== 0).length,
        resumen: ver ? c.resumen : c.resumen.map((x) => { const y = { ...x }; delete y.costo_dif; return y; }),
        ...(ver ? { faltante_costo: num(c.faltante_costo), sobrante_costo: num(c.sobrante_costo) } : {}),
      })));
    }));

    // ====================== ALERTAS ======================
    const ORDEN_SEVERIDAD = { critica: 0, alta: 1, media: 2, baja: 3 };
    const dinero = (n) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    async function generarAlertas(sucursalId, verCostos) {
      const insumos = await listarInsumos(sucursalId);
      const alertas = [];
      for (const i of insumos) {
        if (i.estado === 'agotado') {
          alertas.push({ tipo: 'agotado', severidad: 'critica', insumo_id: i.id, titulo: `${i.nombre}: agotado`, detalle: i.stock_actual < 0
            ? `El sistema marca ${i.stock_actual} ${i.unidad}: seguramente faltó registrar una compra o ajustar el stock.`
            : `Stock en ${i.stock_actual} ${i.unidad}${i.stock_minimo > 0 ? ` (el mínimo es ${i.stock_minimo})` : ''}.` });
        } else if (i.estado === 'bajo') {
          alertas.push({ tipo: 'bajo_minimo', severidad: 'alta', insumo_id: i.id, titulo: `${i.nombre}: bajo el mínimo`, detalle: `Quedan ${i.stock_actual} ${i.unidad}; el mínimo es ${i.stock_minimo}.${i.cobertura_dias !== null ? ` Alcanza para ~${i.cobertura_dias} días.` : ''}` });
        } else if (i.cobertura_dias !== null && i.cobertura_dias < 2) {
          alertas.push({ tipo: 'cobertura_baja', severidad: 'media', insumo_id: i.id, titulo: `${i.nombre}: se acaba pronto`, detalle: `Al ritmo de las últimas ventas alcanza para ~${i.cobertura_dias} días (quedan ${i.stock_actual} ${i.unidad}).` });
        }
      }

      const [sinReceta, usados, descuadres, ultimoCierre] = await Promise.all([
        pool.query(`SELECT p.nombre FROM productos p WHERE p.sucursal_id = $1 AND p.disponible AND NOT EXISTS (SELECT 1 FROM producto_insumos pi WHERE pi.producto_id = p.id) ORDER BY p.nombre`, [sucursalId]),
        pool.query(`SELECT DISTINCT pi.insumo_id FROM producto_insumos pi JOIN productos p ON p.id = pi.producto_id WHERE p.sucursal_id = $1 AND p.disponible`, [sucursalId]),
        pool.query(
          `SELECT i.nombre, s.stock_actual, COALESCE(m.suma, 0) AS suma FROM inventario_stock s JOIN insumos i ON i.id = s.insumo_id
           LEFT JOIN (SELECT insumo_id, SUM(cantidad) AS suma FROM movimientos_inventario WHERE sucursal_id = $1 GROUP BY insumo_id) m ON m.insumo_id = s.insumo_id
           WHERE s.sucursal_id = $1 AND ABS(s.stock_actual - COALESCE(m.suma, 0)) > 0.001 ORDER BY i.nombre`, [sucursalId]),
        pool.query(`SELECT id, turno, resumen, faltante_costo, creado_en FROM cierres_turno WHERE sucursal_id = $1 AND creado_en >= now() - interval '3 days' ORDER BY creado_en DESC LIMIT 1`, [sucursalId]),
      ]);

      if (sinReceta.rows.length) {
        const nombres = sinReceta.rows.map((r) => r.nombre);
        alertas.push({ tipo: 'sin_receta', severidad: 'baja', titulo: `${nombres.length} producto${nombres.length === 1 ? '' : 's'} sin receta`, detalle: `No descuentan inventario al venderse: ${nombres.slice(0, 5).join(', ')}${nombres.length > 5 ? ` y ${nombres.length - 5} más` : ''}.` });
      }
      if (descuadres.rows.length) {
        const nombres = descuadres.rows.map((r) => r.nombre);
        alertas.push({ tipo: 'historial_descuadrado', severidad: 'media', titulo: 'El stock no coincide con su historial', detalle: `Revisa: ${nombres.slice(0, 5).join(', ')}${nombres.length > 5 ? ` y ${nombres.length - 5} más` : ''}. Suele pasar si el stock se cambió fuera del sistema.` });
      }
      const cierre = ultimoCierre.rows[0];
      if (cierre) {
        const conDif = cierre.resumen.filter((x) => x.diferencia !== 0);
        const faltante = num(cierre.faltante_costo);
        if (verCostos && faltante >= 200) {
          alertas.push({ tipo: 'descuadre_cierre', severidad: 'alta', titulo: `Faltante en el último cierre: ${dinero(faltante)}`, detalle: `${cierre.turno}: ${conDif.length} insumo${conDif.length === 1 ? '' : 's'} con diferencia. Revisa el cierre en la pestaña Cierre.` });
        } else if (conDif.length >= 3) {
          alertas.push({ tipo: 'descuadre_cierre', severidad: 'media', titulo: `${conDif.length} diferencias en el último cierre`, detalle: `${cierre.turno}: revisa el cierre en la pestaña Cierre.` });
        }
      }

      if (verCostos) {
        const usadosSet = new Set(usados.rows.map((r) => r.insumo_id));
        const sinCosto = insumos.filter((i) => usadosSet.has(i.id) && i.costo_unitario <= 0);
        if (sinCosto.length) {
          alertas.push({ tipo: 'costo_cero', severidad: 'media', titulo: `${sinCosto.length} insumo${sinCosto.length === 1 ? '' : 's'} de recetas sin costo`, detalle: `El costo de tus platillos sale incompleto: ${sinCosto.slice(0, 5).map((i) => i.nombre).join(', ')}${sinCosto.length > 5 ? ` y ${sinCosto.length - 5} más` : ''}.` });
        }
        const [alzas, mermas] = await Promise.all([
          pool.query(
            `WITH h AS (
               SELECT ci.insumo_id, ci.costo_unitario, ROW_NUMBER() OVER (PARTITION BY ci.insumo_id ORDER BY c.fecha DESC, c.id DESC) AS rn
               FROM compra_items ci JOIN compras c ON c.id = ci.compra_id WHERE NOT c.anulada AND c.fecha >= CURRENT_DATE - 30 AND ci.costo_unitario > 0)
             SELECT i.id, i.nombre, i.unidad, a.costo_unitario AS nuevo, b.costo_unitario AS anterior
             FROM h a JOIN h b ON b.insumo_id = a.insumo_id AND b.rn = 2 JOIN insumos i ON i.id = a.insumo_id
             WHERE a.rn = 1 AND a.costo_unitario > b.costo_unitario * 1.10 ORDER BY i.nombre`),
          pool.query(
            `SELECT i.id, i.nombre,
                    COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)) FILTER (WHERE m.tipo = 'merma'), 0) AS merma,
                    COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)) FILTER (WHERE m.tipo IN ('venta', 'devolucion_venta', 'produccion_consumo')), 0) AS consumo
             FROM movimientos_inventario m JOIN insumos i ON i.id = m.insumo_id
             WHERE m.sucursal_id = $1 AND m.creado_en >= now() - interval '7 days' GROUP BY i.id, i.nombre
             HAVING COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)) FILTER (WHERE m.tipo = 'merma'), 0) >= 50`, [sucursalId]),
        ]);
        alzas.rows.forEach((r) => {
          const pct = Math.round(((num(r.nuevo) - num(r.anterior)) / num(r.anterior)) * 100);
          alertas.push({ tipo: 'precio_subio', severidad: 'media', insumo_id: r.id, titulo: `${r.nombre}: subió ${pct}% de precio`, detalle: `Tu última compra salió a ${dinero(num(r.nuevo))}/${r.unidad}; la anterior a ${dinero(num(r.anterior))}/${r.unidad}.` });
        });
        mermas.rows.forEach((r) => {
          const merma = num(r.merma);
          const pct = merma / (merma + Math.max(0, num(r.consumo)));
          if (pct > 0.08) alertas.push({ tipo: 'merma_alta', severidad: 'media', insumo_id: r.id, titulo: `${r.nombre}: merma alta esta semana`, detalle: `Se tiraron ${dinero(merma)} en 7 días (${Math.round(pct * 100)}% de lo que se usó).` });
        });
      }

      alertas.sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad] || a.titulo.localeCompare(b.titulo));
      const conteo = { critica: 0, alta: 0, media: 0, baja: 0 };
      alertas.forEach((a) => (conteo[a.severidad] += 1));
      return { alertas, conteo };
    }

    app.get('/api/inventario/alertas', soloCajero, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      res.json(await generarAlertas(sucursalId, esEncargado(req)));
    }));

    // ====================== RESUMEN ======================
    app.get('/api/inventario/resumen', soloEncargado, ruta(async (req, res) => {
      const sucursalId = sucursalDe(req);
      if (!sucursalId) return err400(res, 'Falta la sucursal');
      const hoy = hoyISO();
      const inicioMes = `${hoy.slice(0, 7)}-01`;
      const rango = `m.sucursal_id = $1 AND ${fechaNegocioSQL('m.creado_en')} BETWEEN $2 AND $3`;
      const [insumos, mermaMes, consumoMes, compras, prods, topMermas, recetas, alertas] = await Promise.all([
        listarInsumos(sucursalId),
        pool.query(`SELECT COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)), 0) AS costo, COUNT(*)::int AS n FROM movimientos_inventario m WHERE m.tipo = 'merma' AND ${rango}`, [sucursalId, inicioMes, hoy]),
        pool.query(`SELECT COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)), 0) AS costo FROM movimientos_inventario m WHERE m.tipo IN ('venta', 'devolucion_venta', 'produccion_consumo') AND ${rango}`, [sucursalId, inicioMes, hoy]),
        pool.query('SELECT COALESCE(SUM(total), 0) AS total, COUNT(*)::int AS n FROM compras WHERE sucursal_id = $1 AND NOT anulada AND fecha BETWEEN $2 AND $3', [sucursalId, inicioMes, hoy]),
        pool.query(`SELECT COUNT(*)::int AS n FROM producciones WHERE sucursal_id = $1 AND ${fechaNegocioSQL('creado_en')} BETWEEN $2 AND $3`, [sucursalId, inicioMes, hoy]),
        pool.query(`SELECT i.nombre, i.unidad, SUM(-m.cantidad) AS cantidad, SUM(-m.cantidad * COALESCE(m.costo_unitario, 0)) AS costo
                    FROM movimientos_inventario m JOIN insumos i ON i.id = m.insumo_id WHERE m.tipo = 'merma' AND ${rango} GROUP BY i.nombre, i.unidad ORDER BY costo DESC LIMIT 5`, [sucursalId, inicioMes, hoy]),
        pool.query(`SELECT COUNT(*)::int AS n FROM productos p WHERE p.sucursal_id = $1 AND p.disponible AND NOT EXISTS (SELECT 1 FROM producto_insumos pi WHERE pi.producto_id = p.id)`, [sucursalId]),
        generarAlertas(sucursalId, true),
      ]);
      const merma = r2(num(mermaMes.rows[0].costo));
      const consumo = r2(num(consumoMes.rows[0].costo));
      res.json({
        mes_desde: inicioMes, hasta: hoy,
        valor_inventario: r2(insumos.reduce((acc, i) => acc + i.valor, 0)),
        insumos_con_stock: insumos.filter((i) => i.stock_actual > 0).length,
        insumos_total: insumos.length,
        agotados: insumos.filter((i) => i.estado === 'agotado').length,
        bajo_minimo: insumos.filter((i) => i.estado === 'bajo').length,
        merma_mes: merma, merma_mes_n: mermaMes.rows[0].n,
        merma_pct: merma + consumo > 0 ? r2((merma / (merma + consumo)) * 100) : 0,
        consumo_mes: consumo,
        compras_mes: r2(num(compras.rows[0].total)), compras_mes_n: compras.rows[0].n,
        producciones_mes: prods.rows[0].n,
        productos_sin_receta: recetas.rows[0].n,
        top_mermas: topMermas.rows.map((r) => ({ nombre: r.nombre, unidad: r.unidad, cantidad: r3(num(r.cantidad)), costo: r2(num(r.costo)) })),
        alertas: alertas.conteo,
      });
    }));

    // @@MAS_RUTAS@@
  }

  return {
    mover, fijar, costoPromedioNuevo, listarInsumos, consumoDiario, calcularEstado, registrarRutas,
    constantes: { MOTIVOS_MERMA, TURNOS },
    utilidades: { num, r2, r3, r4, texto, esEncargado, quitarCostos },
  };
};
