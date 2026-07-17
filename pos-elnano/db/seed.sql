-- Datos iniciales. Ajusta nombres, precios y menú a tu gusto antes de correrlo.

INSERT INTO sucursales (nombre) VALUES
  ('Santa María'),
  ('Mitras Poniente')
ON CONFLICT DO NOTHING;

INSERT INTO categorias (nombre) VALUES
  ('Tacos'),
  ('Bebidas'),
  ('Extras')
ON CONFLICT DO NOTHING;

-- Ejemplo de menú, edítalo con tus productos e insumos reales
INSERT INTO productos (nombre, categoria_id, precio, estacion) VALUES
  ('Taco de Adobada', 1, 18.00, 'cocina'),
  ('Taco de Bistec', 1, 20.00, 'cocina'),
  ('Taco de Pollo', 1, 18.00, 'cocina'),
  ('Gringa', 1, 45.00, 'cocina'),
  ('Refresco', 2, 25.00, 'bebidas'),
  ('Agua de horchata', 2, 20.00, 'bebidas'),
  ('Orden de papas', 3, 35.00, 'cocina')
ON CONFLICT DO NOTHING;
