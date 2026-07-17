// Corre el schema.sql y seed.sql contra la base de datos configurada en DATABASE_URL
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(__dirname, '../db/seed.sql'), 'utf8');

  console.log('Creando tablas...');
  await pool.query(schema);

  console.log('Insertando datos iniciales (sucursales y menú de ejemplo)...');
  await pool.query(seed);

  console.log('Listo. Base de datos inicializada.');
  await pool.end();
}

main().catch((err) => {
  console.error('Error inicializando la base de datos:', err);
  process.exit(1);
});
