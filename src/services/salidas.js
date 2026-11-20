'use strict';
// SUBS-002 · Subsistema de gestión de salidas y rutas.
const db = require('../db/database');
const config = require('../config');
const dates = require('../lib/dates');
const fmt = require('../lib/format');
const com = require('./comunicaciones');
const { ReglaError } = require('../lib/errors');

// ----- Rutas -----
function rutas() { return db.all('SELECT * FROM rutas ORDER BY nombre'); }
function ruta(id) { return db.get('SELECT * FROM rutas WHERE id = ?', id); }

// CU-001 · Registrar ruta
function crearRuta(d) {
  const errores = {};
  const nombre = String(d.nombre || '').trim();
  const kmTxt = String(d.kilometros || '').trim().replace(',', '.');
  const km = Number(kmTxt);
  if (!nombre) errores.nombre = 'Escribe el nombre de la ruta.';
  if (!kmTxt || !Number.isFinite(km) || km <= 0) errores.kilometros = 'Indica la distancia en km.';
  if (!String(d.recorrido || '').trim()) errores.recorrido = 'Describe el recorrido.';
  if (nombre && db.get('SELECT id FROM rutas WHERE nombre = ?', nombre)) errores.nombre = 'Ya existe una ruta con ese nombre.';
  if (Object.keys(errores).length) throw Object.assign(new ReglaError('Revisa los datos de la ruta.'), { errores });
  const r = db.run(
    'INSERT INTO rutas (nombre, recorrido, kilometros, puntos_intermedios, vuelta_a, vuelta_b) VALUES (?,?,?,?,?,?)',
    nombre, d.recorrido.trim(), km, String(d.puntos_intermedios || '').trim(),
    String(d.vuelta_a || '').trim() || null, String(d.vuelta_b || '').trim() || null,
  );
  return Number(r.lastInsertRowid);
}

// ----- Salidas -----
const SELECT_SALIDA = `
  SELECT sa.*, r.nombre AS ruta_nombre, r.recorrido, r.kilometros, r.puntos_intermedios, r.vuelta_a, r.vuelta_b,
         (SELECT COUNT(*) FROM inscripciones i WHERE i.salida_id = sa.id) AS num_inscritos
  FROM salidas sa JOIN rutas r ON r.id = sa.ruta_id`;

// RQF-010 · La salida pasa a realizada al llegar su fecha y hora de comienzo.
function estadoEfectivo(s, ahora = dates.now()) {
  if (s.estado === 'CANCELADA') return 'CANCELADA';
  return `${s.fecha} ${s.hora}` <= ahora ? 'REALIZADA' : 'PUBLICADA';
}
function decorar(s) {
  if (!s) return s;
  s.estado_efectivo = estadoEfectivo(s);
  return s;
}

function obtener(id) { return decorar(db.get(`${SELECT_SALIDA} WHERE sa.id = ?`, id)); }

// Calendario: salidas publicadas recientes (última semana) y próximas; además,
// las salidas en las que el socio está apuntado y aún no ha declarado.
function calendario({ socioId = null, hoy = dates.today() } = {}) {
  const desde = dates.addDays(hoy, -7);
  const rows = db.all(
    `${SELECT_SALIDA} WHERE sa.estado = 'PUBLICADA' AND (sa.fecha >= ? OR (? IS NOT NULL AND sa.tipo <> 'PRUEBA_SOCIAL' AND EXISTS (
       SELECT 1 FROM inscripciones i WHERE i.salida_id = sa.id AND i.socio_id = ?
       AND NOT EXISTS (SELECT 1 FROM participaciones p WHERE p.salida_id = sa.id AND p.socio_id = ?))))
     ORDER BY sa.fecha, sa.hora`,
    desde, socioId, socioId, socioId,
  );
  return rows.map(decorar);
}

function listarGestion() {
  return db.all(`${SELECT_SALIDA} ORDER BY sa.fecha DESC, sa.hora DESC`).map(decorar);
}

function realizadas() {
  const ahora = dates.now();
  return db.all(`${SELECT_SALIDA} WHERE sa.estado = 'PUBLICADA' AND (sa.fecha || ' ' || sa.hora) <= ? ORDER BY sa.fecha DESC, sa.hora DESC`, ahora).map(decorar);
}

function pruebasSociales() {
  return db.all(`${SELECT_SALIDA} WHERE sa.tipo = 'PRUEBA_SOCIAL' AND sa.estado = 'PUBLICADA' ORDER BY sa.fecha DESC`).map(decorar);
}

function validarSalida(d, hoy, { salidaActual = null } = {}) {
  const errores = {};
  const fecha = dates.parseFecha(d.fecha);
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.hora || '').trim()) ? d.hora.trim() : null;
  const tipo = ['SEMANAL', 'ESPECIAL', 'PRUEBA_SOCIAL'].includes(d.tipo) ? d.tipo : null;
  const r = ruta(Number(d.ruta_id));
  if (!rutas().length) errores.ruta_id = 'No hay rutas registradas. Crea una ruta primero.';
  else if (!r) errores.ruta_id = 'Selecciona una ruta.';
  if (!fecha) errores.fecha = 'Indica una fecha válida (DD/MM/AAAA).';
  if (!hora) errores.hora = 'Indica la hora (HH:MM).';
  if (!tipo) errores.tipo = 'Selecciona el tipo de salida.';
  const cambiaFecha = !salidaActual || salidaActual.fecha !== fecha;
  if (fecha && fecha <= hoy && cambiaFecha) errores.fecha = 'La fecha debe ser posterior a hoy.';
  if (fecha && tipo === 'SEMANAL' && cambiaFecha && dates.diffDays(fecha, hoy) < config.antelacionSemanalDias) {
    errores.fecha = `Una salida semanal se publica con al menos ${config.antelacionSemanalDias} días de antelación (REGN-007).`;
  }
  if (r && tipo === 'SEMANAL' && (!r.vuelta_a || !r.vuelta_b)) {
    errores.ruta_id = 'Una salida semanal necesita una ruta con las opciones de vuelta A y B (REGN-008).';
  }
  return { errores, fecha, hora, tipo, ruta: r };
}

function textoAviso(s, cabecera) {
  return [
    cabecera,
    `${fmt.ETIQ.tipoSalida[s.tipo]} · ${dates.larga(s.fecha)} · ${s.hora}`,
    `Ruta: ${s.ruta_nombre} (${fmt.km(s.kilometros)})`,
    s.vuelta_a || s.vuelta_b ? `Vuelta A: ${s.vuelta_a || '—'} · Vuelta B: ${s.vuelta_b || '—'}` : null,
  ].filter(Boolean).join('\n');
}

// RQF-009 · Aviso a los socios por correo y WhatsApp
function avisar(s, cabecera) {
  const txt = textoAviso(s, cabecera);
  for (const to of com.emailsSociosActivos()) com.enviarEmail(to, `${cabecera}: ${s.ruta_nombre}`, txt);
  com.enviarWhatsappGrupo(txt);
}

// CU-002 · Planificar y publicar salida
function publicar(d, actorId, hoy = dates.today()) {
  const v = validarSalida(d, hoy);
  if (Object.keys(v.errores).length) throw Object.assign(new ReglaError('Revisa los datos de la salida.'), { errores: v.errores });
  const r = db.run(
    "INSERT INTO salidas (ruta_id, fecha, hora, tipo, estado, fecha_publicacion, publicada_por) VALUES (?,?,?,?,'PUBLICADA',?,?)",
    v.ruta.id, v.fecha, v.hora, v.tipo, hoy, actorId || null,
  );
  const s = obtener(Number(r.lastInsertRowid));
  avisar(s, 'Nueva salida publicada');
  return s.id;
}

// CU-003 · Modificar o cancelar salida
function modificar(id, d, hoy = dates.today()) {
  const actual = obtener(id);
  if (!actual || actual.estado_efectivo !== 'PUBLICADA') throw new ReglaError('Solo se puede modificar una salida publicada cuya fecha no ha llegado.');
  const v = validarSalida(d, hoy, { salidaActual: actual });
  if (Object.keys(v.errores).length) throw Object.assign(new ReglaError('Revisa los datos de la salida.'), { errores: v.errores });
  db.run('UPDATE salidas SET ruta_id=?, fecha=?, hora=?, tipo=? WHERE id=?', v.ruta.id, v.fecha, v.hora, v.tipo, id);
  const s = obtener(id);
  const cambios = [];
  if (actual.fecha !== s.fecha) cambios.push(`fecha (antes ${dates.corta(actual.fecha)})`);
  if (actual.hora !== s.hora) cambios.push(`hora (antes ${actual.hora})`);
  if (actual.ruta_id !== s.ruta_id) cambios.push(`ruta (antes ${actual.ruta_nombre})`);
  if (actual.tipo !== s.tipo) cambios.push('tipo de salida');
  avisar(s, `Salida modificada${cambios.length ? ` · cambia: ${cambios.join(', ')}` : ''}`);
  return id;
}

function cancelar(id) {
  const s = obtener(id);
  if (!s || s.estado_efectivo !== 'PUBLICADA') throw new ReglaError('Solo se puede cancelar una salida publicada cuya fecha no ha llegado.');
  db.run("UPDATE salidas SET estado='CANCELADA' WHERE id=?", id);
  avisar(s, 'Salida cancelada');
}

// ----- Inscripciones -----
function estaInscrito(salidaId, socioId) {
  return Boolean(db.get('SELECT 1 FROM inscripciones WHERE salida_id=? AND socio_id=?', salidaId, socioId));
}
function inscritos(salidaId) {
  return db.all(
    `SELECT i.*, s.nombre, s.apellidos FROM inscripciones i JOIN socios s ON s.id = i.socio_id
     WHERE i.salida_id = ? ORDER BY i.fecha, i.id`, salidaId,
  );
}

// REGN-009 · Plazo de consulta de una salida especial
function plazoConsulta(s, hoy) {
  if (s.tipo !== 'ESPECIAL') return { abierto: true };
  const apertura = dates.addDays(s.fecha, -config.consultaEspecial.apertura);
  const cierre = dates.addDays(s.fecha, -config.consultaEspecial.cierre);
  return { abierto: hoy >= apertura && hoy < cierre, apertura, cierre };
}

// CU-005 · Apuntarse a una salida
function inscribir(salidaId, socioId, { origen = 'APP', hoy = dates.today() } = {}) {
  const s = obtener(salidaId);
  if (!s || s.estado === 'CANCELADA') throw new ReglaError('Esta salida no está disponible.');
  const socio = db.get('SELECT estado FROM socios WHERE id=?', socioId);
  if (!socio || socio.estado !== 'ACTIVO') throw new ReglaError('Solo los socios activos pueden apuntarse a las salidas.');
  if (estaInscrito(salidaId, socioId)) return false;
  if (origen === 'APP') {
    const p = plazoConsulta(s, hoy);
    if (!p.abierto) throw new ReglaError(`El plazo para apuntarse a esta salida especial va del ${dates.corta(p.apertura)} al ${dates.corta(dates.addDays(p.cierre, -1))}.`);
  }
  db.run('INSERT INTO inscripciones (salida_id, socio_id, fecha, origen) VALUES (?,?,?,?)', salidaId, socioId, dates.now(), origen);
  return true;
}

module.exports = {
  rutas, ruta, crearRuta, obtener, calendario, listarGestion, realizadas, pruebasSociales, estadoEfectivo,
  publicar, modificar, cancelar, estaInscrito, inscritos, inscribir, plazoConsulta,
};
