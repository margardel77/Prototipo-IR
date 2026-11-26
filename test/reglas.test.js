'use strict';
// Pruebas de las reglas de negocio (RQNF-012: módulos probables de forma independiente).
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-reglas-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db/database');
const dates = require('../src/lib/dates');
const fmt = require('../src/lib/format');

db.open(':memory:');
require('../src/db/seed').seed();
const participacion = require('../src/services/participacion');
const salidas = require('../src/services/salidas');
const socios = require('../src/services/socios');
const cuotas = require('../src/services/cuotas');
const equipacion = require('../src/services/equipacion');
const junta = require('../src/services/junta');
const { ReglaError } = require('../src/lib/errors');

test('baremo de pruebas sociales (REGN-012)', () => {
  assert.equal(participacion.baremo(1), 120);
  assert.equal(participacion.baremo(2), 105);
  assert.equal(participacion.baremo(3), 90);
  assert.equal(participacion.baremo(4), 85);
  assert.equal(participacion.baremo(20), 5);
  assert.equal(participacion.baremo(35), 5);
});

test('clasificación por tiempos con empates', () => {
  const r = participacion.clasificarTiempos([
    { socio_id: 1, tiempo_segundos: 1900 }, { socio_id: 2, tiempo_segundos: 1800 },
    { socio_id: 3, tiempo_segundos: 1800 }, { socio_id: 4, tiempo_segundos: null },
  ]);
  assert.deepEqual(r.map((f) => [f.socio_id, f.posicion, f.puntos]), [[2, 1, 120], [3, 1, 120], [1, 3, 90], [4, null, null]]);
});

test('periodos de clasificación (REGN-013)', () => {
  assert.equal(dates.periodoDe('2026-06-30').clave, '2026-1');
  assert.equal(dates.periodoDe('2026-07-01').clave, '2026-2');
  assert.equal(dates.etiquetaPeriodo(dates.periodoDe('2026-11-15')), 'del 1 jul al 31 dic 2026');
});

test('formatos de fecha, euros y tiempos', () => {
  assert.equal(dates.corta('2026-11-15'), '15 nov 2026');
  assert.equal(dates.larga('2026-11-15'), 'Domingo, 15 de noviembre de 2026');
  assert.equal(dates.parseFecha('15/11/2026'), '2026-11-15');
  assert.equal(dates.parseFecha('31/02/2026'), null);
  assert.equal(dates.edad('1985-04-24', '2026-11-20'), 41);
  assert.equal(fmt.euros(30), '30,00 €');
  assert.equal(fmt.hmsASegundos('00:30:48'), 1848);
  assert.equal(fmt.segundosAHms(1848), '00:30:48');
});

test('clasificación del semestre a partir de las participaciones validadas', () => {
  const filas = participacion.clasificacion(dates.periodoPorClave('2026-2'));
  assert.deepEqual(filas.map((f) => [`${f.nombre} ${f.apellidos}`, f.puntos, f.puesto]), [
    ['Socio de ejemplo A', 24, 1], ['Socio de ejemplo B', 18, 2], ['Socio de ejemplo C', 12, 3],
  ]);
});

test('antelación de 14 días y opciones de vuelta en salidas semanales (REGN-007, REGN-008)', () => {
  const hoy = '2026-11-20';
  const ruta = salidas.rutas().find((r) => r.nombre === 'Caminos y olivares');
  assert.throws(() => salidas.publicar({ fecha: '27/11/2026', hora: '09:00', tipo: 'SEMANAL', ruta_id: ruta.id }, 1, hoy),
    (e) => e instanceof ReglaError && /14 días/.test(e.errores.fecha));
  const mel = salidas.rutas().find((r) => r.nombre === 'Melonares');
  assert.throws(() => salidas.publicar({ fecha: '20/12/2026', hora: '09:00', tipo: 'SEMANAL', ruta_id: mel.id }, 1, hoy),
    (e) => /vuelta A y B/.test(e.errores.ruta_id));
  const id = salidas.publicar({ fecha: '06/12/2026', hora: '09:00', tipo: 'SEMANAL', ruta_id: ruta.id }, 1, hoy);
  assert.equal(salidas.obtener(id).fecha_publicacion, hoy);
});

test('el nombre de ruta es único (CU-001)', () => {
  assert.throws(() => salidas.crearRuta({ nombre: 'caminos y olivares', kilometros: '40', recorrido: 'x' }), ReglaError);
});

test('plazo de consulta de salidas especiales (REGN-009)', () => {
  const s = { tipo: 'ESPECIAL', fecha: '2026-12-20' };
  assert.equal(salidas.plazoConsulta(s, '2026-12-05').abierto, false);
  assert.equal(salidas.plazoConsulta(s, '2026-12-06').abierto, true);
  assert.equal(salidas.plazoConsulta(s, '2026-12-13').abierto, false);
});

test('una sola declaración por socio y salida (REGN-010)', () => {
  const s15 = salidas.calendario({ hoy: '2026-11-20' }).find((s) => s.fecha === '2026-11-15');
  const a = socios.porEmail('socioa@example.com');
  assert.throws(() => participacion.declarar(s15.id, a.id, { hoy: '2026-11-20' }), /No puedes enviarla otra vez/);
  const c = socios.porEmail('socioc@example.com');
  participacion.declarar(s15.id, c.id, { hoy: '2026-11-20' });
  assert.equal(participacion.deSocio(s15.id, c.id).estado_validacion, 'PENDIENTE');
});

test('no se puede declarar antes del día de la salida', () => {
  const s29 = salidas.calendario({ hoy: '2026-11-20' }).find((s) => s.fecha === '2026-11-29');
  const b = socios.porEmail('sociob@example.com');
  salidas.inscribir(s29.id, b.id, { hoy: '2026-11-20' });
  assert.throws(() => participacion.declarar(s29.id, b.id, { hoy: '2026-11-20' }), /desde el día de la salida/);
});

test('números de socio únicos y reingreso con número nuevo (REGN-003, REGN-004)', () => {
  const b = socios.porEmail('sociob@example.com');
  socios.darDeBaja(b.id, '2026-11-20');
  assert.equal(socios.obtener(b.id).numero, null);
  const n = socios.reingresar(b.id, '2026-11-21');
  assert.equal(n, 63);
  assert.deepEqual(socios.historialAltas(b.id).map((h) => h.numero), [63, 60]);
});

test('descuento de equipación según cuotas pagadas (REGN-014)', () => {
  const ej = socios.porEmail('socio@example.com');
  const maillot = equipacion.articulos().find((x) => x.nombre === 'Maillot');
  const culote = equipacion.articulos().find((x) => x.nombre === 'Culote');
  const c = equipacion.calcular(ej.id, [{ articulo_id: maillot.id, talla: 'L', cantidad: 1 }, { articulo_id: culote.id, talla: 'M', cantidad: 1 }], '2026-11-20');
  assert.equal(c.importe, 50);
  assert.equal(c.descuento, 10);
  assert.equal(c.tipo, 'COMPLETO');
  const el = socios.porEmail('elena@example.com');
  assert.equal(equipacion.tipoDescuento(el.id, '2026-11-20'), 'REDUCIDO');
});

test('registrar el pago emite un comprobante (RQF-007)', () => {
  const c = cuotas.listarPorAnio(2026).find((x) => x.estado === 'PENDIENTE');
  const r = cuotas.registrarPago(c.id, { fecha: '12/11/2026', forma: 'EFECTIVO' }, 1);
  assert.equal(r.estado, 'PAGADA');
  assert.ok(r.comprobante_id);
  assert.throws(() => cuotas.registrarPago(c.id, { fecha: '12/11/2026', forma: 'EFECTIVO' }, 1), /ya está registrada/);
});

test('la junta debe tener presidente, secretario y tesorero (REGN-005)', () => {
  const el = socios.porEmail('elena@example.com');
  assert.throws(() => junta.asignarCargo(el.id, null), /tesorero/);
  assert.deepEqual(junta.permisos(el.id), ['socios', 'cuotas']);
  const a = socios.porEmail('socioa@example.com');
  assert.deepEqual(junta.permisos(a.id), []);
});

test('guardar el resultado de una prueba social asigna puntos y actualiza la clasificación', () => {
  const mel = salidas.pruebasSociales().find((p) => p.ruta_nombre === 'Melonares');
  const filas = participacion.resultadosPrueba(mel.id);
  const tiempos = Object.fromEntries(filas.filter((f) => f.tiempo_segundos).map((f) => [f.socio_id, f.tiempo_segundos]));
  assert.equal(participacion.guardarResultados(mel.id, tiempos, 1), 3);
  const a = socios.porEmail('socioa@example.com');
  const fila = participacion.clasificacion(dates.periodoPorClave('2026-2')).find((f) => f.socio_id === a.id);
  assert.equal(fila.puntos, 24 + 105);
});
