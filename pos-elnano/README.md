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
