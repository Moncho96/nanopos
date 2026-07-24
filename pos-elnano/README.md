# POS El Nano

POS propio, hecho a la medida: toma de pedidos, monitor de cocina (KDS) en tiempo real,
alta de clientes, y una función para pedirle a Claude que sugiera qué comprar según tus
ventas. Corre en la nube y se usa desde el navegador de cualquier tablet/celular Android
(no necesitas instalar nada del Play Store).

## Qué incluye esta primera fase

- `/pos` — pantalla de toma de pedidos (para caja o meseros)
- `/kds` — monitor de cocina, se actualiza solo en tiempo real cuando entra un pedido
- Alta de clientes por teléfono (nombre, dirección, colonia)
- Multi-sucursal: Santa María y Mitras Poniente ya vienen precargadas
- Endpoint `/api/plan-compras` que le pasa tus ventas recientes a Claude y te
  regresa una sugerencia de compra

Lo que falta para fases futuras: módulo de inventario (insumos, mermas, costeo),
reportes de ventas, y usuarios/roles con permisos. Se construye igual de fácil sobre
esta misma base cuando quieras seguirle.

## 1. Requisitos

- Cuenta gratuita en [Railway](https://railway.app) o [Render](https://render.com)
  (cualquiera de las dos te da Node.js + Postgres gratis para empezar)
- Tu API key de Anthropic (la sacas en [console.anthropic.com](https://console.anthropic.com))

## 2. Desplegar en Railway (recomendado, más simple)

1. Crea una cuenta en railway.app y un proyecto nuevo.
2. Sube esta carpeta a un repositorio de GitHub (o usa "Deploy from local folder" si tu
   plan lo permite).
3. En el proyecto, agrega un servicio **PostgreSQL** (botón "New" → "Database" →
   "PostgreSQL"). Railway te da automáticamente la variable `DATABASE_URL`.
4. Agrega un servicio para este código (New → GitHub repo, o sube el zip).
5. En las variables de entorno del servicio de Node, agrega:
   - `DATABASE_URL` (cópiala del servicio de Postgres, Railway te la muestra en su pestaña "Variables")
   - `ANTHROPIC_API_KEY` (tu key de Anthropic)
6. Railway detecta el `package.json` y corre `npm install` solo. Verifica que el
   "Start Command" sea `npm start`.
7. Una sola vez, corre la inicialización de la base de datos. Desde tu compu, con
   Node instalado localmente:
   ```
   npm install
   # crea un archivo .env con el DATABASE_URL que te dio Railway
   npm run db:init
   ```
   Esto crea las tablas y mete las 2 sucursales + un menú de ejemplo.
8. Railway te da una URL pública (algo como `https://pos-elnano.up.railway.app`).
   Esa es la que vas a usar en las tablets.

## 3. Usarlo en las tablets/celulares Android

- En la tablet de **caja**, abre en Chrome: `https://tu-url.up.railway.app/pos`
- En la tablet de **cocina**, abre: `https://tu-url.up.railway.app/kds`
- En Chrome, toca el menú (⋮) → "Agregar a pantalla de inicio". Queda como app,
  con su ícono, sin barra de navegador.
- Dejas la tablet de cocina siempre conectada y con esa pantalla abierta —
  ahí van a ir cayendo los pedidos solos, con sonido de aviso.

## 4. Editar tu menú real

Abre `db/seed.sql` y reemplaza los productos de ejemplo con tu menú real de El Nano
(nombres, categorías, precios). Puedes volver a correr `npm run db:init` mientras
sigas en pruebas, o mejor: cuando ya esté en producción con pedidos reales, editas
directo en la tabla `productos` desde el panel de Postgres de Railway
(pestaña "Data") para no reiniciar nada.

## 5. Probarlo en tu computadora antes de subirlo

```
npm install
cp .env.example .env
# edita .env con un Postgres local o uno de prueba en Railway
npm run db:init
npm start
```

Abre `http://localhost:3000/pos` y `http://localhost:3000/kds` en dos pestañas
distintas para ver el flujo completo: mandas un pedido desde /pos y aparece al
instante en /kds.

## 6. Cómo funciona la planeación de compras con Claude

Es un endpoint (`POST /api/plan-compras`) que junta tus ventas de los últimos N
días agrupadas por producto y le pide a Claude una sugerencia de compra. Por ahora
lo puedes probar así, con la app corriendo:

```
curl -X POST https://tu-url.up.railway.app/api/plan-compras \
  -H "Content-Type: application/json" \
  -d '{"sucursal_id": 1, "dias": 7}'
```

En la siguiente fase le agregamos un botón dentro del propio POS para que no
tengas que usar la terminal.

## 7. Modificadores por producto (variantes y extras)

Cada producto puede tener:
- Un grupo de **variantes** (eliges una, reemplaza el precio) — ej. Pieza / Orden / Orden con queso
- Un grupo de **extras** (eliges varios, se suman al precio) — ej. Extra tocino, Extra queso

Para aplicar esto a una base de datos que ya tienes corriendo en Railway:

1. Entra al servicio de **Postgres** → pestaña **"Data"**.
2. Copia todo el contenido de `db/migracion-modificadores.sql`, pégalo en la cajita de consulta, y ejecútalo. Esto agrega las tablas nuevas sin borrar nada.
3. Copia todo el contenido de `db/menu-real.sql`, pégalo, y ejecútalo. **Esto borra el menú de ejemplo y cualquier pedido de prueba** y carga tu menú real de El Nano con todos sus modificadores.
4. Recarga `/pos` en el navegador — ya deberías ver tu menú real, y al tocar un producto con variantes/extras se abre una ventana para elegir antes de agregarlo al carrito.

Si necesitas editar precios o agregar productos nuevos después, edita directo las tablas `productos`, `grupos_modificadores` y `opciones_modificador` desde la misma pestaña "Data".

## 8. Cobrar pedidos, dividir cuenta y calcular cambio

En `/pos`, pestaña **"💵 Cobrar"**: lista de pedidos con su tipo (mesa, para llevar, domicilio).
Al tocar "Cobrar" se abre una ventana donde puedes:

- Elegir el método de pago (efectivo, tarjeta, transferencia)
- **Dividir la cuenta** en varios métodos (botón "+ Dividir con otro método") — útil cuando parte
  de la cuenta se paga en efectivo y parte con tarjeta
- Si es efectivo, poner cuánto dio el cliente y ver el **cambio calculado automáticamente**
- El botón de confirmar solo se activa cuando lo que asignaste cubre exactamente el total

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-pagos-divididos.sql` (incluye también las columnas
   de la migración anterior, por si `db/migracion-cobros.sql` no se llegó a correr).
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js` (reemplazando los viejos).
4. Si tenías la carpeta `public/caja` de un paso anterior, bórrala de tu repo — ya no se usa,
   todo vive en `/pos`.

## 9. Cliente obligatorio, editar pedidos, corte de caja y envíos por colonia

Cuatro funciones nuevas, todas dentro de `/pos`:

- **Cliente obligatorio**: ya no se puede enviar un pedido a cocina sin poner el nombre del
  cliente. Ese nombre se muestra en el ticket de cocina y en la lista de cobro.
- **Editar pedidos**: en la pestaña "Cobrar", cada pedido sin cobrar tiene un botón "✏️ Editar"
  para agregar productos nuevos o quitar los que ya no van, antes de cobrarlo. Los cambios se
  reflejan al instante en el monitor de cocina.
- **Corte de caja** (pestaña "📊 Corte"): elige una fecha y te muestra cuánto se vendió por cada
  método de pago, le resta los gastos registrados ese día en cada método, y te dice cuánto debe
  haber en cada uno. También puedes registrar gastos ahí mismo (ej. "Compra de carbón — $200 —
  efectivo").
- **Envíos por colonia** (pestaña "🚚 Envíos"): registras el costo de envío de cada colonia. Al
  tomar un pedido de domicilio, si escribes una colonia que ya tienes registrada, el costo se
  suma solo al total.

Para activar todo esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-cliente-gastos-envios.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`.
4. Antes de usarlo en serio, ve a la pestaña "Envíos" y carga las colonias que manejas con su
   costo — si una colonia no está registrada, el sistema te avisa pero no bloquea el pedido
   (puedes seguir sin costo de envío calculado y agregarlo después).

## 10. Ajustes: cancelar productos en cocina, colonias en desplegable, envío fuera del corte, y cierre de caja

- **Editar pedidos → cocina**: al agregar un producto desde "Editar", llega al instante al KDS
  (con sonido de aviso). Al quitar uno, ya no se borra — se marca como **cancelado** y se muestra
  tachado en rojo en el ticket de cocina, por si ya lo estaban preparando.
- **Colonias en desplegable**: en "Tomar pedido", el campo de colonia ahora es una lista que se
  llena con lo que registres en la pestaña "Envíos" — ya no hay que escribir a mano ni preocuparse
  por errores de dedo.
- **Envío fuera del corte**: el costo de envío ya no cuenta como venta real en el "Corte" — se
  resta proporcionalmente de cada pago, porque ese dinero es para el repartidor. Se muestra aparte,
  solo informativo.
- **Cerrar corte**: al final del día, en la pestaña "Corte", debajo de los gastos hay un
  **Cuadre de caja**: pones cuánto contaste físicamente en cada método (efectivo, tarjeta,
  transferencia) y el sistema calcula la diferencia contra lo que debía haber. Al tocar
  "Cerrar corte" queda guardado como registro histórico — ese día ya no deja agregar más gastos,
  y si vuelves a esa fecha te muestra el cierre ya hecho en vez de dejarte cerrar dos veces.

Para activar todo esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-cancelados-cierre-corte.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`, `public/kds/app.js`.

## 11. Historial separado, cancelar pedidos y cambiar método de pago

- **Pantalla principal**: ahora solo muestra pedidos **pendientes** (sin cobrar), para no
  saturarla. Los cobrados y cancelados ya no aparecen ahí.
- **Historial de pedidos** (menú ☰): muestra todos los pedidos — pendientes, cobrados y
  cancelados — con filtro de fecha (Desde / Hasta, para un día específico o un rango) y chips
  para filtrar por estado.
- **Cancelar pedido completo**: al abrir cualquier pedido (desde la pantalla principal o el
  historial), hay un botón "🗑️ Cancelar pedido" — funciona tanto si está pendiente como si ya
  se cobró. Un pedido cancelado no cuenta en el corte de caja ni aparece en cocina.
- **Cambiar método de pago**: si el pedido ya está cobrado, aparece "💳 Cambiar método de pago"
  — reabre el cobro con lo que ya se había registrado, para corregirlo (incluso si estaba
  dividido en varios métodos).

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-cancelar-pedido.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`, `public/kds/app.js`.

## 12. Inventario: menú editable + recetas + descuento automático

Nueva pestaña **"🍽️ Menú"** (menú ☰):

- **Productos**: agregar, editar (nombre/categoría/precio) y "ocultar" productos (no se borran
  de verdad, para no romper el historial — solo dejan de aparecer en la toma de pedidos).
  También puedes crear categorías nuevas ahí mismo.
- **Insumos**: catálogo de insumos (nombre, unidad, costo por unidad) y el stock actual **por
  sucursal** — cada sucursal lleva su propio inventario aunque el insumo sea el mismo.
- **Receta** (botón 📋 en cada producto): defines cuánto de cada insumo se gasta al vender 1
  unidad de ese producto (ej. "Taco de Bistec" gasta 1 tortilla + 0.08 kg de carne).

**Cómo se descuenta solo:** cada vez que se manda un pedido a cocina (o se le agrega un producto
al editarlo), el sistema resta automáticamente los insumos de la receta, multiplicados por la
cantidad vendida, del inventario de esa sucursal. Si cancelas un producto o el pedido completo,
esos insumos se **regresan** al inventario.

**Limitación a tener en cuenta:** la receta es por producto, no por variante — o sea, "Los de
Bistec" gasta lo mismo sin importar si eligieron "Pieza" o "Orden con queso y aguacate" (el
sistema multiplica por la cantidad de piezas/órdenes vendidas, pero no distingue entre esas
presentaciones para la receta). Si esto te causa problemas de precisión, se puede ajustar más
adelante para que cada opción de variante tenga su propia receta.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-inventario.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`.
4. Entra a "Menú" → pestaña "Insumos" y da de alta tus insumos reales (harina, carne, queso,
   etc.) con su unidad y costo.
5. Para cada producto, entra a su receta (📋) y define cuánto insumo lleva.
6. Da de alta el stock inicial de cada insumo por sucursal (columna "Stock aquí" en Insumos,
   cambiando de sucursal arriba para cargar el stock de cada una).

## 13. Planeación de compras con Claude (usa el inventario real)

Nueva pestaña **"🛒 Planeación de compras"** (menú ☰): eliges cuántos días de historial
considerar, tocas "Generar sugerencia", y Claude analiza el **consumo real de insumos** (según
las recetas que definiste en Menú) junto con el **stock actual** de esa sucursal, para decirte
qué comprar y qué tan urgente es.

Antes solo se podía probar por API — ahora ya está integrado directo en la app, y es más preciso
porque usa el inventario real en vez de solo contar productos vendidos.

Requiere que ya hayas configurado `ANTHROPIC_API_KEY` en las variables de Railway (lo hiciste
desde el principio del proyecto), y que tengas insumos + recetas cargados en Menú — si no hay
insumos todavía, te lo va a decir en vez de fallar.

No requiere migración de base de datos nueva — solo sube `server.js` y `public/pos/app.js` y
`public/pos/index.html` a GitHub.

## 14. Recetas con variantes: multiplicador e insumos extra por opción

Resuelve el caso de productos compuestos (ej. "Los de Bistec" en presentación de 5 piezas) y
opciones que agregan su propio insumo (ej. "Con aguacate").

**Cómo se define ahora:**

1. En Menú → 📋 Receta de un producto, la receta base se define **pensando en 1 sola pieza**
   (ej. "Taco de Bistec: 1 tortilla, 0.08 kg de carne" — no la orden completa de 5).
2. Debajo de la receta, aparecen las variantes y extras de ese producto. A cada opción de tipo
   **variante** le pones un **multiplicador** — cuántas piezas representa (Pieza = 1, Orden = 5,
   etc.). El sistema multiplica automáticamente: receta base × multiplicador × cantidad vendida.
3. A cualquier opción (variante o extra) le puedes agregar **insumos extra** con el botón
   "🧪 Insumos" — por ejemplo, "Orden con aguacate" suma 0.5 aguacate aparte de la receta base,
   o "Extra tocino" en las hamburguesas suma 1 rebanada de tocino.

Ya corrí las actualizaciones automáticas para tu menú real: "Orden" en Los de Bistec quedó en
multiplicador 5, en Los Gueros en 4, y en Volcanes en 3 — el resto de variantes de una sola pieza
(piratas, burritos, combos) se quedan en 1 por default, que es correcto para ellas.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-receta-variantes.sql`.
3. Sube a GitHub: `server.js`, `public/pos/app.js`.
4. Revisa las recetas de tus productos con variantes ("Los de Bistec", "Los Gueros",
   "Volcanes") — probablemente había que reducir las cantidades que ya tenías puestas (si
   pusiste la receta pensando en la orden completa, divide entre las piezas), y agrega el
   insumo extra a las opciones "con aguacate"/"con queso" que correspondan.

## 15. Conteo físico de inventario

Nueva pestaña **"📦 Conteo de inventario"** (menú ☰): lista todos tus insumos con lo que el
**sistema** calcula que debería haber (según las ventas descontadas) y una casilla para poner lo
que **cuentas físicamente**. La diferencia se calcula en vivo mientras escribes — verde si
coincide, rojo si hay diferencia.

- Puedes contar solo algunos insumos y dejar el resto en blanco — no es necesario contar todo
  de una vez.
- Al guardar, el stock del sistema se **ajusta** a lo que contaste (para que el inventario
  quede correcto de ahí en adelante).
- Abajo queda un historial de conteos anteriores, mostrando solo los insumos que tuvieron
  diferencia esa vez (para detectar patrones — mermas, robo hormiga, error de receta, etc.).

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-conteo-inventario.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`.

## 16. Importar historial de otras ventas (CSV)

Nueva pestaña **"📥 Importar historial"** (menú ☰): sube un CSV con tus ventas de otros puntos
de venta, y el sistema crea los pedidos con su fecha real — sin descontar inventario (esas ventas
ya pasaron, antes de tu conteo inicial) y sin avisar a cocina (no están en curso).

**Columnas del CSV** (con encabezado, en este orden):

```
pedido_externo,fecha,hora,sucursal,cliente_nombre,tipo,metodo_pago,producto,variante,cantidad,precio_unitario
```

- `pedido_externo`: cualquier identificador que uses para agrupar — varias filas con el mismo
  valor (y misma fecha y sucursal) se juntan en un solo pedido con varios productos.
- `fecha`: formato `AAAA-MM-DD`.
- `hora`: formato `HH:MM` (24 horas). Si la dejas vacía, usa 12:00 por default.
- `sucursal`: debe decir exactamente "Santa María" o "Mitras Poniente".
- `cliente_nombre`: opcional, si lo dejas vacío pone "Cliente histórico".
- `tipo`: mesa / para_llevar / domicilio (también acepta "mostrador", "llevar", "delivery", etc.).
- `metodo_pago`: efectivo / tarjeta / transferencia.
- `producto`: debe coincidir exactamente con el nombre del producto en tu Menú actual.
- `variante`: el nombre de la opción elegida (ej. "Orden con queso"), o vacío si el producto no
  tiene variantes.
- `cantidad`: cuántas piezas/unidades de esa línea.
- `precio_unitario`: opcional — si lo dejas vacío, usa el precio actual del producto/variante
  (ojo: si tus precios de entonces eran distintos a los de ahora, mejor ponlo explícito).

Tienes una plantilla de ejemplo (`plantilla-importar-historico.csv`) con el formato correcto.

**Cómo usarlo:**

1. Prepara tu CSV en Excel (o donde tengas los datos) siguiendo esas columnas exactas, y guárdalo
   como CSV (no como .xlsx).
2. Menú ☰ → "📥 Importar historial" → elige el archivo → "Importar".
3. Se manda en lotes automáticamente (para no saturar la conexión) y al final te dice cuántos
   pedidos se crearon y, si algún producto/sucursal no coincidió con tu catálogo, te lista
   exactamente cuáles filas fallaron para que las corrijas y las vuelvas a subir.

No requiere migración de base de datos — solo sube `server.js`, `public/pos/index.html` y
`public/pos/app.js` a GitHub.

## 17. Registrar compras leyendo el ticket con Claude

Nueva pestaña **"📷 Registrar compra"** (menú ☰): tomas o subes una foto del ticket de compra,
Claude lee los productos, cantidades y precios, y te los muestra en una tabla para que confirmes
(o corrijas) contra tu catálogo de insumos antes de guardar. Al guardar, se suma directo al
inventario de la sucursal — y de paso actualiza el costo unitario del insumo, para que la
planeación de compras sea más precisa la próxima vez.

- Cada fila detectada trae un desplegable para elegir el insumo — si el nombre del ticket se
  parece a uno de tu catálogo, ya viene preseleccionado, pero siempre revisa antes de guardar.
- Si Claude no detecta algo o quieres agregar un producto que no traía el ticket, usa
  "+ Agregar fila manual".
- También puedes saltarte la foto por completo con "+ Empezar sin foto" y capturar la compra a
  mano.
- Abajo queda un historial de tus compras anteriores con el detalle de cada una.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-compras.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`.

Requiere que ya tengas `ANTHROPIC_API_KEY` configurada en Railway (la misma que usa la
planeación de compras) y que tus insumos ya estén dados de alta en Menú → Insumos.

## 18. Número de pedido diario (reinicia cada día por sucursal)

Cada pedido ahora tiene un "#" que empieza en 1 cada día de negocio (mismo horario de corte:
6am hora de Monterrey) y es independiente por sucursal — así sabes cuántos pedidos van en el
día con solo ver el número, sin tener que contar. Se muestra en la lista de pedidos, el ticket,
el cobro y el monitor de cocina.

La migración también le pone este número **retroactivamente** a todo lo que ya existe,
incluyendo el historial que acabas de importar.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-numero-dia.sql`.
3. Sube a GitHub: `server.js`, `public/pos/app.js`, `public/kds/app.js`.

**Si vuelves a importar historial más adelante**, corre de nuevo el bloque `UPDATE pedidos p SET
numero_dia = ...` de esa misma migración (la parte de abajo, sin el `ALTER TABLE`) para
renumerar todo correctamente con los pedidos nuevos incluidos.

## 19. Página pública para que los clientes pidan en línea

Nueva URL **`/pedir`** — una página aparte, sin nada del POS ni del panel de administración,
para que tus clientes armen su pedido desde su celular (como OlaClick, pero tuyo). Eligen
sucursal, si es para llevar o a domicilio (con el costo de envío calculado automático según su
colonia), navegan el menú igual que en el POS interno (con variantes y extras), ponen su nombre
y teléfono, y confirman.

En cuanto confirman, el pedido **aparece solo** en tu POS y en cocina — con sonido de aviso,
exactamente igual que si lo hubiera capturado un cajero. En la lista de pedidos se distingue con
una etiqueta **"🌐 En línea"** para que sepan que llegó de la página, no de mostrador.

El pago sigue siendo al recibir (efectivo, tarjeta o transferencia) — esto no procesa pagos en
línea, solo la toma del pedido.

Compárteles el link `tu-url.up.railway.app/pedir` a tus clientes (por WhatsApp, redes sociales,
etc.) — funciona en cualquier celular, no necesitan instalar nada.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-pedidos-web.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`, y la carpeta nueva
   `public/pedir/` completa.

## 20. Fotos de productos

En Menú → Productos, cada fila tiene ahora una miniatura a la izquierda — tócala (o el ícono
📷 si el producto todavía no tiene foto) para subir/cambiar la imagen. Se comprime sola en el
celular antes de guardarse, así que no pesa nada en la base de datos.

Las fotos se muestran automáticamente en:
- La toma de pedidos del POS (en vez del emoji genérico)
- La página pública `/pedir` para tus clientes

Si un producto no tiene foto todavía, sigue mostrando el emoji de su categoría como antes — no
es obligatorio subir todas de un jalón.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-imagen-producto.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`, `public/pedir/app.js`.

## 21. Contactar al cliente por WhatsApp con un toque

**Importante primero:** no es técnicamente posible mandar un mensaje automático "desde el
número del cliente" — ni la app oficial de WhatsApp ni su API lo permiten, solo el dueño de ese
número puede enviar desde ahí. Lo que sí se puede (y es lo que resuelve el mismo problema) es un
botón que abre WhatsApp **ya armado** con el resumen del pedido, listo para mandárselo al
cliente con un toque.

Aparece un botón verde **"📱 WhatsApp"** en:
- Cada pedido de la lista principal y del Historial (si tiene teléfono registrado)
- Dentro del ticket de cada pedido, junto a "Cambiar método de pago" / "Cancelar pedido"

Al tocarlo, abre WhatsApp (o WhatsApp Web en compu) con un mensaje ya escrito con el nombre del
cliente, número de pedido, productos, y el total — solo falta darle "Enviar". Si es domicilio,
también le pregunta si confirma su dirección.

No requiere ninguna migración de base de datos — solo sube `server.js`, `public/pos/index.html`
y `public/pos/app.js` a GitHub.

## Estructura del proyecto

```
pos-elnano/
  server.js          -> toda la API + Socket.io
  db/schema.sql       -> estructura de la base de datos
  db/seed.sql          -> sucursales y menú de ejemplo
  scripts/init-db.js   -> corre schema.sql + seed.sql
  public/pos/          -> pantalla de toma de pedidos
  public/kds/           -> pantalla de monitor de cocina
```
