'use strict';
// SUBS-006 · Subsistema de gestión de equipaciones.
const db = require('../db/database');
const config = require('../config');
const dates = require('../lib/dates');
const { ReglaError } = require('../lib/errors');

function articulos() {
  return db.all('SELECT * FROM articulos ORDER BY id').map((a) => ({ ...a, tallas: a.tallas.split(',') }));
}
function articulo(id) {
  const a = db.get('SELECT * FROM articulos WHERE id = ?', id);
  return a ? { ...a, tallas: a.tallas.split(',') } : null;
}

// ----- Carrito (mockups «Equipaciones», detalle del artículo y «Carrito») -----
const MAX_CANTIDAD = 10;

function carrito(socioId) {
  return db.all(
    `SELECT c.id, c.articulo_id, c.talla, c.cantidad, a.nombre AS prenda, a.precio_base, a.tallas
     FROM carrito c JOIN articulos a ON a.id = c.articulo_id WHERE c.socio_id = ? ORDER BY c.id`, socioId,
  );
}

function anadirAlCarrito(socioId, articuloId, talla, cantidad) {
  const a = articulo(Number(articuloId));
  if (!a) throw new ReglaError('El artículo no existe.');
  if (!a.tallas.includes(talla)) throw new ReglaError(`La talla ${talla} no está disponible para ${a.nombre}.`);
  const n = Math.floor(Number(cantidad));
  if (!(n >= 1 && n <= MAX_CANTIDAD)) throw new ReglaError(`Elige una cantidad entre 1 y ${MAX_CANTIDAD}.`);
  const actual = db.get('SELECT id, cantidad FROM carrito WHERE socio_id=? AND articulo_id=? AND talla=?', socioId, a.id, talla);
  if (actual) db.run('UPDATE carrito SET cantidad=? WHERE id=?', Math.min(MAX_CANTIDAD, actual.cantidad + n), actual.id);
  else db.run('INSERT INTO carrito (socio_id, articulo_id, talla, cantidad) VALUES (?,?,?,?)', socioId, a.id, talla, n);
}

// Cambia la cantidad de una línea del carrito; con 0 la quita.
function cambiarCantidad(socioId, lineaId, cantidad) {
  const n = Math.floor(Number(cantidad));
  if (!(n >= 0 && n <= MAX_CANTIDAD)) throw new ReglaError(`Elige una cantidad entre 1 y ${MAX_CANTIDAD}.`);
  if (n === 0) db.run('DELETE FROM carrito WHERE id=? AND socio_id=?', lineaId, socioId);
  else db.run('UPDATE carrito SET cantidad=? WHERE id=? AND socio_id=?', n, lineaId, socioId);
}

// Confirmar pedido: registra el pedido con las líneas del carrito y lo vacía.
function confirmarCarrito(socioId, hoy = dates.today()) {
  const lineas = carrito(socioId);
  if (!lineas.length) throw new ReglaError('Tu carrito está vacío. Añade alguna prenda desde Equipaciones.');
  return db.tx(() => {
    const id = crearPedido(socioId, lineas, hoy);
    db.run('DELETE FROM carrito WHERE socio_id = ?', socioId);
    return id;
  });
}

function campaniaActiva(hoy = dates.today()) {
  return db.get('SELECT * FROM campanias WHERE fecha_inicio <= ? AND (fecha_fin IS NULL OR fecha_fin >= ?) ORDER BY fecha_inicio DESC', hoy, hoy);
}

// REGN-014 · completo si pagó la cuota del año anterior y del actual;
// reducido si solo la del actual; sin descuento en otro caso.
function tipoDescuento(socioId, hoy = dates.today()) {
  const anio = dates.anio(hoy);
  const pagada = (a) => Boolean(db.get("SELECT 1 FROM cuotas WHERE socio_id=? AND anio=? AND estado='PAGADA'", socioId, a));
  if (pagada(anio) && pagada(anio - 1)) return 'COMPLETO';
  if (pagada(anio)) return 'REDUCIDO';
  return 'NINGUNO';
}

function calcular(socioId, lineasEntrada, hoy = dates.today()) {
  const cat = new Map(articulos().map((a) => [a.id, a]));
  const lineas = [];
  for (const l of lineasEntrada) {
    const a = cat.get(Number(l.articulo_id));
    const cantidad = Math.floor(Number(l.cantidad));
    if (!a || !(cantidad > 0)) continue;
    if (!a.tallas.includes(l.talla)) throw new ReglaError(`La talla ${l.talla} no está disponible para ${a.nombre}.`);
    if (cantidad > MAX_CANTIDAD) throw new ReglaError(`La cantidad máxima por prenda es ${MAX_CANTIDAD}.`);
    lineas.push({ articulo_id: a.id, prenda: a.nombre, talla: l.talla, cantidad, precio_unitario: a.precio_base });
  }
  const unidades = lineas.reduce((n, l) => n + l.cantidad, 0);
  const importe = lineas.reduce((n, l) => n + l.cantidad * l.precio_unitario, 0);
  const tipo = tipoDescuento(socioId, hoy);
  const porUnidad = tipo === 'COMPLETO' ? config.descuentoEquipacion.completoPorUnidad
    : tipo === 'REDUCIDO' ? config.descuentoEquipacion.reducidoPorUnidad : 0;
  const descuento = Math.min(importe, unidades * porUnidad);
  return { lineas, importe, descuento, tipo, porUnidad };
}

function crearPedido(socioId, lineasEntrada, hoy = dates.today()) {
  const camp = campaniaActiva(hoy);
  if (!camp) throw new ReglaError('No hay ninguna campaña de equipación abierta.');
  const c = calcular(socioId, lineasEntrada, hoy);
  if (!c.lineas.length) throw new ReglaError('Añade al menos una prenda al pedido.');
  const guardar = () => {
    const r = db.run('INSERT INTO pedidos (socio_id, campania_id, fecha, importe_total, descuento_aplicado) VALUES (?,?,?,?,?)',
      socioId, camp.id, hoy, c.importe, c.descuento);
    const id = Number(r.lastInsertRowid);
    for (const l of c.lineas) {
      db.run('INSERT INTO lineas_pedido (pedido_id, articulo_id, prenda, talla, cantidad, precio_unitario) VALUES (?,?,?,?,?,?)',
        id, l.articulo_id, l.prenda, l.talla, l.cantidad, l.precio_unitario);
    }
    return id;
  };
  return db.tx(guardar);
}

function pedido(id) {
  const p = db.get('SELECT * FROM pedidos WHERE id = ?', id);
  if (p) p.lineas = db.all('SELECT * FROM lineas_pedido WHERE pedido_id = ? ORDER BY id', id);
  return p;
}

function pedidosDeSocio(socioId) {
  return db.all('SELECT * FROM pedidos WHERE socio_id = ? ORDER BY fecha DESC, id DESC', socioId)
    .map((p) => ({ ...p, lineas: db.all('SELECT * FROM lineas_pedido WHERE pedido_id = ?', p.id) }));
}

// RQF-014 · Resumen de pedidos de una campaña
function resumenCampania(campaniaId) {
  const totales = db.all(
    `SELECT l.prenda, l.talla, SUM(l.cantidad) unidades FROM lineas_pedido l JOIN pedidos p ON p.id = l.pedido_id
     WHERE p.campania_id = ? GROUP BY l.prenda, l.talla ORDER BY l.prenda, l.talla`, campaniaId,
  );
  const pedidos = db.all(
    `SELECT p.*, s.nombre, s.apellidos FROM pedidos p JOIN socios s ON s.id = p.socio_id WHERE p.campania_id = ? ORDER BY p.fecha, p.id`, campaniaId,
  ).map((p) => ({ ...p, lineas: db.all('SELECT * FROM lineas_pedido WHERE pedido_id = ?', p.id) }));
  const importe = pedidos.reduce((a, p) => a + p.importe_total - p.descuento_aplicado, 0);
  return { totales, pedidos, importe };
}

module.exports = {
  articulos, articulo, campaniaActiva, tipoDescuento, calcular, crearPedido, pedido, pedidosDeSocio, resumenCampania,
  carrito, anadirAlCarrito, cambiarCantidad, confirmarCarrito, MAX_CANTIDAD,
};
