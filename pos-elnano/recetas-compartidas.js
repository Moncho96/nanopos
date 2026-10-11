// =====================================================================
// RECETAS COMPARTIDAS ENTRE SUCURSALES
// Cada sucursal tiene su propio menú, así que cada platillo tiene sus propias filas de receta. Aquí se reconoce el
// MISMO platillo en otra sucursal por su nombre (sin importar mayúsculas, acentos ni espacios) y se ofrecen tres cosas:
//   1) compartir: al editar una receta, el cambio se aplica también en el platillo gemelo;
//   2) copiar la receta de un gemelo (traer / mandar);
//   3) comparar y sincronizar todos los platillos de golpe.
// Se comparten los ingredientes de la receta base, las piezas que equivale cada presentación y los insumos extra de cada
// opción (las opciones se emparejan por nombre de grupo + nombre de opción). Los precios, nombres y la estructura
// del menú NO se comparten.
// Un encargado limitado a una sola sucursal nunca modifica la otra.
// =====================================================================
module.exports = function crearRecetasCompartidas({ pool }) {
  const norm = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
  const limitado = (req) => !!req.empleado?.sucursal_id;

  // ---------- Configuración ----------
  async function migrada(db) {
    try {
      await db.query('SELECT 1 FROM configuracion LIMIT 1');
      return true;
    } catch (e) {
      if (e.code === '42P01') return false;
      throw e;
    }
  }
  // Si falta la migración, no se comparte (todo sigue como antes). Con la tabla y sin fila: activo.
  // Importante: llamarla con `pool` ANTES de abrir una transacción (un error dentro de una la aborta).
  async function activo(db) {
    try {
      const { rows } = await db.query("SELECT valor FROM configuracion WHERE clave = 'recetas_compartidas'");
      return rows.length ? rows[0].valor !== 'false' : true;
    } catch (e) {
      if (e.code === '42P01') return false;
      throw e;
    }
  }

  // ---------- Platillos gemelos ----------
  // Mismo nombre en otra sucursal. Si el nombre se repite (en la otra o en la propia), es ambiguo y se ignora.
  async function gemelos(db, productoId) {
    const { rows: yo } = await db.query('SELECT id, nombre, sucursal_id FROM productos WHERE id = $1', [productoId]);
    if (!yo.length) return [];
    const { rows: todos } = await db.query(
      `SELECT p.id, p.nombre, p.sucursal_id, s.nombre AS sucursal_nombre FROM productos p JOIN sucursales s ON s.id = p.sucursal_id`
    );
    const clave = norm(yo[0].nombre);
    const iguales = todos.filter((p) => norm(p.nombre) === clave);
    if (iguales.filter((p) => p.sucursal_id === yo[0].sucursal_id).length > 1) return [];
    const porSucursal = new Map();
    iguales.filter((p) => p.sucursal_id !== yo[0].sucursal_id).forEach((p) => {
      if (!porSucursal.has(p.sucursal_id)) porSucursal.set(p.sucursal_id, []);
      porSucursal.get(p.sucursal_id).push(p);
    });
    return [...porSucursal.values()].filter((l) => l.length === 1).map((l) => l[0]);
  }

  // ---------- Firmas: para comparar recetas ----------
  async function cargarFirmas(db, ids) {
    const m = new Map(ids.map((id) => [id, { base: new Map(), opciones: new Map() }]));
    if (!ids.length) return m;
    const [base, ops] = await Promise.all([
      db.query('SELECT producto_id, insumo_id, cantidad FROM producto_insumos WHERE producto_id = ANY($1)', [ids]),
      db.query(
        `SELECT g.producto_id, g.nombre AS grupo, o.nombre AS opcion, o.multiplicador, oi.insumo_id, oi.cantidad AS cant_insumo
         FROM grupos_modificadores g JOIN opciones_modificador o ON o.grupo_id = g.id
         LEFT JOIN opcion_insumos oi ON oi.opcion_id = o.id WHERE g.producto_id = ANY($1)`,
        [ids]
      ),
    ]);
    base.rows.forEach((r) => m.get(r.producto_id).base.set(r.insumo_id, r3(r.cantidad)));
    ops.rows.forEach((r) => {
      const f = m.get(r.producto_id);
      const k = `${norm(r.grupo)}|${norm(r.opcion)}`;
      if (!f.opciones.has(k)) f.opciones.set(k, { mult: r3(r.multiplicador) || 1, insumos: new Map() });
      if (r.insumo_id) f.opciones.get(k).insumos.set(r.insumo_id, r3(r.cant_insumo));
    });
    return m;
  }
  const mapasIguales = (x, y) => x.size === y.size && [...x].every(([k, v]) => y.has(k) && y.get(k) === v);
  const sinReceta = (f) => f.base.size === 0 && [...f.opciones.values()].every((o) => o.insumos.size === 0);
  // 'igual' | 'distinta' | 'falta_aqui' (aquí no hay, allá sí) | 'falta_alla' | 'ambas_vacias'
  function estadoEntre(a, b) {
    const va = sinReceta(a);
    const vb = sinReceta(b);
    if (va && vb) return 'ambas_vacias';
    if (va) return 'falta_aqui';
    if (vb) return 'falta_alla';
    if (!mapasIguales(a.base, b.base)) return 'distinta';
    for (const [k, oa] of a.opciones) {
      const ob = b.opciones.get(k);
      if (ob && (oa.mult !== ob.mult || !mapasIguales(oa.insumos, ob.insumos))) return 'distinta';
    }
    return 'igual';
  }

  // ---------- Copiar la receta completa de un platillo a otro (reemplaza) ----------
  async function copiarReceta(db, origenId, destinoId) {
    await db.query('DELETE FROM producto_insumos WHERE producto_id = $1', [destinoId]);
    const base = await db.query(
      'INSERT INTO producto_insumos (producto_id, insumo_id, cantidad) SELECT $1, insumo_id, cantidad FROM producto_insumos WHERE producto_id = $2',
      [destinoId, origenId]
    );
    const consulta = `SELECT g.nombre AS grupo, o.id, o.nombre, o.multiplicador,
                             EXISTS (SELECT 1 FROM opcion_insumos oi WHERE oi.opcion_id = o.id) AS con_insumos
                      FROM grupos_modificadores g JOIN opciones_modificador o ON o.grupo_id = g.id WHERE g.producto_id = $1`;
    const [{ rows: deOrigen }, { rows: deDestino }] = await Promise.all([db.query(consulta, [origenId]), db.query(consulta, [destinoId])]);
    const destinoPorClave = new Map(deDestino.map((o) => [`${norm(o.grupo)}|${norm(o.nombre)}`, o]));
    let opciones = 0;
    let sinPareja = 0;
    for (const o of deOrigen) {
      const d = destinoPorClave.get(`${norm(o.grupo)}|${norm(o.nombre)}`);
      if (!d) {
        if (o.con_insumos || r3(o.multiplicador) !== 1) sinPareja += 1; // tenía receta propia y allá no existe esa opción
        continue;
      }
      await db.query('UPDATE opciones_modificador SET multiplicador = $1 WHERE id = $2', [o.multiplicador, d.id]);
      await db.query('DELETE FROM opcion_insumos WHERE opcion_id = $1', [d.id]);
      await db.query('INSERT INTO opcion_insumos (opcion_id, insumo_id, cantidad) SELECT $1, insumo_id, cantidad FROM opcion_insumos WHERE opcion_id = $2', [d.id, o.id]);
      opciones += 1;
    }
    return { ingredientes: base.rowCount, opciones, sin_pareja: sinPareja };
  }

  // ---------- Propagar un cambio puntual a los gemelos (dentro de la transacción del cambio) ----------
  // Cada una devuelve los nombres de las sucursales donde también se aplicó.
  async function propagarBase(db, productoId, insumoId, cantidad) {
    const gs = await gemelos(db, productoId);
    for (const g of gs) {
      if (cantidad === null) await db.query('DELETE FROM producto_insumos WHERE producto_id = $1 AND insumo_id = $2', [g.id, insumoId]);
      else {
        await db.query(
          `INSERT INTO producto_insumos (producto_id, insumo_id, cantidad) VALUES ($1,$2,$3)
           ON CONFLICT (producto_id, insumo_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
          [g.id, insumoId, cantidad]
        );
      }
    }
    return gs.map((g) => g.sucursal_nombre);
  }
  async function replicarBase(db, productoId) {
    const gs = await gemelos(db, productoId);
    for (const g of gs) {
      await db.query('DELETE FROM producto_insumos WHERE producto_id = $1', [g.id]);
      await db.query('INSERT INTO producto_insumos (producto_id, insumo_id, cantidad) SELECT $1, insumo_id, cantidad FROM producto_insumos WHERE producto_id = $2', [g.id, productoId]);
    }
    return gs.map((g) => g.sucursal_nombre);
  }
  // La opción gemela: misma opción (grupo + nombre) del platillo gemelo
  async function opcionesGemelas(db, opcionId) {
    const { rows: o } = await db.query(
      'SELECT o.nombre, g.nombre AS grupo, g.producto_id FROM opciones_modificador o JOIN grupos_modificadores g ON g.id = o.grupo_id WHERE o.id = $1',
      [opcionId]
    );
    if (!o.length) return [];
    const gs = await gemelos(db, o[0].producto_id);
    const res = [];
    for (const g of gs) {
      const { rows } = await db.query(
        'SELECT o2.id, o2.nombre, g2.nombre AS grupo FROM opciones_modificador o2 JOIN grupos_modificadores g2 ON g2.id = o2.grupo_id WHERE g2.producto_id = $1',
        [g.id]
      );
      const iguales = rows.filter((x) => norm(x.grupo) === norm(o[0].grupo) && norm(x.nombre) === norm(o[0].nombre));
      if (iguales.length === 1) res.push({ id: iguales[0].id, sucursal_nombre: g.sucursal_nombre });
    }
    return res;
  }
  async function propagarMultiplicador(db, opcionId, mult) {
    const gs = await opcionesGemelas(db, opcionId);
    for (const g of gs) await db.query('UPDATE opciones_modificador SET multiplicador = $1 WHERE id = $2', [mult, g.id]);
    return gs.map((g) => g.sucursal_nombre);
  }
  async function propagarInsumoOpcion(db, opcionId, insumoId, cantidad) {
    const gs = await opcionesGemelas(db, opcionId);
    for (const g of gs) {
      if (cantidad === null) await db.query('DELETE FROM opcion_insumos WHERE opcion_id = $1 AND insumo_id = $2', [g.id, insumoId]);
      else {
        await db.query(
          `INSERT INTO opcion_insumos (opcion_id, insumo_id, cantidad) VALUES ($1,$2,$3)
           ON CONFLICT (opcion_id, insumo_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
          [g.id, insumoId, cantidad]
        );
      }
    }
    return gs.map((g) => g.sucursal_nombre);
  }

  // ---------- Rutas ----------
  function registrarRutas(app, { requierePuesto }) {
    const solo = requierePuesto(); // encargado
    const ruta = (fn) => async (req, res) => {
      try {
        await fn(req, res);
      } catch (err) {
        console.error('[recetas-compartidas]', req.method, req.path, err);
        if (!res.headersSent) res.status(500).json({ error: 'No se pudo completar la operación de recetas' });
      }
    };
    const err = (res, estado, mensaje) => res.status(estado).json({ error: mensaje });
    const productoDe = async (id) => (await pool.query('SELECT id, nombre, sucursal_id FROM productos WHERE id = $1', [id])).rows[0];

    app.get('/api/recetas/compartidas', solo, ruta(async (req, res) => {
      res.json({ activo: await activo(pool), migrado: await migrada(pool), puede_cambiar: !limitado(req) });
    }));
    app.put('/api/recetas/compartidas', solo, ruta(async (req, res) => {
      if (limitado(req)) return err(res, 403, 'Tu acceso es de una sola sucursal: no puedes cambiar esto');
      if (!(await migrada(pool))) return err(res, 400, 'Falta correr db/migracion-recetas-compartidas.sql en la base de datos');
      await pool.query(
        `INSERT INTO configuracion (clave, valor) VALUES ('recetas_compartidas', $1)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
        [req.body.activo ? 'true' : 'false']
      );
      res.json({ activo: !!req.body.activo });
    }));

    // Los gemelos de un platillo y cómo están sus recetas
    app.get('/api/productos/:id/gemelos', solo, ruta(async (req, res) => {
      const p = await productoDe(req.params.id);
      if (!p) return err(res, 404, 'Producto no encontrado');
      if (limitado(req) && Number(req.empleado.sucursal_id) !== p.sucursal_id) return err(res, 403, 'Ese producto es de otra sucursal');
      const [gs, activa, { rows: suc }] = await Promise.all([gemelos(pool, p.id), activo(pool), pool.query('SELECT COUNT(*)::int AS n FROM sucursales')]);
      const firmas = await cargarFirmas(pool, [p.id, ...gs.map((g) => g.id)]);
      const yo = firmas.get(p.id);
      res.json({
        activo: activa, migrado: await migrada(pool), puede_cambiar: !limitado(req), otras_sucursales: suc[0].n - 1,
        ingredientes_aqui: yo.base.size,
        gemelos: gs.map((g) => ({
          producto_id: g.id, sucursal_id: g.sucursal_id, sucursal_nombre: g.sucursal_nombre, nombre: g.nombre,
          estado: estadoEntre(yo, firmas.get(g.id)), ingredientes: firmas.get(g.id).base.size,
        })),
      });
    }));

    // Copiar la receta de/hacia el gemelo
    app.post('/api/productos/:id/receta/copiar-gemelo', solo, ruta(async (req, res) => {
      const id = Number(req.params.id);
      const origenGemeloId = Number(req.body.gemelo_id);
      const direccion = req.body.direccion === 'mandar' ? 'mandar' : 'traer';
      const p = await productoDe(id);
      if (!p) return err(res, 404, 'Producto no encontrado');
      if (limitado(req)) {
        if (Number(req.empleado.sucursal_id) !== p.sucursal_id) return err(res, 403, 'Ese producto es de otra sucursal');
        if (direccion === 'mandar') return err(res, 403, 'Tu acceso es de una sola sucursal: no puedes cambiar la otra');
      }
      const g = (await gemelos(pool, id)).find((x) => x.id === origenGemeloId);
      if (!g) return err(res, 400, 'Ese no es el mismo platillo de la otra sucursal');
      const deId = direccion === 'traer' ? g.id : id;
      const aId = direccion === 'traer' ? id : g.id;
      const firmas = await cargarFirmas(pool, [deId]);
      if (firmas.get(deId).base.size === 0) return err(res, 400, direccion === 'traer' ? `En ${g.sucursal_nombre} ese platillo todavía no tiene ingredientes en su receta: no hay nada que copiar (la de aquí no se toca)` : 'Este platillo todavía no tiene ingredientes en su receta: no hay nada que mandar (la de la otra sucursal no se toca)');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await copiarReceta(client, deId, aId);
        await client.query('COMMIT');
        res.json({ ok: true, direccion, sucursal_nombre: g.sucursal_nombre, ...r });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }));

    // Comparación de todos los platillos de una sucursal contra otra
    async function comparar(sucursalId, contraId) {
      const { rows: prods } = await pool.query(
        `SELECT p.id, p.nombre, p.sucursal_id, p.disponible, COALESCE(c.nombre, 'Sin categoría') AS categoria
         FROM productos p LEFT JOIN categorias c ON c.id = p.categoria_id WHERE p.sucursal_id = ANY($1) ORDER BY c.id, p.nombre`,
        [[sucursalId, contraId]]
      );
      const aqui = prods.filter((p) => p.sucursal_id === sucursalId);
      const alla = prods.filter((p) => p.sucursal_id === contraId);
      const cuenta = (lista, p) => lista.filter((x) => norm(x.nombre) === norm(p.nombre)).length;
      const firmas = await cargarFirmas(pool, prods.map((p) => p.id));
      const filas = aqui.map((p) => {
        const par = cuenta(aqui, p) === 1 && cuenta(alla, p) === 1 ? alla.find((x) => norm(x.nombre) === norm(p.nombre)) : null;
        return {
          producto_id: p.id, nombre: p.nombre, categoria: p.categoria, gemelo_id: par ? par.id : null,
          estado: par ? estadoEntre(firmas.get(p.id), firmas.get(par.id)) : 'sin_gemelo',
          ingredientes_aqui: firmas.get(p.id).base.size, ingredientes_alla: par ? firmas.get(par.id).base.size : null,
        };
      });
      const conPar = new Set(filas.filter((f) => f.gemelo_id).map((f) => f.gemelo_id));
      return { filas, solo_alla: alla.filter((p) => !conPar.has(p.id)).map((p) => p.nombre) };
    }
    app.get('/api/recetas/comparacion', solo, ruta(async (req, res) => {
      const sucursalId = Number(req.query.sucursal_id);
      const contraId = Number(req.query.contra_sucursal_id);
      if (!sucursalId || !contraId || sucursalId === contraId) return err(res, 400, 'Elige dos sucursales distintas');
      if (limitado(req) && Number(req.empleado.sucursal_id) !== sucursalId) return err(res, 403, 'Esa sucursal no es la tuya');
      const { rows: suc } = await pool.query('SELECT id, nombre FROM sucursales WHERE id = ANY($1)', [[sucursalId, contraId]]);
      if (suc.length !== 2) return err(res, 404, 'Sucursal no encontrada');
      const { filas, solo_alla } = await comparar(sucursalId, contraId);
      const n = (e) => filas.filter((f) => f.estado === e).length;
      res.json({
        sucursal: suc.find((s) => s.id === sucursalId), contra: suc.find((s) => s.id === contraId), filas, solo_alla,
        resumen: { iguales: n('igual'), distintas: n('distinta'), faltan_aqui: n('falta_aqui'), faltan_alla: n('falta_alla'), vacias: n('ambas_vacias'), sin_gemelo: n('sin_gemelo') },
      });
    }));

    // Igualar en bloque: copia las recetas de una sucursal a la otra
    app.post('/api/recetas/sincronizar', solo, ruta(async (req, res) => {
      if (limitado(req)) return err(res, 403, 'Tu acceso es de una sola sucursal: no puedes cambiar la otra');
      const desdeId = Number(req.body.desde_sucursal_id);
      const haciaId = Number(req.body.hacia_sucursal_id);
      const modo = req.body.modo === 'todas' ? 'todas' : 'faltantes';
      if (!desdeId || !haciaId || desdeId === haciaId) return err(res, 400, 'Elige dos sucursales distintas');
      const { rows: suc } = await pool.query('SELECT id FROM sucursales WHERE id = ANY($1)', [[desdeId, haciaId]]);
      if (suc.length !== 2) return err(res, 404, 'Sucursal no encontrada');
      // Se compara DESDE la perspectiva del destino: 'falta_aqui' = el destino no tiene y el origen sí
      const { filas } = await comparar(haciaId, desdeId);
      // Nunca se pisa una receta con una vacía: solo se copian los que tienen ingredientes en el origen
      const objetivo = filas.filter((f) => f.gemelo_id && f.ingredientes_alla > 0 && (f.estado === 'falta_aqui' || (modo === 'todas' && f.estado === 'distinta')));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let ingredientes = 0;
        let sinPareja = 0;
        for (const f of objetivo) {
          const r = await copiarReceta(client, f.gemelo_id, f.producto_id);
          ingredientes += r.ingredientes;
          sinPareja += r.sin_pareja;
        }
        await client.query('COMMIT');
        res.json({ ok: true, modo, platillos: objetivo.length, ingredientes, opciones_sin_pareja: sinPareja, nombres: objetivo.map((f) => f.nombre) });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }));
  }

  return { activo, migrada, gemelos, norm, estadoEntre, cargarFirmas, copiarReceta, propagarBase, replicarBase, propagarMultiplicador, propagarInsumoOpcion, registrarRutas };
};
