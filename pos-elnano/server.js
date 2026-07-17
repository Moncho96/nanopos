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
  const { sucursal_id, cliente_id, tipo, notas, items } = req.body;
  if (!sucursal_id || !items || !items.length) {
    return res.status(400).json({ error: 'Falta sucursal_id o items' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const total = items.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0);

    const pedidoRes = await client.query(
      `INSERT INTO pedidos (sucursal_id, cliente_id, tipo, notas, total)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [sucursal_id, cliente_id || null, tipo || 'mostrador', notas || null, total]
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

    await client.query('COMMIT');

    const pedidoCompleto = { ...pedido, items: itemRows };
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
  const { sucursal_id, estado } = req.query;
  let query = `
    SELECT p.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
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
  query += ' ORDER BY p.creado_en DESC LIMIT 100';

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
