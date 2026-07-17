-- Esquema base para el POS de El Nano

CREATE TABLE IF NOT EXISTS sucursales (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  activa BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  precio NUMERIC(10,2) NOT NULL,
  disponible BOOLEAN DEFAULT true,
  -- 'estacion' sirve para mandar el item a distintas pantallas de cocina en el futuro
  -- (ej. 'cocina', 'bebidas', 'plancha')
  estacion TEXT DEFAULT 'cocina'
);

CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  nombre TEXT,
  telefono TEXT UNIQUE,
  direccion TEXT,
  colonia TEXT,
  notas TEXT,
  creado_en TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  sucursal_id INTEGER REFERENCES sucursales(id),
  cliente_id INTEGER REFERENCES clientes(id),
  tipo TEXT DEFAULT 'mostrador', -- mostrador, domicilio, para_llevar
  estado TEXT DEFAULT 'recibido', -- recibido, en_preparacion, listo, entregado, cancelado
  total NUMERIC(10,2),
  notas TEXT,
  creado_en TIMESTAMP DEFAULT now(),
  actualizado_en TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedido_items (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id INTEGER REFERENCES productos(id),
  cantidad INTEGER NOT NULL,
  precio_unitario NUMERIC(10,2),
  notas TEXT,
  estado TEXT DEFAULT 'pendiente' -- pendiente, listo
);

CREATE INDEX IF NOT EXISTS idx_pedidos_sucursal ON pedidos(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedido_items_pedido ON pedido_items(pedido_id);
