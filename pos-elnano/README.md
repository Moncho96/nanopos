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

## 22. Corte de caja: ajuste automático por envíos pagados en efectivo

Resuelve el desfase que mencionaste: cuando un domicilio se cobra por transferencia/tarjeta
pero el repartidor se paga en efectivo, ahora el Corte lo calcula solo:

- A **Efectivo** le resta ese envío (salió efectivo de la caja sin haber entrado efectivo por
  ese pedido) → esto explica el "faltante" que veías.
- A **Tarjeta/Transferencia** le suma ese mismo monto como "pendiente de traspasar" → esto
  explica el "sobrante" en la cuenta.

Aparece una columna nueva **"Ajuste envío"** en la tabla del corte (roja en Efectivo, verde en
Tarjeta/Transferencia), y una nota amarilla abajo con el monto exacto que hay que traspasar de
la cuenta a la caja para que ambos cuadren. El "Debe haber" y el Cuadre de caja ya usan este
número ajustado automáticamente — así el conteo físico de efectivo va a coincidir con la
realidad, en vez de marcarte una diferencia que en realidad no es un error.

No requiere ninguna migración de base de datos — solo sube `server.js`, `public/pos/index.html`
y `public/pos/app.js` a GitHub.

## 23. Importar recetas en lote (CSV)

Nueva pestaña **"📋 Importar recetas"** (menú ☰): sube un CSV para dar de alta las recetas de
varios productos de un jalón, en vez de entrar producto por producto a Menú → 📋.

**Columnas del CSV** (con encabezado, en este orden):

```
producto,insumo,unidad,cantidad,costo_unitario_insumo
```

- `producto`: debe coincidir exactamente con el nombre en tu Menú actual.
- `insumo`: nombre del insumo. Si no existe todavía, se crea solo (con la unidad y costo que
  pongas en esta misma fila).
- `unidad`: solo se usa si el insumo es nuevo (kg, pza, l, etc.).
- `cantidad`: cuánto de ese insumo gasta **1 pieza/unidad base** del producto (no la orden
  completa — el multiplicador de variantes tipo "Orden" se sigue configurando aparte, en
  Menú → 📋 de cada producto).
- `costo_unitario_insumo`: opcional, para dar de alta o actualizar el costo del insumo.

Si un producto necesita varios insumos (ej. un taco con tortilla + carne + salsa), pon una fila
por cada insumo, repitiendo el mismo nombre de producto.

Te dejo `plantilla-recetas.csv` con todos tus productos reales ya listados como punto de
partida — los valores de insumo/cantidad/costo que traen algunos son solo **ejemplos
ilustrativos**, tienes que corregirlos con tus cantidades y costos reales antes de subirlo (o
puedes borrar esas filas y capturar las tuyas desde cero). Los productos que quedaron con las
columnas vacías (Piratacos, Refresco, Frijoles, Costras, etc.) los dejé sin ejemplo porque no
tengo referencia de su receta — agrégales tú las filas que necesiten.

No requiere ninguna migración de base de datos — solo sube `server.js`, `public/pos/index.html`
y `public/pos/app.js` a GitHub.

## 24. Reparto de utilidades entre socios

Nueva pestaña **"🤝 Reparto de utilidades"** (menú ☰): registras cada pago que le haces a cada
socio (fecha, monto, método, nota), y arriba se ve el acumulado de cada quien con su porcentaje
del total — para confirmar de un vistazo que van parejos en el 50/50 (o la proporción que
manejen).

Esto es aparte de "Gastos" a propósito: un reparto de utilidad no es un gasto del negocio, es
la salida de la utilidad ya generada hacia cada socio, así que no afecta el corte de caja ni las
ventas — es un registro independiente, solo para llevar cuentas claras entre ustedes.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-distribuciones.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`.

## 25. Catálogo de clientes + autocompletado por teléfono

Nueva pestaña **"👥 Clientes"** (menú ☰): lista todos los clientes que se han registrado (se
guardan solos cada vez que alguien da su teléfono al ordenar), con buscador por nombre,
teléfono o colonia, y edición/borrado directo ahí.

**Lo más útil de esto no es la lista en sí, sino esto:** al tomar un pedido nuevo, en cuanto
escribes un teléfono que ya está registrado, el sistema **autocompleta solo** el nombre y la
dirección/colonia del cliente — aparece un aviso "👤 Cliente conocido — datos completados" para
que sepas que pasó. Ya no hay que volver a preguntar los datos a clientes frecuentes.

Para activar esto no hace falta ninguna migración — la tabla de clientes ya existía. Solo sube
`server.js`, `public/pos/index.html` y `public/pos/app.js` a GitHub.

## 26. Cronómetro por pedido y tiempo promedio en cocina

En el KDS, cada ticket ahora trae un **cronómetro en vivo** (arriba a la derecha, junto al
número de pedido) que cuenta desde que se creó el pedido — verde los primeros 10 minutos,
amarillo de 10 a 15, y rojo pasado eso (ajustable en `app.js`, constantes
`UMBRAL_AMARILLO_MIN` / `UMBRAL_ROJO_MIN`). En cuanto se marca "listo", el cronómetro se
congela mostrando cuánto tardó en total.

Arriba de las columnas aparece una barra con el **tiempo promedio del día** — calculado con
los pedidos que ya se marcaron listos hoy, se actualiza solo cada minuto (y al instante cuando
se marca un pedido nuevo como listo).

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-tiempos-cocina.sql`.
3. Sube a GitHub: `server.js`, `public/kds/index.html`, `public/kds/app.js`.

Nota: el promedio solo cuenta pedidos marcados como "listo" — los que llevas capturando desde
antes de esta actualización no tienen esa marca de tiempo, así que el promedio empieza a
calcularse desde que actives esto.

## 27. Ajustes tras el primer día real: categorías/variantes editables, WhatsApp completo, y pagar sin cerrar el pedido

**Menú → Productos**: ahora hay una tabla de categorías arriba de los productos, con editar
(nombre) y borrar (bloquea si todavía hay productos usándola, para no dejar productos huérfanos).

**Menú → 📋 de cada producto** (ahora dice "Receta y variantes"): cada grupo de variantes/extras
trae nombre y precio editables por opción, botón para borrar cada opción, botón para borrar el
grupo completo, un mini-formulario para agregar una opción nueva a un grupo existente, y otro
para crear un grupo nuevo desde cero (con su tipo variante/extra y si es obligatorio).

**Mensaje de WhatsApp**: ahora trae una estructura fija arriba — nombre, teléfono, dirección (si
es domicilio) y tipo de pedido — antes de la lista de productos y el total.

**Pagar sin cerrar el pedido**: ya puedes cobrar un pedido (parcial o completo) y seguir
agregándole productos después — el pedido ya no se bloquea al cobrarse, solo se bloquea cuando
se marca como **entregado** en cocina. Si agregas algo después de cobrar y el total ya no
alcanza con lo pagado, el pedido regresa solo a "Por cobrar", y al tocar "Pago" otra vez te deja
completar justo lo que falta (no te vuelve a cobrar todo desde cero). En la lista principal ahora
se ven dos etiquetas por pedido: una de pago (✅/⏳) y otra de cocina (🟡🔵🟢), para saber de un
vistazo qué le falta a cada uno.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"** (o Console si te marca el error de
   `LIMIT`, ya sabes cómo es).
2. No requiere migración nueva — todos los cambios usan tablas y columnas que ya existían.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`.

## 28. Cocina: agregar productos a un pedido ya entregado

Corrige el bug donde, si agregabas un producto a un pedido de mesa después de que ya se había
entregado todo lo demás, el producto nuevo se quedaba escondido junto con lo viejo en la columna
"Entregado" — la cocina nunca se enteraba de que había algo nuevo por preparar.

Ahora, al agregar un producto a un pedido que ya estaba "Listo" o "Entregado":
- El pedido se **reabre solo** y vuelve a aparecer en la columna "Recibido" (con sonido de aviso).
- El ticket muestra **solo lo nuevo** — los productos que ya se habían entregado no se repiten.
- Aparece una etiqueta amarilla "🔄 Se agregó algo nuevo a este pedido" para que la cocina sepa
  que es una mesa que ya había recibido parte de su comida.

No requiere ninguna migración de base de datos — usa una columna que ya existía
(`pedido_items.estado`) pero que nunca se había aprovechado. Solo sube `server.js`,
`public/kds/app.js` a GitHub.

## 29. Sistema de reseñas, con filtro hacia Google Maps

Nueva página pública **`/resena`** — mandas a un cliente su link personal, califica de 1 a 5
estrellas y deja un comentario opcional. Si califica con **4 o 5 estrellas**, le aparece un botón
para compartir la misma reseña en Google Maps; si califica 1-3, solo se queda contigo (para que
puedas atender la queja en privado, sin que se vuelva pública).

**Cómo mandarlo:** dentro de cualquier pedido ya cobrado con teléfono registrado, aparece el
botón "⭐ Pedir reseña" — genera un link único para ese pedido y abre WhatsApp con el mensaje ya
armado, listo para mandar.

**Panel "⭐ Reseñas"** (menú ☰): pega el link de "Escribir una reseña" de tu ficha de Google Maps
de cada sucursal (lo sacas desde tu perfil de Google Business, opción "Pedir reseñas"), para que
el botón de 4-5 estrellas funcione. Abajo se ve el promedio y cada reseña individual.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-resenas.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`, y la carpeta nueva
   `public/resena/` completa.

## 30. Sistema de lealtad: puntos y recompensas editables

Por cada **$10 de compra** (sin contar envío) en un pedido pagado con teléfono registrado, el
cliente gana **1 punto** automático — sin que nadie tenga que hacer nada. Si el pedido se cancela
o deja de estar cubierto (por ejemplo, se agregó algo después de cobrar), los puntos se ajustan
o se quitan solos.

**Panel "🎁 Lealtad"** (menú ☰): defines las recompensas — nombre, cuántos puntos cuesta, y
cuánto descuento da (ej. "Descuento de $50" por 100 puntos). Se pueden editar, desactivar o
borrar en cualquier momento; ya vienen 2 de ejemplo para empezar.

**Al editar un pedido con cliente registrado**, aparece su saldo de puntos y un botón
"🎁 Canjear puntos" — solo se muestran las recompensas que el cliente ya puede pagar con lo que
tiene acumulado. El descuento se aplica directo al total del pedido (se ve desglosado, como el
envío), y se puede quitar el canje si fue un error (regresa los puntos al cliente).

El catálogo de **Clientes** ahora también muestra cuántos puntos tiene cada quien.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-lealtad.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`.

## 31. Corrección: "Entregado" (cocina) ya no bloquea cobrar/editar el pedido

Eran la misma cosa por error: cuando cocina marcaba un pedido como "Entregado", el POS lo
bloqueaba por completo — impidiendo cobrarlo o agregarle algo, aunque la mesa siguiera abierta.
Ahora son dos cosas independientes:

- **Estado de cocina** (Recibido/En preparación/Listo/Entregado): solo dice si la comida ya
  salió de cocina. Ya no bloquea nada en el POS.
- **Finalizado**: se marca únicamente con el botón "✅ Finalizar pedido" — hasta ese momento el
  pedido se puede seguir editando y cobrando sin importar qué tan avanzado esté en cocina.

La pantalla principal ahora muestra pedidos pendientes hasta que se **finalicen** (no hasta que
salgan de cocina), y cada fila trae la etiqueta de cocina siempre visible (incluido "✅
Entregado") junto a la de cobro, para que sepas de un vistazo en qué va cada uno.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-finalizado.sql`.
3. Sube a GitHub: `server.js`, `public/pos/app.js`.

## 32. Seguridad: contraseña compartida para el personal

Ya no cualquiera con el link puede entrar a `/pos` o `/kds`, ni tocar los endpoints
administrativos (menú, inventario, corte, clientes, etc.) — ahora piden una contraseña
compartida antes de dejar entrar.

**Lo que sigue público a propósito** (los clientes no deben necesitar contraseña):
- `/pedir` — para que tus clientes hagan pedidos
- `/resena` — para que dejen su reseña
- El webhook de DiDi (`/api/didi/webhook`)

**Cómo se activa:**

1. En Railway, ve al servicio de tu **código** → pestaña **"Variables"**.
2. Agrega una variable nueva: `POS_PASSWORD` con la contraseña que quieras usar (compártela
   solo con tu personal de confianza).
3. También agrega `SESSION_SECRET` con cualquier texto largo y aleatorio (por ejemplo, genera
   uno en [randomkeygen.com](https://randomkeygen.com) y pega cualquiera de las opciones) — esto
   es solo para que la sesión sea segura, no necesitas recordarlo.
4. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`, y la carpeta nueva
   `public/login/` completa.
5. En cuanto Railway redespliegue, entra a `/pos` — te va a mandar a una pantalla de login. Pon
   la contraseña que configuraste en `POS_PASSWORD` y ya queda guardada en esa tablet por 90
   días (no hay que volver a escribirla cada vez que abren la app).

**Para cerrar sesión** (por ejemplo, si cambias la contraseña o alguien deja de trabajar ahí):
menú ☰ → "🚪 Cerrar sesión", al final del todo.

**Nota importante:** esto es una contraseña **compartida** para todo el personal — no sabe
quién exactamente hizo cada acción. Si más adelante quieres un PIN por cada empleado (para saber
quién canceló qué pedido, por ejemplo), es un paso natural desde aquí y usamos la misma base que
ya construimos hoy.

## 33. Empleados con PIN y permisos por puesto

Reemplaza la contraseña compartida por un **PIN de 4 dígitos por empleado**, con 3 puestos:

- **Mesero**: toma y edita pedidos (agregar/quitar productos), nada más.
- **Cajero**: todo lo del mesero, más cobrar, cancelar pedido completo, finalizar pedido,
  canjear puntos de lealtad, y el corte de caja (ver y cerrar).
- **Encargado**: acceso total — Menú (productos/insumos/recetas/variantes), inventario, compras,
  reportes, reparto de utilidades, configuración de envíos/Google/lealtad, y el panel de
  Empleados.

El menú lateral se acomoda solo según el puesto de quien entró — un mesero ni siquiera ve los
botones de las secciones que no le tocan. Los botones del ticket (Pago, Cancelar, Finalizar,
Cambiar método, Canjear puntos) también se esconden para mesero. Por seguridad, todo esto
también está bloqueado del lado del servidor (no solo escondido en pantalla) — aunque alguien
intente llamar a esos endpoints directamente, el servidor los rechaza si el puesto no tiene
permiso.

**Cómo entrar por primera vez (arranque):** mientras no hayas dado de alta ningún empleado
todavía, puedes entrar con el PIN maestro — que es el mismo valor que pongas en la variable
`POS_PASSWORD` de Railway (la que ya tenías configurada de la contraseña compartida anterior).
Entra con eso, ve a menú ☰ → "🧑‍💼 Empleados" (visible porque entraste como encargado), da de
alta a tu personal real con sus PINs, y de ahí en adelante cada quien entra con el suyo.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-empleados.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`, `public/login/index.html`, `public/login/app.js`.

## 34. Acceso por sucursal, por empleado

En Empleados, ahora cada quien también tiene una **sucursal asignada** (o "Todas", pensado
para el encargado). Si un empleado tiene una sucursal fija:

- El selector de sucursal en `/pos` y `/kds` se le bloquea, ya fijo en la suya — ni puede
  cambiarlo ni ver pedidos de la otra sucursal en las listas.
- El servidor también lo bloquea si intenta forzar una llamada a la otra sucursal (cobrar,
  cancelar, ver reportes, etc.) — no es solo un candado visual.
- El encargado (sin sucursal asignada) sigue viendo y accediendo a ambas, como antes.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-empleados-sucursal.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`, `public/kds/app.js`.
4. En menú ☰ → "🧑‍💼 Empleados", edita a cada quien y asígnale su sucursal (o déjala en
   "Todas" si de verdad necesita ver ambas).

## 35. Informes: dashboard de KPIs

Nueva pestaña **"📈 Informes"** (menú ☰, cajero o encargado): elige un rango de fechas (con
accesos rápidos "Hoy" / "Esta semana" / "Este mes", o fechas manuales) y ve de un jalón:

- **KPIs principales**: ventas, pedidos cobrados, ticket promedio, % de cancelados, tiempo
  promedio en cocina, calificación promedio de reseñas.
- **Resumen financiero**: ventas menos gastos registrados menos descuentos de lealtad (no
  incluye el costo de los insumos consumidos, solo lo que ya se registra en el sistema).
- **Ventas por día** (para ver la tendencia del periodo).
- **Ventas por método de pago** y **por tipo de pedido** (mesa/para llevar/domicilio).
- **Top 10 productos más vendidos** (cantidad y dinero generado).
- **Clientes nuevos** en el periodo.

Respeta el selector de sucursal de arriba (si eliges una sucursal, todo se filtra a esa; si el
empleado tiene sucursal asignada, ya viene fijo ahí). No requiere ninguna migración de base de
datos — solo sube `server.js`, `public/pos/index.html`, `public/pos/app.js` a GitHub.

## 36. Cambiar el tipo de un pedido ya creado

Dentro de cualquier pedido editable, aparece el botón **"🔄 Cambiar tipo"** — para cuando un
cliente dijo domicilio y al final pasa por él, o al revés. Si cambias a domicilio, te pide la
colonia para calcular el costo de envío solo (igual que al crear un pedido nuevo); si cambias a
mesa o para llevar, el envío se quita solo y el total se recalcula.

No requiere ninguna migración de base de datos — solo sube `server.js`, `public/pos/index.html`,
`public/pos/app.js` a GitHub.

## 37. Etiquetas de comentarios por producto

Al agregar cualquier producto a un pedido, ahora sale una sección de **"Comentarios"** con
chips rápidos ("Sin queso", "Sin cebolla", "Poco aceite", etc.) para tocar sin teclear, más un
campo de texto libre por si sale algo distinto. El comentario se ve junto al producto en el
ticket del POS y, lo más importante, **destacado en amarillo en la pantalla de Cocina** para que
el cocinero lo note de inmediato.

**Las etiquetas se configuran por categoría** (no producto por producto, para no repetir la
misma lista veinte veces) — en Menú → Productos, cada categoría tiene un botón 🏷️ para
agregar/quitar sus etiquetas. Ya te dejé precargadas algunas de ejemplo con base en lo que
mencionaste (tacos: sin cebolla/sin aceite/poco aceite; volcanes-piratas y hamburguesas: sin
queso/sin cebolla) — edítalas o bórralas como quieras.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-etiquetas.sql`.
3. Sube a GitHub: `server.js`, `public/pos/app.js`, `public/kds/app.js`.

## 38. Control de entregas a domicilio y repartidores

Dentro de cualquier pedido a domicilio (que no esté finalizado), aparece una sección
**"🛵 Control de envío"**:

1. **Pon con cuánto paga el cliente** (ej. $500 para un pedido de $300) — calcula el cambio
   solo ($200), para que el repartidor sepa cuánto llevar.
2. **"📤 Enviar a grupo de WhatsApp"** — arma el mensaje completo (cliente, dirección,
   productos con sus comentarios, total, y cuánto cambio dar) y abre WhatsApp directo en la
   pantalla de elegir a quién mandárselo — tú solo tocas tu grupo de repartidores de la lista,
   ya no hay que escribir ni copiar nada.
3. **Elige el repartidor** que se lo lleva (de un catálogo que administras en menú ☰ → "🛵
   Repartidores") y dale **"Asignar"** — queda registrado quién se llevó cada pedido, visible
   como etiqueta en la lista principal.
4. Cuando el repartidor regresa con el dinero, **"✅ Liquidar entrega"** — marca el pedido como
   liquidado y, si quieres, registra automáticamente el gasto del pago de su envío (para que
   ya quede reflejado en Gastos y en el corte de caja).

Mesero y cajero pueden asignar repartidor y mandar el mensaje; liquidar la entrega y administrar
el catálogo de repartidores es nivel cajero/encargado (maneja dinero en efectivo).

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-repartidores.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`.

## 39. Profit First integrado

Nuevo panel **"💰 Profit First"** (menú ☰, solo encargado) con las 7 categorías que pediste:
Opex, Nómina, Impuestos, Sueldo dueño, Renta, Aguinaldo y Utilidad — cada una con su
porcentaje (editable) y su saldo acumulado.

**Cómo se reparte solo:** cada vez que cierras un corte de caja (de cualquiera de las dos
sucursales), el total contado de ese corte se reparte automáticamente entre estas categorías
según su porcentaje — sin que tengas que hacer nada. Si corriges un corte ya cerrado, el reparto
viejo se reemplaza por el nuevo, no se duplica.

**Registrar gastos por categoría:** cada tarjeta trae su propio mini-formulario (monto +
descripción) para registrar un gasto contra ese sobre específico — por ejemplo, pagar la renta
del mes se resta del saldo de "Renta", la nómina de la quincena del saldo de "Nómina", etc.

**Se conecta solo con el Reparto de utilidades** que ya tenías: cada vez que registras un
reparto a un socio, se descuenta automático del saldo de "Utilidad" — así ese sobre siempre
refleja lo que de verdad queda disponible para repartir.

Los porcentajes de ejemplo que te dejé cargados (Opex 40%, Nómina 25%, Impuestos 10%, Sueldo
dueño 10%, Renta 8%, Aguinaldo 2%, Utilidad 5%) son solo un punto de partida — ajústalos a los
que ya manejas tú.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-profit-first.sql`.
3. Sube a GitHub: `server.js`, `public/pos/index.html`, `public/pos/app.js`.

## 40. Importar respaldo del sistema anterior de Profit First

Dentro del panel "💰 Profit First", botón **"📥 Importar respaldo del sistema anterior"** — sube
tu archivo JSON de caja chica (el que traía metas diarias/semanales/mensuales en vez de
porcentajes) y lo traduce solo a movimientos en las categorías actuales:

| Tu sistema anterior | Categoría actual |
|---|---|
| Nómina | Nómina |
| Impuestos | Impuestos |
| Sueldo | Sueldo dueño |
| Fijos | Renta |
| Aguinaldo | Aguinaldo |
| Utilidad | Utilidad |
| *(no existía)* | Opex — se queda sin historial |

Convierte las metas (`nominaWeekly`, `taxDaily`, etc.) en un ingreso diario prorateado por cada
día que tenías registrado, resta lo que ya se había pagado de cada uno (`nominaPagada`,
`impPagado`, etc.), y trae los saldos iniciales (`initNomina`, `initImpuestos`, etc.) como punto
de partida. Si tu respaldo traía un reparto grande de utilidad, también lo mete al historial de
"Reparto de utilidades" — como no se sabe cómo se dividió entre tú y tu papá en ese momento,
queda marcado como "Importado (revisar división)" para que lo corrijas si hace falta.

Tiene un seguro contra importar dos veces por accidente — si ya detecta datos importados antes,
no deja repetirlo sin avisarte primero.

No requiere ninguna migración nueva de base de datos (usa las tablas que ya creamos para Profit
First) — solo sube `server.js`, `public/pos/index.html`, `public/pos/app.js` a GitHub.

## 41. Ventas de DiDi en el corte (manual, mientras no esté integrado)

En "Cuadre de caja" (dentro del Corte), aparece un campo morado **"🛵 Ventas DiDi de hoy"**
para capturar a mano lo que vendiste por esa plataforma — ya que como no está integrada al
sistema todavía, no hay forma de que se calcule solo. No afecta el cuadre de
efectivo/tarjeta/transferencia (ese dinero nunca pasa por tu caja física), pero:

- Queda guardado en el historial de cada corte, para que no se te pierda el dato.
- **Si se incluye en el reparto de Profit First** — el día que cierras el corte, tus sobres
  también reciben su porcentaje sobre esta venta de DiDi, no solo sobre lo contado en caja.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-corte-didi.sql`.
3. Sube a GitHub: `server.js`, `public/pos/app.js`.

## 42. Separación en dos páginas: POS (operativo) + Administración (tipo ERP)

Con todo lo que se le fue agregando, el POS se había saturado de paneles que casi nunca se usan
durante el turno normal. Ahora está dividido en dos páginas independientes:

**`/pos`** — solo lo operativo del día a día: tomar/editar pedidos, cobrar, cancelar/finalizar,
control de envío a domicilio, WhatsApp/reseñas por pedido, canjear puntos de lealtad, Historial
de pedidos y Corte de caja. El menú lateral quedó mucho más corto.

**`/admin`** — todo lo administrativo/estratégico, como un mini-ERP aparte: Menú (productos,
insumos, recetas, variantes, etiquetas), Conteo de inventario, Registrar compra, Planeación de
compras, Informes, Profit First, Reparto de utilidades, Lealtad (crear recompensas), Reseñas
(config. de Google), Catálogo de clientes, Repartidores, Empleados, Envíos por colonia,
Importar historial e Importar recetas. Se abre desde un tablero de mosaicos, no un menú lateral
largo.

Un botón "⚙️ Administración" en el menú del POS lleva a `/admin`, y un botón "🏪 Ir al POS" en el
header de Admin regresa — igual que ya existía entre POS y Cocina. Ambas páginas comparten la
misma sesión (no hay que volver a iniciar sesión al cambiar), el mismo modo oscuro, y el mismo
sistema de permisos por puesto: mesero no puede entrar a `/admin` en absoluto (ni por link
directo — el servidor lo bloquea), cajero ve una parte (Informes, Clientes, Repartidores), y
encargado ve todo.

**No requiere ninguna migración de base de datos** — es puramente una reorganización de
archivos. Sube a GitHub:
- `server.js`
- `public/pos/index.html` y `public/pos/app.js` (reemplaza los que ya tenías)
- La carpeta nueva **`public/admin/`** completa (index.html, app.js, manifest.json, sw.js,
  icon-192.png, icon-512.png)

Como es un cambio grande (dividir un archivo de más de 4,000 líneas en dos), pruébalo con calma
recorriendo cada sección del menú de Administración antes de un turno con mucha gente — si algo
no carga o da un error, dime exactamente en qué pantalla pasó y lo reviso de inmediato.

## 43. Menú independiente por sucursal

Categorías y productos ya no se comparten entre Santa María y Mitras Poniente — cada sucursal
tiene su propio menú completo (productos, precios, categorías, recetas, variantes y etiquetas),
editable de forma totalmente independiente desde Admin → Menú, respetando la sucursal que
tengas elegida arriba.

**Ganancia y gastos por sucursal ya los tenías** — el panel de Informes y el Corte de caja ya
filtraban por sucursal desde antes; esto no cambió, solo se aclara aquí porque lo mencionaste.

**Para no capturar el menú dos veces**, en Admin → Menú hay un cuadro amarillo con "Copiar
menú" — eliges sucursal de origen y destino, y copia categorías, productos, recetas, variantes
y etiquetas completas de una hacia la otra (no borra nada de la sucursal destino, solo agrega).
Úsalo una sola vez al principio como punto de partida; de ahí en adelante edita cada sucursal
por separado según lo que realmente vendan distinto.

**Importante sobre costos de insumos:** el catálogo de insumos (nombre, costo unitario) sigue
siendo compartido entre ambas sucursales — solo el **stock** ya era independiente por sucursal
desde antes. Si tus insumos de verdad cuestan distinto entre una sucursal y otra (proveedores
diferentes, por ejemplo), avísame y separamos eso también — no lo toqué en este cambio para no
hacerlo aún más grande.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-menu-por-sucursal.sql` — esto asigna todo tu
   menú actual a la primera sucursal (normalmente Santa María). Mitras Poniente arrancará sin
   menú hasta que uses "Copiar menú" o captures el suyo desde cero.
3. Sube a GitHub: `server.js`, `public/pos/app.js`, `public/admin/index.html`,
   `public/admin/app.js`, `public/pedir/app.js`.
4. Entra a Admin → Menú, revisa que tu sucursal actual tenga su menú completo, y usa "Copiar
   menú" hacia la otra sucursal para no volver a capturar todo desde cero.

## 44. Borrar productos del menú (definitivo, no solo ocultar)

En Admin → Menú → Productos, cada fila ahora trae un botón 🗑️ para **borrar de verdad** el
producto — distinto del 👁️/🚫 que ya existía (ese solo lo oculta, conservando su historial).

Tiene un seguro automático: si el producto **ya se usó en algún pedido**, el borrado falla solo
(la base de datos lo bloquea a propósito) y te avisa que uses el botón de ocultar en su lugar,
para no perder ese historial. Solo se puede borrar de verdad un producto que nunca se ha
vendido — por ejemplo uno que capturaste mal o de prueba.

No requiere ninguna migración de base de datos — solo sube `server.js` y `public/admin/app.js`
a GitHub.

## 45. Profit First con el estilo de "ticket de caja chica"

El panel de Profit First ahora tiene la misma paleta y look de "ticket de papel" de tu sistema
anterior (fondo color papel, bordes punteados, tipografía monoespaciada, y cada categoría con su
color: Opex en azul peltre, Nómina en achiote, Impuestos en chile, Utilidad en aguacate, Sueldo
dueño en peltre oscuro, Renta en masa, Aguinaldo en vino) — incluyendo el borde zigzag de recibo
entre secciones. Toda la funcionalidad real (editar porcentajes, registrar gastos/ingresos,
reparto automático al cerrar corte, importar respaldo) se quedó igual, solo cambió el vestido.
También respeta el modo oscuro.

No requiere ninguna migración de base de datos — solo sube `public/admin/index.html` y
`public/admin/app.js` a GitHub.

## 46. Profit First: interfaz más limpia, y límites opcionales por categoría

**Tarjetas más simples:** ya no se ven 3 campos y botones siempre abiertos — cada categoría
muestra solo su saldo y, si quieres registrar algo, tocas "+ Movimiento" para que aparezca el
formulario (se oculta de nuevo solo). El porcentaje y el nuevo límite se configuran aparte,
detrás del botón **⚙️** de cada tarjeta, para no saturar la vista principal.

**Límites (topes) opcionales:** en el engranaje de cada categoría puedes ponerle un tope — por
ejemplo, que "Aguinaldo" deje de recibir dinero en automático al llegar a $25,000. Si lo dejas
vacío, la categoría sigue siendo libre y suma sin límite, como hasta ahora. Cuando tiene tope,
se ve una barrita de progreso con el color de esa categoría.

El reparto automático al cerrar un corte ya respeta esto: si una categoría está a punto de
llegar a su tope, solo le mete lo que le falta para llegarle justo, no de más.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-profit-first-limite.sql`.
3. Sube a GitHub: `server.js`, `public/admin/app.js`.

## 47. Rediseño de `/pedir`: tipo de servicio al final, y detecta clientes con puntos

**El flujo cambió de orden**, para que sea más intuitivo:

1. El cliente navega el menú y arma su carrito (sin elegir tipo de servicio todavía).
2. Al tocar "Ver carrito", primero pone su **teléfono y nombre** — en cuanto el teléfono tiene
   10 dígitos, el sistema busca solo si ya es cliente conocido. Si lo es, le completa el nombre
   y, si tiene puntos de lealtad, le aparece un cuadro morado con sus puntos y las recompensas
   que ya puede canjear — las elige tocándolas, y el descuento se aplica directo al total.
3. Hasta aquí elige **"Para llevar" o "A domicilio"** — ya con el pedido armado, que es cuando
   de verdad tiene sentido decidirlo. Si es domicilio, ahí mismo le pide colonia y dirección.
4. Confirma, con el total ya con envío y descuento de lealtad incluidos si aplican.

Esto resuelve justo el problema que mencionaste: antes el cliente elegía "para llevar" muy al
principio, sin haber terminado de decidir su pedido, y terminaba pidiendo domicilio por error.

No requiere ninguna migración de base de datos — solo sube `server.js`, `public/pedir/index.html`
y `public/pedir/app.js` a GitHub.

## 48. Aviso sonoro de pedido nuevo en el POS (con "Aceptar")

Corrige que el aviso de pedido nuevo casi nunca sonaba de verdad — el motivo era que los
navegadores bloquean el audio hasta que el usuario toca algo en la pantalla, y el código viejo
creaba un `AudioContext` nuevo cada vez (siempre bloqueado). Ahora se desbloquea una sola vez,
en la primera interacción con la página, y de ahí en adelante sí suena.

**Cómo funciona:** al llegar un pedido nuevo (de `/pedir` o capturado en otra caja), suena una
campanita de dos tonos (no un beep seco) y aparece un banner verde arriba "🔔 Nuevo pedido" con
botón **"Aceptar"**. Mientras nadie lo acepte, la campanita se repite cada 4 segundos — ni tan
seguido que estrese, ni tan espaciado que se pase desapercibido. En cuanto tocas "Aceptar", para
de sonar y el banner desaparece. Si llegan varios pedidos antes de aceptar, el banner cuenta
cuántos van ("🔔 3 pedidos nuevos") y "Aceptar" los reconoce todos de un jalón.

No requiere ninguna migración de base de datos — solo sube `public/pos/index.html` y
`public/pos/app.js` a GitHub.

## 49. Ranking de repartidores (desempeño)

Dentro de Admin → Repartidores, pestaña **"🏆 Desempeño"**: elige un rango de fechas (con los
mismos accesos rápidos "Hoy"/"Esta semana"/"Este mes" que Informes) y ve:

- Tarjetas con cada repartidor ordenado de mayor a menor número de pedidos entregados en ese
  rango (con medallas 🥇🥈🥉 para los primeros 3), más lo que generaron en ventas.
- Una tabla de **pedidos por día**, repartidor por fila y cada día del rango como columna, para
  ver el detalle completo y repartir premios con datos reales en la mano.

Cuenta los pedidos a domicilio que cada repartidor tiene asignados (no cancelados) en el rango
elegido, usando la fecha en que se le asignó el pedido.

No requiere ninguna migración de base de datos — solo sube `server.js`, `public/admin/index.html`
y `public/admin/app.js` a GitHub.

## 50. Premios semanales para repartidores

Dentro de Admin → Repartidores → 🏆 Desempeño, arriba de las tarjetas de ranking aparece
**"🏆 Premio de este rango"** con el top 3 y el monto que le toca a cada quien, más un botón
**"Marcar pagado"** — lo registra en el historial (no deja pagarlo dos veces para el mismo
rango de fechas) y, si quieres, lo registra de una vez como gasto en el corte de esa sucursal.

Los montos del premio (1er, 2do y 3er lugar) se configuran con el botón **"⚙️ Premios"** junto
al buscador de fechas — vienen $300/$150/$100 de ejemplo, cámbialos a los que decidas usar.

Para activar esto en tu base de datos ya desplegada:

1. Railway → servicio de Postgres → pestaña **"Data"**.
2. Copia y corre el contenido de `db/migracion-premios-repartidores.sql`.
3. Sube a GitHub: `server.js`, `public/admin/index.html`, `public/admin/app.js`.

## 51. Logo real y temporadas que cambian solas

**Logo:** ya está integrado en todas las pantallas (POS, Cocina, Administración, Pedidos en
línea, Login) y también como ícono de la app instalada en pantalla de inicio — reemplaza al
placeholder genérico "EN" que se usó antes de que me pasaras el logo real.

**Temporadas automáticas:** un script compartido (`temporada.js`) revisa la fecha de hoy y le
agrega al header una franjita de color y un emoji de temporada — sutil, no estorba la operación
del día a día. Cambia solo, sin que tengas que tocar nada:

- **Octubre – 2 de noviembre:** Día de Muertos / Halloween 💀 (naranja y morado)
- **Diciembre – 6 de enero:** Navidad 🎄 (verde, dorado, rojo)
- **10-20 de septiembre:** Fiestas Patrias 🇲🇽 (verde, blanco, rojo)
- **1-14 de febrero:** San Valentín 💘 (rosa)
- **1-10 de mayo:** Día de las Madres 💐 (rosa/verde)
- Resto del año: colores normales de la marca, sin decoración

Si quieres agregar, quitar o ajustar fechas de alguna temporada, está todo en un solo lugar
(`temporada.js`, la función `obtenerTemporadaActual`) — dime qué cambio quieres y lo ajusto.

No requiere ninguna migración de base de datos — solo sube las carpetas `public/pos/`,
`public/kds/`, `public/admin/`, `public/pedir/`, `public/resena/` y `public/login/` completas
(cada una ya trae su logo, íconos nuevos y el script de temporada).

## 52. Editar un corte ya cerrado (para corregir errores de captura)

En Corte de caja, si consultas una fecha que ya se había cerrado, ahora aparece el botón
**"✏️ Editar este corte (por si se capturó mal)"** — te regresa al formulario, ya prellenado
con los montos que se habían capturado antes, para que los corrijas. Al guardar, reemplaza lo
que había (no se duplica ni se suma), y puedes cancelar sin guardar si solo querías consultarlo.

El backend ya soportaba esto desde que se construyó el corte (vuelve a cerrar la misma fecha sin
problema) — lo que faltaba era la forma de llegar a ese formulario una vez que el corte ya
estaba cerrado, que es justo lo que se agregó aquí.

No requiere ninguna migración de base de datos — solo sube `public/pos/app.js` a GitHub.

## 53. Gastos por caja de Profit First (fuera del corte)

Nuevo mosaico **"💸 Gastos por caja"** en Administración (solo encargado, igual que Profit
First). Ahí registras un gasto eligiendo la **caja** (Opex, Nómina, Impuestos, Sueldo dueño,
Renta, Aguinaldo o Utilidad), el monto, la fecha, la descripción y con qué se pagó.

- **No toca el corte de caja:** vive aparte, no afecta el cuadre de efectivo/tarjeta/transferencia.
- **Descuenta de la caja elegida** en Profit First automáticamente, y en el selector ves el saldo
  actual de cada una antes de registrar.
- **Queda por sucursal** — se registra en la sucursal que tengas elegida arriba, y la lista
  (con filtros Hoy / Esta semana / Este mes) muestra total del periodo y desglose por caja.
- **Borrar un gasto le regresa el dinero a su caja** — gasto y descuento van siempre sincronizados.
- **Informes lo cuenta:** el "Resultado del periodo" ahora resta también estos gastos
  (línea nueva "Gastos por caja (Profit First)"). Ojo: si registras el mismo gasto aquí y también
  en el corte, se contaría dos veces — elige uno de los dos lugares para cada gasto.

Para activar esto en tu base de datos ya desplegada:

1. Railway → Postgres → **Console** (corre `psql` primero) o **Data**, y pega el contenido de
   `db/migracion-gastos-profit-first.sql`.
2. Sube a GitHub: `server.js`, `public/admin/index.html`, `public/admin/app.js`.

## 54. Excedente de cajas topadas (ya no se pierde)

Antes, cuando una caja con tope ya estaba llena, su parte del corte dejaba de registrarse en
Profit First y desaparecía. Ahora **se va a otra caja**: por defecto **Utilidad**, y cada caja
puede tener su propio destino desde el engranaje ⚙️ ("Cuando llegue al tope, el excedente se va a").

- Si a la caja le faltan $50 para su tope y le tocaban $200, recibe $50 y los otros $150 pasan
  a su destino (el movimiento queda en el historial como "Excedente de X (tope alcanzado)").
- Si el destino también está lleno, el excedente sigue al destino de ese destino. Si se acaba la
  cadena, lo absorbe la última caja aunque rebase su tope — es preferible a perder el dinero.
- La suma de los movimientos de un corte siempre cuadra con lo vendido ese día.
- En la tarjeta de cada caja con tope se ve "excedente → Utilidad" (o el destino que elijas).
- **Único caso sin destino:** si la propia caja Utilidad tiene tope y está llena, su parte no
  tiene a dónde ir y queda sin asignar (se avisa en el log del servidor). Lo normal es dejar
  Utilidad sin tope.

Los cortes ya cerrados antes de este cambio no registraron ese excedente. Para recuperarlo,
vuelve a abrir cada corte con "✏️ Editar" y guárdalo de nuevo: el reparto se recalcula.

Para activar esto en tu base de datos ya desplegada:

1. Railway → Postgres → pega y corre `db/migracion-profit-first-excedente.sql`.
2. Sube a GitHub: `server.js`, `public/admin/app.js`.

## 55. Corrección: "Cerrar sesión" y menú ☰

Al separar el sistema en POS y Administración se quedaron dos botones sin conectar:
**"🚪 Cerrar sesión" en el POS** (existía pero no hacía nada) y **el botón ☰ en Administración**
(no abría el menú, donde vive su "Cerrar sesión" y el acceso al POS). Ambos ya funcionan.
No requiere migración — solo sube `public/pos/app.js` y `public/admin/app.js`.

## 56. Corrección: pedidos de otra sucursal apareciendo en Cocina

**Síntoma:** a veces la pantalla de Cocina de una sucursal mostraba pedidos de la otra, y se
quitaban al recargar. **Causa:** al cambiar de sucursal, el servidor metía a la pantalla en la
nueva "sala" pero nunca la sacaba de la anterior, así que seguía recibiendo ambas. Corregido en
tres capas:

- **Servidor:** al unirse a una sucursal, sale primero de cualquier otra (probado con Socket.io
  real: antes recibía [Santa María, Mitras], ahora solo Mitras).
- **Cocina y POS:** ignoran cualquier pedido cuya sucursal no sea la que tienen en pantalla
  (también evita que suene el aviso de "nuevo pedido" por uno de la otra sucursal).
- **Cocina:** si se corta la conexión (tablet que se duerme, wifi), vuelve a unirse a su sala y
  recarga el tablero al reconectar. Además recuerda la última sucursal elegida en ese dispositivo
  (como el POS), en vez de arrancar siempre en la primera de la lista.

No requiere migración — sube `server.js`, `public/kds/app.js` y `public/pos/app.js`.

## 57. Dashboard comparativo de sucursales

Nuevo mosaico **"📊 Dashboard"** en Administración (solo encargado). Compara **las dos sucursales
juntas y por separado** y muestra cómo evolucionan:

- **Tarjetas del combinado:** ventas totales, pedidos, ticket promedio y resultado estimado (con
  margen), cada una con una flecha ▲▼ contra el **periodo anterior de la misma duración** (verde =
  mejoró, rojo = empeoró; en gastos, cancelados y tiempo, subir es malo y se pinta rojo).
- **Evolución en el tiempo:** gráfica de líneas con el combinado y cada sucursal, y un selector de
  métrica (Ventas · Pedidos · Ticket · Gastos · Resultado). Se agrupa por día, semana (lunes a
  domingo) o mes — automático según el rango, o lo eliges tú.
- **Tabla comparativa** (Combinado | cada sucursal), con su cambio vs. el periodo anterior: ventas
  (mostrador/web y DiDi por separado), pedidos, ticket, % a domicilio, % en línea, clientes
  distintos, gastos, resultado, margen, % cancelados, tiempo hasta estar listo, reseña promedio y
  descuadre en cortes.
- **Ventas promedio por día de la semana** por sucursal, con el mejor y el peor día (útil para
  atacar la diferencia entre entre-semana y fin de semana).
- Accesos rápidos: Este mes · 30 días · 90 días · 6 meses · Este año, o fechas a mano.

**Cómo se calcula:** ventas totales = pedidos cobrados (ya con descuentos de lealtad y envío
incluidos) + ventas de DiDi capturadas en el corte. Gastos = gastos del corte + "Gastos por caja".
El resultado es **estimado**: no incluye el costo de insumos ni las compras de inventario
registradas aparte. Si un encargado tiene una sola sucursal asignada, solo ve esa.

**Correcciones que salieron de esta revisión:**
- **Informes restaba dos veces los descuentos de lealtad** en el "Resultado del periodo" (el total
  del pedido ya los trae restados). Corregido: ahora solo se muestra como nota informativa.
- **Un error inesperado en una consulta ya no tumba el servidor completo** (antes, una fecha
  imposible como 2026-13-45 hacía caer el proceso y con él POS y Cocina de ambas sucursales). Se
  agregó una red de seguridad global y el dashboard valida las fechas y responde con un error claro.

No requiere migración — solo sube `server.js`, `public/admin/index.html` y `public/admin/app.js`.

## 59. Inventario avanzado (pestaña 📦 Inventario en Administración)

Una sola pestaña con todo lo de inventario. **La base de todo es el historial de movimientos (kardex):**
cada cambio de stock —venta, cancelación, compra, merma, producción, traspaso, ajuste, conteo— deja una
fila con quién lo hizo, cuándo, cuánto y a qué costo. Por eso el stock siempre se puede explicar.

| Pestaña | Qué hace | Quién la ve |
|---|---|---|
| 📊 Resumen | Valor del inventario, por surtir, compras y mermas del mes, producción, platillos sin receta, alertas | Encargado |
| 📦 Stock | Existencias con estado (agotado/bajo), mínimo y máximo por sucursal, cobertura en días, costo y valor; merma, entrada, ajuste, historial por insumo, alta y edición de insumos | Todos (el cajero sin costos) |
| 🚨 Alertas | Agotado, bajo mínimo, se acaba pronto, precio que subió +10%, merma alta, faltante en cierre, insumos sin costo, platillos sin receta, historial descuadrado | Todos (el cajero sin alertas con dinero) |
| ⬇️ Entradas | **Compras con factor de conversión** (caja → kg), anulación de compras, **traspasos entre sucursales**, **pedido sugerido por proveedor con mensaje de WhatsApp**, y acceso a «compra con foto de ticket» y «plan de compras (IA)» | Encargado |
| 🗑️ Mermas | Registro rápido con motivo + reporte (por motivo, por insumo, % sobre lo consumido) | Todos (reporte: encargado) |
| 🍳 Producción | Producción diaria de insumos elaborados (carne adobada, salsas…): descuenta ingredientes, suma lo obtenido, calcula el costo real y el rendimiento; **sugerencia de qué producir hoy** según lo que se usa ese día de la semana | Todos (recetas: encargado) |
| 🧾 Recetas y costos | Costo, margen y **food cost** de cada platillo y variante | Encargado |
| 🚚 Proveedores | Catálogo, últimos precios y variación, comprado en 90 días, WhatsApp directo | Encargado |
| ✅ Cierre de turno | Conteo de los insumos «críticos» (⭐), diferencias en vivo, ajuste opcional del sistema, historial | Todos |
| 📜 Movimientos | El kardex completo con filtros por tipo, insumo y fechas | Todos (sin costos para el cajero) |

**Cómo se calcula el costo:** cada compra se convierte a la unidad base y el costo del insumo pasa a ser un
**promedio ponderado** entre lo que ya había (en todas las sucursales) y lo que entra. Lo mismo al producir
un elaborado. Anular una compra devuelve el stock pero no revierte el costo promedio.

**Mosaicos anteriores:** «Conteo de inventario», «Registrar compra» y «Planeación de compras» ya no aparecen en el
tablero, pero siguen funcionando y se abren desde la pestaña Inventario. Todo lo que hacen ahora también deja
historial. «Importar recetas» y el editor de recetas del menú siguen igual.

**Importante:**
- Para que el stock se mueva con historial hay que correr la migración (ver abajo). Si subes el código antes,
  **las ventas no se rompen** (el stock se mueve igual, solo avisa en el log del servidor), pero la pestaña nueva
  marcará error hasta migrar.
- El historial arranca con el stock de hoy como «saldo inicial». Si alguien cambia el stock directo en la base
  de datos (fuera del sistema), aparece la alerta «El stock no coincide con su historial».
- `costo_unitario` ahora guarda 4 decimales (antes 2) para insumos de fracciones de centavo por gramo/pieza.
- Se corrigió además el encabezado de Administración en celular: no cabía en una fila y dejaba fuera el botón ☰
  (menú y cerrar sesión). Ahora pasa a dos filas.

Para activar esto en tu base de datos ya desplegada:

1. Railway → Postgres → corre `db/migracion-inventario-avanzado.sql` (es repetible: si la corres dos veces no pasa nada).
2. Sube a GitHub: `server.js`, `inventario.js` (nuevo), `public/admin/index.html`, `public/admin/app.js`,
   `public/admin/inventario.js` (nuevo).
3. Entra a 📦 Inventario → Stock → ⚙️ de tus insumos principales: pon proveedor, unidad de compra y factor,
   stock mínimo y marca ⭐ crítico los que quieras contar al cierre.

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
