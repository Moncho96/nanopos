require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json());

// Sirve las dos pantallas: /pos (toma de pedidos) y /kds (monitor de cocina)
app.use('/pos', express.static(path.join(__dirname, 'public/pos')));
app.use('/kds', express.static(path.join(__dirname, 'public/kds')));
app.get('/', (req, res) => res.redirect('/pos'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  // Cada pantalla de KDS se une a la "sala" de su sucursal para solo ver sus pedidos
  socket.on('join_sucursal', (sucursalId) => {
    socket.join(`sucursal_${sucursalId}`);
  });
});

// ---------- Auxiliares ----------
async function obtenerPedidoCompleto(pedidoId) {
  const { rows } = await pool.query(
    `SELECT p.*, c.telefono AS cliente_telefono
     FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
     WHERE p.id = $1`,
    [pedidoId]
  );
  const pedido = rows[0];
  if (!pedido) return null;

  const { rows: items } = await pool.query(
    `SELECT pi.*, pr.nombre AS producto_nombre, pr.estacion
     FROM pedido_items pi
     JOIN productos pr ON pr.id = pi.producto_id
     WHERE pi.pedido_id = $1
     ORDER BY pi.id`,
    [pedidoId]
  );
  pedido.items = items;

  const { rows: pagos } = await pool.query('SELECT * FROM pagos WHERE pedido_id = $1 ORDER BY id', [pedidoId]);
  pedido.pagos = pagos;

  return pedido;
}

async function recalcularTotalPedido(pedidoId) {
  const { rows: sumaRows } = await pool.query(
    `SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS suma
     FROM pedido_items WHERE pedido_id = $1 AND cancelado = false`,
    [pedidoId]
  );
  const { rows: pedRows } = await pool.query('SELECT costo_envio FROM pedidos WHERE id = $1', [pedidoId]);
  const costoEnvio = Number(pedRows[0]?.costo_envio || 0);
  const total = Number(sumaRows[0].suma) + costoEnvio;
  await pool.query('UPDATE pedidos SET total = $1 WHERE id = $2', [total, pedidoId]);
  return total;
}

// ---------- Sucursales ----------
app.get('/api/sucursales', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM sucursales WHERE activa = true ORDER BY id');
  res.json(rows);
});

// ---------- Categorías y productos ----------
app.get('/api/categorias', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM categorias ORDER BY id');
  res.json(rows);
});

app.get('/api/productos', async (req, res) => {
  const { rows: productos } = await pool.query(
    'SELECT * FROM productos WHERE disponible = true ORDER BY categoria_id, nombre'
  );
  const { rows: grupos } = await pool.query(
    'SELECT * FROM grupos_modificadores ORDER BY producto_id, orden, id'
  );
  const { rows: opciones } = await pool.query(
    'SELECT * FROM opciones_modificador ORDER BY grupo_id, orden, id'
  );

  const opcionesPorGrupo = {};
  opciones.forEach((o) => {
    if (!opcionesPorGrupo[o.grupo_id]) opcionesPorGrupo[o.grupo_id] = [];
    opcionesPorGrupo[o.grupo_id].push(o);
  });

  const gruposPorProducto = {};
  grupos.forEach((g) => {
    g.opciones = opcionesPorGrupo[g.id] || [];
    if (!gruposPorProducto[g.producto_id]) gruposPorProducto[g.producto_id] = [];
    gruposPorProducto[g.producto_id].push(g);
  });

  productos.forEach((p) => {
    p.grupos_modificadores = gruposPorProducto[p.id] || [];
  });

  res.json(productos);
});

// ---------- Clientes ----------
app.get('/api/clientes', async (req, res) => {
  const { telefono } = req.query;
  if (!telefono) return res.json([]);
  const { rows } = await pool.query('SELECT * FROM clientes WHERE telefono = $1', [telefono]);
  res.json(rows);
});

app.post('/api/clientes', async (req, res) => {
  const { nombre, telefono, direccion, colonia, notas } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, telefono, direccion, colonia, notas)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (telefono) DO UPDATE SET
         nombre = EXCLUDED.nombre,
         direccion = EXCLUDED.direccion,
         colonia = EXCLUDED.colonia,
         notas = EXCLUDED.notas
       RETURNING *`,
      [nombre, telefono, direccion, colonia, notas]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el cliente' });
  }
});

// ---------- Pedidos ----------
app.post('/api/pedidos', async (req, res) => {
  const { sucursal_id, cliente_id, cliente_nombre, tipo, notas, items, costo_envio } = req.body;
  if (!sucursal_id || !items || !items.length) {
    return res.status(400).json({ error: 'Falta sucursal_id o items' });
  }
  if (!cliente_nombre || !cliente_nombre.trim()) {
    return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const costoEnvio = Number(costo_envio) || 0;
    const total = items.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0) + costoEnvio;

    const pedidoRes = await client.query(
      `INSERT INTO pedidos (sucursal_id, cliente_id, cliente_nombre, tipo, notas, total, costo_envio)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [sucursal_id, cliente_id || null, cliente_nombre.trim(), tipo || 'mesa', notas || null, total, costoEnvio]
    );
    const pedido = pedidoRes.rows[0];

    const itemRows = [];
    for (const it of items) {
      const itemRes = await client.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, notas, opciones_seleccionadas)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          pedido.id,
          it.producto_id,
          it.cantidad,
          it.precio_unitario,
          it.notas || null,
          JSON.stringify(it.opciones_seleccionadas || []),
        ]
      );
      itemRows.push(itemRes.rows[0]);
    }

    // Trae el nombre del producto para cada item, para que el KDS lo muestre
    // en tiempo real sin tener que recargar la página
    const ids = itemRows.map((r) => r.id);
    const { rows: itemsConNombre } = await client.query(
      `SELECT pi.*, pr.nombre AS producto_nombre, pr.estacion
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
       WHERE pi.id = ANY($1)`,
      [ids]
    );

    await client.query('COMMIT');

    const pedidoCompleto = { ...pedido, items: itemsConNombre };
    // Avisa en tiempo real al monitor de cocina de esa sucursal
    io.to(`sucursal_${sucursal_id}`).emit('nuevo_pedido', pedidoCompleto);

    res.json(pedidoCompleto);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el pedido' });
  } finally {
    client.release();
  }
});

app.get('/api/pedidos', async (req, res) => {
  const { sucursal_id, estado, pagado, cancelado, fecha_desde, fecha_hasta } = req.query;
  let query = `
    SELECT p.*, c.telefono AS cliente_telefono
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE 1=1`;
  const params = [];
  if (sucursal_id) {
    params.push(sucursal_id);
    query += ` AND p.sucursal_id = $${params.length}`;
  }
  if (estado) {
    params.push(estado);
    query += ` AND p.estado = $${params.length}`;
  }
  if (pagado === 'true' || pagado === 'false') {
    params.push(pagado === 'true');
    query += ` AND p.pagado = $${params.length}`;
  }
  if (cancelado === 'true' || cancelado === 'false') {
    params.push(cancelado === 'true');
    query += ` AND p.cancelado = $${params.length}`;
  }
  if (fecha_desde) {
    params.push(fecha_desde);
    query += ` AND ${fechaNegocioSQL('p.creado_en')} >= $${params.length}`;
  }
  if (fecha_hasta) {
    params.push(fecha_hasta);
    query += ` AND ${fechaNegocioSQL('p.creado_en')} <= $${params.length}`;
  }
  query += ' ORDER BY p.creado_en DESC LIMIT 300';

  const { rows: pedidos } = await pool.query(query, params);

  for (const pedido of pedidos) {
    const { rows: items } = await pool.query(
      `SELECT pi.*, pr.nombre AS producto_nombre, pr.estacion
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
       WHERE pedido_id = $1`,
      [pedido.id]
    );
    pedido.items = items;

    const { rows: pagos } = await pool.query(
      `SELECT * FROM pagos WHERE pedido_id = $1 ORDER BY id`,
      [pedido.id]
    );
    pedido.pagos = pagos;
  }

  res.json(pedidos);
});

app.patch('/api/pedidos/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  const { rows } = await pool.query(
    `UPDATE pedidos SET estado = $1, actualizado_en = now() WHERE id = $2 RETURNING *`,
    [estado, id]
  );
  const pedido = rows[0];
  if (pedido) {
    io.to(`sucursal_${pedido.sucursal_id}`).emit('pedido_actualizado', pedido);
  }
  res.json(pedido);
});

app.patch('/api/pedido_items/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  const { rows } = await pool.query(
    `UPDATE pedido_items SET estado = $1
     WHERE id = $2
     RETURNING *, (SELECT sucursal_id FROM pedidos WHERE id = pedido_id) AS sucursal_id`,
    [estado, id]
  );
  const item = rows[0];
  if (item) {
    io.to(`sucursal_${item.sucursal_id}`).emit('item_actualizado', item);
  }
  res.json(item);
});

app.get('/api/pedidos/:id', async (req, res) => {
  const pedido = await obtenerPedidoCompleto(req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(pedido);
});

// Cancela un pedido completo (esté pendiente o ya cobrado), por si se equivocan
app.patch('/api/pedidos/:id/cancelar', async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    'UPDATE pedidos SET cancelado = true, cancelado_en = now() WHERE id = $1 RETURNING *',
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });
  const pedidoCompleto = await obtenerPedidoCompleto(id);
  io.to(`sucursal_${pedidoCompleto.sucursal_id}`).emit('pedido_actualizado', pedidoCompleto);
  res.json(pedidoCompleto);
});

// Agrega un producto a un pedido que ya existe (para editar antes de cobrar)
app.post('/api/pedidos/:id/items', async (req, res) => {
  const { id } = req.params;
  const { producto_id, cantidad, precio_unitario, opciones_seleccionadas, notas } = req.body;
  if (!producto_id || !cantidad || !precio_unitario) {
    return res.status(400).json({ error: 'Faltan datos del producto' });
  }
  try {
    await pool.query(
      `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, notas, opciones_seleccionadas)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, producto_id, cantidad, precio_unitario, notas || null, JSON.stringify(opciones_seleccionadas || [])]
    );
    await recalcularTotalPedido(id);
    const pedidoCompleto = await obtenerPedidoCompleto(id);
    io.to(`sucursal_${pedidoCompleto.sucursal_id}`).emit('pedido_actualizado', pedidoCompleto);
    res.json(pedidoCompleto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo agregar el producto' });
  }
});

// Cancela un producto de un pedido existente (no se borra, se marca para que
// la cocina lo vea tachado en rojo por si ya lo estaba preparando)
app.patch('/api/pedido_items/:id/cancelar', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT pedido_id FROM pedido_items WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado en el pedido' });
    const pedidoId = rows[0].pedido_id;

    await pool.query('UPDATE pedido_items SET cancelado = true WHERE id = $1', [id]);
    await recalcularTotalPedido(pedidoId);
    const pedidoCompleto = await obtenerPedidoCompleto(pedidoId);
    io.to(`sucursal_${pedidoCompleto.sucursal_id}`).emit('pedido_actualizado', pedidoCompleto);
    res.json(pedidoCompleto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cancelar el producto' });
  }
});

app.post('/api/pedidos/:id/pagos', async (req, res) => {
  const { id } = req.params;
  const { pagos } = req.body; // [{ metodo, monto, recibido }]

  if (!pagos || !pagos.length) {
    return res.status(400).json({ error: 'Faltan los pagos' });
  }
  for (const p of pagos) {
    if (!['efectivo', 'tarjeta', 'transferencia'].includes(p.metodo)) {
      return res.status(400).json({ error: `Método de pago inválido: ${p.metodo}` });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pedidoRes = await client.query('SELECT * FROM pedidos WHERE id = $1', [id]);
    const pedido = pedidoRes.rows[0];
    if (!pedido) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    // Borra pagos anteriores de este pedido (por si se está corrigiendo un cobro)
    await client.query('DELETE FROM pagos WHERE pedido_id = $1', [id]);

    const pagosGuardados = [];
    for (const p of pagos) {
      const recibido = p.metodo === 'efectivo' && p.recibido ? Number(p.recibido) : null;
      const cambio = recibido !== null ? Number((recibido - Number(p.monto)).toFixed(2)) : null;
      const r = await client.query(
        `INSERT INTO pagos (pedido_id, metodo, monto, recibido, cambio)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, p.metodo, p.monto, recibido, cambio]
      );
      pagosGuardados.push(r.rows[0]);
    }

    const totalPagado = pagosGuardados.reduce((sum, p) => sum + Number(p.monto), 0);
    const metodosUnicos = [...new Set(pagosGuardados.map((p) => p.metodo))];
    const metodoResumen = metodosUnicos.length > 1 ? 'mixto' : metodosUnicos[0];
    const quedaCubierto = totalPagado >= Number(pedido.total) - 0.01;

    const pedidoActualizadoRes = await client.query(
      `UPDATE pedidos SET pagado = $1, metodo_pago = $2, pagado_en = now() WHERE id = $3 RETURNING *`,
      [quedaCubierto, metodoResumen, id]
    );
    const pedidoActualizado = pedidoActualizadoRes.rows[0];

    await client.query('COMMIT');

    pedidoActualizado.pagos = pagosGuardados;
    io.to(`sucursal_${pedidoActualizado.sucursal_id}`).emit('pedido_actualizado', pedidoActualizado);

    res.json(pedidoActualizado);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el cobro' });
  } finally {
    client.release();
  }
});

// ---------- Gastos ----------
app.post('/api/gastos', async (req, res) => {
  const { sucursal_id, descripcion, monto, metodo_pago } = req.body;
  if (!sucursal_id || !descripcion || !monto || !metodo_pago) {
    return res.status(400).json({ error: 'Faltan datos del gasto' });
  }
  if (!['efectivo', 'tarjeta', 'transferencia'].includes(metodo_pago)) {
    return res.status(400).json({ error: 'Método de pago inválido' });
  }
  const { rows } = await pool.query(
    `INSERT INTO gastos (sucursal_id, descripcion, monto, metodo_pago) VALUES ($1,$2,$3,$4) RETURNING *`,
    [sucursal_id, descripcion, monto, metodo_pago]
  );
  res.json(rows[0]);
});

app.get('/api/gastos', async (req, res) => {
  const { sucursal_id, fecha } = req.query;
  let query = 'SELECT * FROM gastos WHERE 1=1';
  const params = [];
  if (sucursal_id) {
    params.push(sucursal_id);
    query += ` AND sucursal_id = $${params.length}`;
  }
  if (fecha) {
    params.push(fecha);
    query += ` AND ${fechaNegocioSQL('creado_en')} = $${params.length}`;
  }
  query += ' ORDER BY creado_en DESC';
  const { rows } = await pool.query(query, params);
  res.json(rows);
});

app.delete('/api/gastos/:id', async (req, res) => {
  await pool.query('DELETE FROM gastos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- Día de negocio (zona horaria + hora de corte) ----------
// La base de datos guarda las horas en UTC, pero el negocio opera en horario de
// Monterrey y cierra después de medianoche (6pm a 12:30am aprox). Para que las
// ventas de después de medianoche cuenten para el turno que ya estaba en curso
// (no para el día calendario siguiente), el "día de negocio" empieza a las 6am
// hora de Monterrey en vez de a medianoche.
const ZONA_HORARIA_NEGOCIO = 'America/Monterrey';
const CORTE_CUTOFF_HORAS = 6; // hora local (0-23) en la que empieza un nuevo día de negocio

function fechaNegocioSQL(columna) {
  return `((${columna} AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA_HORARIA_NEGOCIO}') - INTERVAL '${CORTE_CUTOFF_HORAS} hours')::date`;
}

// ---------- Corte de caja ----------
async function calcularCorte(sucursalId, fechaDesde, fechaHasta) {
  fechaHasta = fechaHasta || fechaDesde;

  // Resta, proporcionalmente, el costo de envío de cada pago — ese dinero es
  // para el repartidor, no es venta real del negocio.
  const { rows: ventas } = await pool.query(
    `SELECT pg.metodo,
            SUM(pg.monto * (1 - COALESCE(p.costo_envio, 0) / NULLIF(p.total, 0))) AS total
     FROM pagos pg
     JOIN pedidos p ON p.id = pg.pedido_id
     WHERE p.sucursal_id = $1 AND p.cancelado = false AND ${fechaNegocioSQL('pg.creado_en')} BETWEEN $2 AND $3
     GROUP BY pg.metodo`,
    [sucursalId, fechaDesde, fechaHasta]
  );

  const { rows: gastos } = await pool.query(
    `SELECT metodo_pago AS metodo, SUM(monto) AS total
     FROM gastos
     WHERE sucursal_id = $1 AND ${fechaNegocioSQL('creado_en')} BETWEEN $2 AND $3
     GROUP BY metodo_pago`,
    [sucursalId, fechaDesde, fechaHasta]
  );

  const { rows: pedidosCount } = await pool.query(
    `SELECT COUNT(*) AS cantidad, COALESCE(SUM(costo_envio), 0) AS total_envios
     FROM pedidos WHERE sucursal_id = $1 AND ${fechaNegocioSQL('pagado_en')} BETWEEN $2 AND $3 AND pagado = true AND cancelado = false`,
    [sucursalId, fechaDesde, fechaHasta]
  );

  const metodos = ['efectivo', 'tarjeta', 'transferencia'];
  const resumen = metodos.map((m) => {
    const venta = Number(ventas.find((v) => v.metodo === m)?.total || 0);
    const gasto = Number(gastos.find((g) => g.metodo === m)?.total || 0);
    return { metodo: m, ventas: Number(venta.toFixed(2)), gastos: gasto, neto: Number((venta - gasto).toFixed(2)) };
  });

  const totalVentas = Number(resumen.reduce((s, r) => s + r.ventas, 0).toFixed(2));
  const totalGastos = resumen.reduce((s, r) => s + r.gastos, 0);
  const totalNeto = Number(resumen.reduce((s, r) => s + r.neto, 0).toFixed(2));
  const totalEnvios = Number(pedidosCount[0].total_envios);

  return {
    fecha: fechaDesde,
    fechaHasta,
    sucursal_id: Number(sucursalId),
    pedidosCobrados: Number(pedidosCount[0].cantidad),
    resumen,
    totalVentas,
    totalGastos,
    totalNeto,
    totalEnvios,
  };
}

app.get('/api/corte', async (req, res) => {
  const { sucursal_id, fecha, fecha_hasta } = req.query;
  if (!sucursal_id || !fecha) {
    return res.status(400).json({ error: 'Falta sucursal_id o fecha' });
  }
  res.json(await calcularCorte(sucursal_id, fecha, fecha_hasta));
});

app.get('/api/corte/cerrado', async (req, res) => {
  const { sucursal_id, fecha } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM cortes WHERE sucursal_id = $1 AND fecha = $2',
    [sucursal_id, fecha]
  );
  res.json(rows[0] || null);
});

app.post('/api/corte/cerrar', async (req, res) => {
  const { sucursal_id, fecha, contado } = req.body; // contado: { efectivo, tarjeta, transferencia }
  if (!sucursal_id || !fecha || !contado) {
    return res.status(400).json({ error: 'Faltan datos para cerrar el corte' });
  }

  const corte = await calcularCorte(sucursal_id, fecha);
  const resumenConContado = corte.resumen.map((r) => {
    const contadoMetodo = Number(contado[r.metodo]) || 0;
    return { ...r, contado: contadoMetodo, diferencia: Number((contadoMetodo - r.neto).toFixed(2)) };
  });
  const totalContado = resumenConContado.reduce((s, r) => s + r.contado, 0);
  const diferencia = Number((totalContado - corte.totalNeto).toFixed(2));

  const { rows } = await pool.query(
    `INSERT INTO cortes (sucursal_id, fecha, resumen, total_ventas, total_gastos, total_envios, total_neto_esperado, total_contado, diferencia)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (sucursal_id, fecha) DO UPDATE SET
       resumen = EXCLUDED.resumen,
       total_ventas = EXCLUDED.total_ventas,
       total_gastos = EXCLUDED.total_gastos,
       total_envios = EXCLUDED.total_envios,
       total_neto_esperado = EXCLUDED.total_neto_esperado,
       total_contado = EXCLUDED.total_contado,
       diferencia = EXCLUDED.diferencia,
       cerrado_en = now()
     RETURNING *`,
    [
      sucursal_id,
      fecha,
      JSON.stringify(resumenConContado),
      corte.totalVentas,
      corte.totalGastos,
      corte.totalEnvios,
      corte.totalNeto,
      totalContado,
      diferencia,
    ]
  );

  res.json(rows[0]);
});

// ---------- Costos de envío por colonia ----------
app.get('/api/envios', async (req, res) => {
  const { sucursal_id } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM costos_envio WHERE sucursal_id = $1 ORDER BY colonia',
    [sucursal_id]
  );
  res.json(rows);
});

app.post('/api/envios', async (req, res) => {
  const { sucursal_id, colonia, costo } = req.body;
  if (!sucursal_id || !colonia || costo === undefined) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO costos_envio (sucursal_id, colonia, costo) VALUES ($1,$2,$3)
       ON CONFLICT (sucursal_id, colonia) DO UPDATE SET costo = EXCLUDED.costo
       RETURNING *`,
      [sucursal_id, colonia.trim(), costo]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar' });
  }
});

app.patch('/api/envios/:id', async (req, res) => {
  const { costo } = req.body;
  const { rows } = await pool.query(
    'UPDATE costos_envio SET costo = $1 WHERE id = $2 RETURNING *',
    [costo, req.params.id]
  );
  res.json(rows[0]);
});

app.delete('/api/envios/:id', async (req, res) => {
  await pool.query('DELETE FROM costos_envio WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- Planeación de compras con Claude ----------
app.post('/api/plan-compras', async (req, res) => {
  const { sucursal_id, dias = 7 } = req.body;
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'Falta configurar ANTHROPIC_API_KEY en el .env' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT pr.nombre, SUM(pi.cantidad) AS total_vendido
       FROM pedido_items pi
       JOIN pedidos p ON p.id = pi.pedido_id
       JOIN productos pr ON pr.id = pi.producto_id
       WHERE p.sucursal_id = $1 AND p.creado_en >= now() - ($2 || ' days')::interval
       GROUP BY pr.nombre
       ORDER BY total_vendido DESC`,
      [sucursal_id, dias]
    );

    if (!rows.length) {
      return res.json({ resumen: [], sugerencia: 'No hay ventas registradas en ese periodo todavía.' });
    }

    const resumen = rows.map((r) => `${r.nombre}: ${r.total_vendido} unidades vendidas`).join('\n');

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Eres un asistente de planeación de compras para una taquería en México. Estas son las ventas por producto de los últimos ${dias} días:\n\n${resumen}\n\nSugiere cantidades de compra de insumos para la próxima semana, con un margen de seguridad razonable (10-15%) para no quedarse sin producto pero sin sobre-comprar perecederos. Responde breve, en formato de lista, en español.`,
        },
      ],
    });

    res.json({ resumen: rows, sugerencia: msg.content[0].text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar la sugerencia de compras' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
