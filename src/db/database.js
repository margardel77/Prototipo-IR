'use strict';
// Capa de persistencia: repositorio de datos sobre SQLite (SGBD relacional).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS socios (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  fecha_nacimiento TEXT NOT NULL,
  direccion TEXT NOT NULL,
  telefono TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  fecha_alta TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('ACTIVO','BAJA','PENDIENTE')),
  solicitud_fecha TEXT,
  solicitud_pago TEXT,
  creado_en TEXT NOT NULL
);

-- Historial de números de socio (AsignacionNumero). El número nunca se reasigna.
CREATE TABLE IF NOT EXISTS asignaciones_numero (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  numero INTEGER NOT NULL UNIQUE,
  fecha_asignacion TEXT NOT NULL,
  fecha_fin TEXT
);

CREATE TABLE IF NOT EXISTS importes_cuota (
  anio INTEGER PRIMARY KEY,
  importe REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS cuotas (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  anio INTEGER NOT NULL,
  importe REAL NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('PENDIENTE','PAGADA')),
  fecha_pago TEXT,
  forma_pago TEXT CHECK (forma_pago IN ('BANCO','EFECTIVO','TARJETA')),
  registrado_por INTEGER REFERENCES socios(id),
  UNIQUE (socio_id, anio)
);

CREATE TABLE IF NOT EXISTS comprobantes (
  id INTEGER PRIMARY KEY,
  cuota_id INTEGER NOT NULL UNIQUE REFERENCES cuotas(id),
  fecha_emision TEXT NOT NULL,
  fecha_envio TEXT,
  mensaje TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tarjetas_guardadas (
  socio_id INTEGER PRIMARY KEY REFERENCES socios(id),
  ultimos TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pagos_tarjeta (
  cuota_id INTEGER PRIMARY KEY REFERENCES cuotas(id),
  ultimos TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cargos (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('PRESIDENTE','SECRETARIO','TESORERO','VOCAL')),
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT
);

CREATE TABLE IF NOT EXISTS rutas (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
  recorrido TEXT NOT NULL,
  kilometros REAL NOT NULL,
  puntos_intermedios TEXT NOT NULL DEFAULT '',
  vuelta_a TEXT,
  vuelta_b TEXT
);

CREATE TABLE IF NOT EXISTS salidas (
  id INTEGER PRIMARY KEY,
  ruta_id INTEGER NOT NULL REFERENCES rutas(id),
  fecha TEXT NOT NULL,
  hora TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('SEMANAL','ESPECIAL','PRUEBA_SOCIAL')),
  estado TEXT NOT NULL CHECK (estado IN ('PUBLICADA','CANCELADA')),
  fecha_publicacion TEXT NOT NULL,
  publicada_por INTEGER REFERENCES socios(id)
);

-- Socios apuntados a una salida
CREATE TABLE IF NOT EXISTS inscripciones (
  id INTEGER PRIMARY KEY,
  salida_id INTEGER NOT NULL REFERENCES salidas(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  fecha TEXT NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('APP','MANUAL')),
  UNIQUE (salida_id, socio_id)
);

-- Participación (declaración + validación). REGN-010: una por socio y salida.
CREATE TABLE IF NOT EXISTS participaciones (
  id INTEGER PRIMARY KEY,
  salida_id INTEGER NOT NULL REFERENCES salidas(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  fecha_declaracion TEXT,
  evidencia_archivo TEXT,
  evidencia_nombre TEXT,
  estado_validacion TEXT NOT NULL CHECK (estado_validacion IN ('PENDIENTE','APROBADA','RECHAZADA')),
  validador_id INTEGER REFERENCES socios(id),
  fecha_validacion TEXT,
  puntos_asignados INTEGER,
  UNIQUE (salida_id, socio_id)
);

-- Resultados de pruebas sociales (tiempos en borrador hasta "Guardar resultado")
CREATE TABLE IF NOT EXISTS resultados_prueba (
  id INTEGER PRIMARY KEY,
  salida_id INTEGER NOT NULL REFERENCES salidas(id),
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  participacion_id INTEGER REFERENCES participaciones(id),
  tiempo_segundos INTEGER,
  posicion INTEGER,
  puntos INTEGER,
  guardado INTEGER NOT NULL DEFAULT 0,
  UNIQUE (salida_id, socio_id)
);

CREATE TABLE IF NOT EXISTS articulos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT NOT NULL DEFAULT '',
  precio_base REAL NOT NULL,
  tallas TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campanias (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT
);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  campania_id INTEGER NOT NULL REFERENCES campanias(id),
  fecha TEXT NOT NULL,
  importe_total REAL NOT NULL,
  descuento_aplicado REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS lineas_pedido (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  articulo_id INTEGER NOT NULL REFERENCES articulos(id),
  prenda TEXT NOT NULL,
  talla TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario REAL NOT NULL
);

-- Carrito de equipación de cada socio (prendas aún sin confirmar)
CREATE TABLE IF NOT EXISTS carrito (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  articulo_id INTEGER NOT NULL REFERENCES articulos(id),
  talla TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  UNIQUE (socio_id, articulo_id, talla)
);

-- Datos internos de la aplicación (versión de los datos de ejemplo, etc.)
CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Bandeja de salida de comunicaciones (correo y WhatsApp)
CREATE TABLE IF NOT EXISTS comunicaciones (
  id INTEGER PRIMARY KEY,
  canal TEXT NOT NULL CHECK (canal IN ('EMAIL','WHATSAPP')),
  destinatario TEXT NOT NULL,
  asunto TEXT,
  cuerpo TEXT NOT NULL,
  creado_en TEXT NOT NULL,
  enviado_en TEXT,
  estado TEXT NOT NULL,
  error TEXT
);

-- Tareas automáticas ya ejecutadas (cuotas, recordatorios, bajas, periodos)
CREATE TABLE IF NOT EXISTS tareas_ejecutadas (
  clave TEXT PRIMARY KEY,
  ejecutada_en TEXT NOT NULL
);
`;

let db;

function open(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

function conn() { if (!db) open(); return db; }

const all = (sql, ...p) => conn().prepare(sql).all(...p);
const get = (sql, ...p) => conn().prepare(sql).get(...p);
const run = (sql, ...p) => conn().prepare(sql).run(...p);

// Transacción. Si ya hay una abierta, la operación se incluye en ella.
let profundidad = 0;
function tx(fn) {
  const d = conn();
  if (profundidad > 0) return fn();
  d.exec('BEGIN');
  profundidad += 1;
  try { const r = fn(); profundidad -= 1; d.exec('COMMIT'); return r; } catch (e) { profundidad -= 1; d.exec('ROLLBACK'); throw e; }
}
const enTx = () => profundidad > 0;

function close() { if (db) { db.close(); db = null; } }

module.exports = { open, conn, all, get, run, tx, enTx, close };
