'use strict';
// SUBS-003 · Subsistema de participación, puntuación y clasificación.
const db = require('../db/database');
const config = require('../config');
const dates = require('../lib/dates');
const salidas = require('./salidas');
const { ReglaError } = require('../lib/errors');

function deSocio(salidaId, socioId) {
  return db.get('SELECT * FROM participaciones WHERE salida_id=? AND socio_id=?', salidaId, socioId);
}

// Estado de la declaración de un socio para una salida, según la fecha (real o simulada).
function estadoDeclaracion(salida, socioId, hoy) {
  const inscrito = salidas.estaInscrito(salida.id, socioId);
  const participacion = deSocio(salida.id, socioId);
  const fechaAlcanzada = hoy >= salida.fecha;
  let estado;
  if (participacion && participacion.fecha_declaracion) estado = 'DECLARADA';
  else if (participacion) estado = 'CONFIRMADA_DIRECTIVA';
  else if (salida.estado === 'CANCELADA') estado = 'CANCELADA';
  else if (salida.tipo === 'PRUEBA_SOCIAL') estado = 'PRUEBA_SOCIAL';
  else if (!inscrito) estado = 'NO_INSCRITO';
  else if (!fechaAlcanzada) estado = 'ANTES';
  else estado = 'DISPONIBLE';
  return { estado, inscrito, participacion, fechaAlcanzada };
}

// Declarar asistencia (una sola vez, desde el día de la salida)
function declarar(salidaId, socioId, { archivo = null, nombreArchivo = null, hoy = dates.today() } = {}) {
  const s = salidas.obtener(salidaId);
  if (!s) throw new ReglaError('La salida no existe.');
  const e = estadoDeclaracion(s, socioId, hoy);
  if (e.estado === 'NO_INSCRITO') throw new ReglaError('Apúntate a esta salida para declarar tu asistencia.');
  if (e.estado === 'ANTES') throw new ReglaError('Podrás declarar tu asistencia desde el día de la salida.');
  if (e.participacion) throw new ReglaError('Ya has enviado tu declaración para esta ruta. No puedes enviarla otra vez.', 'REGN-010');
  if (e.estado !== 'DISPONIBLE') throw new ReglaError('No se puede declarar la asistencia a esta salida.');
  const hora = dates.nowTime();
  db.run(
    "INSERT INTO participaciones (salida_id, socio_id, fecha_declaracion, evidencia_archivo, evidencia_nombre, estado_validacion) VALUES (?,?,?,?,?,'PENDIENTE')",
    salidaId, socioId, `${hoy} ${hora}`, archivo, nombreArchivo,
  );
}

// Lista de inscritos de una salida con su declaración y validación (CU-006)
function listaSalida(salidaId) {
  return db.all(
    `SELECT i.socio_id, i.origen, i.fecha AS fecha_inscripcion, s.nombre, s.apellidos,
            p.id AS participacion_id, p.fecha_declaracion, p.evidencia_archivo, p.evidencia_nombre,
            p.estado_validacion, p.puntos_asignados, p.fecha_validacion
     FROM inscripciones i JOIN socios s ON s.id = i.socio_id
     LEFT JOIN participaciones p ON p.salida_id = i.salida_id AND p.socio_id = i.socio_id
     WHERE i.salida_id = ? ORDER BY i.id`, salidaId,
  );
}

function puntosPorTipo(tipo) { return config.puntosPorTipo[tipo] ?? 0; }

// Confirmar asistencia: valida la declaración o confirma en persona (sin foto).
function confirmar(salidaId, socioId, validadorId) {
  const s = salidas.obtener(salidaId);
  if (!s) throw new ReglaError('La salida no existe.');
  if (s.estado_efectivo !== 'REALIZADA') throw new ReglaError('Solo se puede validar la asistencia a una salida realizada.');
  if (s.tipo === 'PRUEBA_SOCIAL') throw new ReglaError('En una prueba social los puntos se asignan al guardar el resultado.');
  if (!salidas.estaInscrito(salidaId, socioId)) throw new ReglaError('El socio no está inscrito en esta salida.');
  const puntos = puntosPorTipo(s.tipo); // REGN-011 / REGN-015
  const p = deSocio(salidaId, socioId);
  if (p) {
    db.run("UPDATE participaciones SET estado_validacion='APROBADA', validador_id=?, fecha_validacion=?, puntos_asignados=? WHERE id=?",
      validadorId, dates.now(), puntos, p.id);
  } else {
    db.run("INSERT INTO participaciones (salida_id, socio_id, estado_validacion, validador_id, fecha_validacion, puntos_asignados) VALUES (?,?,'APROBADA',?,?,?)",
      salidaId, socioId, validadorId, dates.now(), puntos);
  }
}

function rechazar(salidaId, socioId, validadorId) {
  const p = deSocio(salidaId, socioId);
  if (!p) throw new ReglaError('Este socio no ha enviado ninguna declaración.');
  db.run("UPDATE participaciones SET estado_validacion='RECHAZADA', validador_id=?, fecha_validacion=?, puntos_asignados=NULL WHERE id=?",
    validadorId, dates.now(), p.id);
}

function pendientesPorSalida() {
  return db.all(`SELECT salida_id, COUNT(*) n FROM participaciones WHERE estado_validacion='PENDIENTE' GROUP BY salida_id`);
}

// ----- Pruebas sociales (REGN-012) -----
// 1.º 120 · 2.º 105 · 3.º 90 · del 4.º al 20.º se restan 5 por puesto · desde el 20.º, 5 pts.
function baremo(posicion) {
  if (!posicion || posicion < 1) return 0;
  if (posicion === 1) return 120;
  if (posicion === 2) return 105;
  if (posicion === 3) return 90;
  if (posicion <= 20) return 85 - 5 * (posicion - 4);
  return 5;
}

// Ordena por tiempo y asigna puesto (empates comparten puesto) y puntos.
function clasificarTiempos(filas) {
  const conTiempo = filas.filter((f) => f.tiempo_segundos > 0).sort((a, b) => a.tiempo_segundos - b.tiempo_segundos);
  let anterior = null; let puesto = 0;
  conTiempo.forEach((f, i) => {
    if (f.tiempo_segundos !== anterior) puesto = i + 1;
    anterior = f.tiempo_segundos;
    f.posicion = puesto; f.puntos = baremo(puesto);
  });
  for (const f of filas) if (!(f.tiempo_segundos > 0)) { f.posicion = null; f.puntos = null; }
  return [...conTiempo, ...filas.filter((f) => !(f.tiempo_segundos > 0))];
}

function resultadosPrueba(salidaId) {
  const filas = db.all(
    `SELECT i.socio_id, i.origen, s.nombre, s.apellidos, r.tiempo_segundos, r.guardado
     FROM inscripciones i JOIN socios s ON s.id = i.socio_id
     LEFT JOIN resultados_prueba r ON r.salida_id = i.salida_id AND r.socio_id = i.socio_id
     WHERE i.salida_id = ? ORDER BY i.id`, salidaId,
  );
  return clasificarTiempos(filas);
}

function resumenPrueba(salidaId) {
  const filas = resultadosPrueba(salidaId);
  return { inscritos: filas.length, conTiempo: filas.filter((f) => f.tiempo_segundos > 0).length };
}

// Guardar resultado: registra tiempos, puestos y puntos y valida la participación.
function guardarResultados(salidaId, tiempos, validadorId) {
  const s = salidas.obtener(salidaId);
  if (!s || s.tipo !== 'PRUEBA_SOCIAL') throw new ReglaError('Selecciona una prueba social.');
  if (s.estado_efectivo !== 'REALIZADA') throw new ReglaError('Solo se puede registrar el resultado de una prueba ya celebrada.');
  return db.tx(() => {
    const filas = db.all('SELECT socio_id FROM inscripciones WHERE salida_id = ?', salidaId)
      .map((i) => ({ socio_id: i.socio_id, tiempo_segundos: tiempos[i.socio_id] ?? null }));
    clasificarTiempos(filas);
    for (const f of filas) {
      let participacionId = null;
      const p = deSocio(salidaId, f.socio_id);
      if (f.posicion) {
        if (p) {
          db.run("UPDATE participaciones SET estado_validacion='APROBADA', validador_id=?, fecha_validacion=?, puntos_asignados=? WHERE id=?",
            validadorId, dates.now(), f.puntos, p.id);
          participacionId = p.id;
        } else {
          const r = db.run("INSERT INTO participaciones (salida_id, socio_id, estado_validacion, validador_id, fecha_validacion, puntos_asignados) VALUES (?,?,'APROBADA',?,?,?)",
            salidaId, f.socio_id, validadorId, dates.now(), f.puntos);
          participacionId = Number(r.lastInsertRowid);
        }
      } else if (p && !p.fecha_declaracion) {
        db.run('DELETE FROM participaciones WHERE id=?', p.id);
      } else if (p) {
        db.run("UPDATE participaciones SET estado_validacion='PENDIENTE', puntos_asignados=NULL, validador_id=NULL, fecha_validacion=NULL WHERE id=?", p.id);
      }
      db.run(
        `INSERT INTO resultados_prueba (salida_id, socio_id, participacion_id, tiempo_segundos, posicion, puntos, guardado) VALUES (?,?,?,?,?,?,1)
         ON CONFLICT(salida_id, socio_id) DO UPDATE SET participacion_id=excluded.participacion_id, tiempo_segundos=excluded.tiempo_segundos,
           posicion=excluded.posicion, puntos=excluded.puntos, guardado=1`,
        salidaId, f.socio_id, participacionId, f.tiempo_segundos, f.posicion, f.puntos,
      );
    }
    return filas.filter((f) => f.posicion).length;
  });
}

// ----- Categorías de edad («Máster 30 incluye socios de 30 a 39 años») -----
const CATEGORIAS = [
  { clave: 'sub30', etiqueta: 'Sub 30', min: 0, max: 29 },
  { clave: 'master30', etiqueta: 'Máster 30', min: 30, max: 39 },
  { clave: 'master40', etiqueta: 'Máster 40', min: 40, max: 49 },
  { clave: 'master50', etiqueta: 'Máster 50', min: 50, max: 59 },
  { clave: 'master60', etiqueta: 'Máster 60', min: 60, max: 200 },
];
const categoria = (clave) => CATEGORIAS.find((c) => c.clave === clave) || null;

// Filtra por categoría de edad y asigna el puesto (los empates comparten puesto).
function puestos(filas, clave, hoy = dates.today()) {
  const cat = categoria(clave);
  const lista = filas.map((f) => ({ ...f, edad: dates.edad(f.fecha_nacimiento, hoy) }))
    .filter((f) => !cat || (f.edad >= cat.min && f.edad <= cat.max));
  let anterior = null; let puesto = 0;
  lista.forEach((f, i) => { if (f.puntos !== anterior) puesto = i + 1; anterior = f.puntos; f.puesto = puesto; });
  return lista;
}

// ----- Clasificación general del periodo (REGN-013, RQF-011) -----
function clasificacion(periodo, clave = '') {
  const filas = db.all(
    `SELECT s.id AS socio_id, s.nombre, s.apellidos, s.fecha_nacimiento, SUM(p.puntos_asignados) AS puntos
     FROM participaciones p JOIN salidas sa ON sa.id = p.salida_id JOIN socios s ON s.id = p.socio_id
     WHERE p.estado_validacion = 'APROBADA' AND p.puntos_asignados > 0 AND sa.fecha BETWEEN ? AND ?
     GROUP BY s.id ORDER BY puntos DESC, s.apellidos, s.nombre`, periodo.inicio, periodo.fin,
  );
  return puestos(filas, clave);
}

// ----- Clasificación de salidas: resultado de las pruebas sociales de una fecha -----
function fechasConClasificacion() {
  return db.all(
    `SELECT DISTINCT sa.fecha FROM resultados_prueba r JOIN salidas sa ON sa.id = r.salida_id
     WHERE r.guardado = 1 AND r.posicion IS NOT NULL ORDER BY sa.fecha`,
  ).map((r) => r.fecha);
}

function clasificacionFecha(fecha, clave = '') {
  const filas = db.all(
    `SELECT s.id AS socio_id, s.nombre, s.apellidos, s.fecha_nacimiento, SUM(r.puntos) AS puntos, MIN(r.posicion) AS posicion
     FROM resultados_prueba r JOIN salidas sa ON sa.id = r.salida_id JOIN socios s ON s.id = r.socio_id
     WHERE sa.fecha = ? AND r.guardado = 1 AND r.posicion IS NOT NULL
     GROUP BY s.id ORDER BY puntos DESC, posicion, s.apellidos, s.nombre`, fecha,
  );
  return puestos(filas, clave);
}

function periodosDisponibles(hoy = dates.today()) {
  const claves = new Set([dates.periodoDe(hoy).clave]);
  for (const r of db.all("SELECT DISTINCT sa.fecha FROM participaciones p JOIN salidas sa ON sa.id=p.salida_id WHERE p.estado_validacion='APROBADA'")) {
    claves.add(dates.periodoDe(r.fecha).clave);
  }
  return [...claves].sort().reverse().map(dates.periodoPorClave);
}

module.exports = {
  deSocio, estadoDeclaracion, declarar, listaSalida, confirmar, rechazar, pendientesPorSalida, puntosPorTipo,
  baremo, clasificarTiempos, resultadosPrueba, resumenPrueba, guardarResultados, clasificacion, periodosDisponibles,
  CATEGORIAS, categoria, fechasConClasificacion, clasificacionFecha,
};
