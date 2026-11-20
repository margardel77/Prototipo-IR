'use strict';
// Tareas automáticas del "Sistema del club" (ACTN-004). Son idempotentes:
// cada una se registra en `tareas_ejecutadas` y no vuelve a ejecutarse.
const db = require('../db/database');
const dates = require('../lib/dates');
const cuotas = require('./cuotas');
const socios = require('./socios');
const participacion = require('./participacion');
const com = require('./comunicaciones');

function yaEjecutada(clave) { return Boolean(db.get('SELECT 1 FROM tareas_ejecutadas WHERE clave=?', clave)); }
function marcar(clave) { db.run('INSERT OR IGNORE INTO tareas_ejecutadas (clave, ejecutada_en) VALUES (?,?)', clave, dates.now()); }

function unaVez(clave, fn) {
  if (yaEjecutada(clave)) return false;
  fn();
  marcar(clave);
  return true;
}

function enviarClasificacionFinal(periodo) {
  const filas = participacion.clasificacion(periodo);
  const cuerpo = filas.length
    ? filas.map((f) => `${f.puesto}. ${f.nombre} ${f.apellidos} · ${f.puntos} pts`).join('\n')
    : 'No hubo participaciones validadas en este periodo.';
  for (const to of com.emailsSociosActivos()) {
    com.enviarEmail(to, `Clasificación final ${dates.etiquetaPeriodo(periodo)}`, cuerpo);
  }
}

// Claves de todas las tareas cuyo momento ya ha llegado en el año de `hoy`.
function tareasDelAnio(hoy) {
  const y = dates.anio(hoy);
  const t = [];
  t.push({ clave: `cuotas-${y}`, desde: `${y}-01-01`, fn: () => cuotas.generarCuotasAnio(y) }); // RQF-004
  t.push({ clave: `periodo-cierre-${y - 1}-2`, desde: `${y}-01-01`, fn: () => enviarClasificacionFinal(dates.periodoPorClave(`${y - 1}-2`)) }); // RQF-012
  t.push({ clave: `recordatorio-1-${y}`, desde: `${y}-03-01`, hasta: `${y}-03-30`, fn: () => cuotas.enviarRecordatorios(y) }); // RQF-005
  t.push({ clave: `recordatorio-2-${y}`, desde: `${y}-03-23`, hasta: `${y}-03-30`, fn: () => cuotas.enviarRecordatorios(y) });
  t.push({ clave: `baja-impago-${y}`, desde: `${y}-03-31`, fn: () => socios.bajaPorImpago(y, hoy) }); // RQF-006
  t.push({ clave: `periodo-cierre-${y}-1`, desde: `${y}-07-01`, fn: () => enviarClasificacionFinal(dates.periodoPorClave(`${y}-1`)) });
  return t;
}

function ejecutar(hoy = dates.today()) {
  const hechas = [];
  for (const t of tareasDelAnio(hoy)) {
    if (hoy < t.desde) continue;
    if (t.hasta && hoy > t.hasta) { marcar(t.clave); continue; } // fuera de su ventana
    try { if (unaVez(t.clave, t.fn)) hechas.push(t.clave); } catch (e) { console.error(`[tareas] ${t.clave}:`, e.message); }
  }
  return hechas;
}

// Marca como ya ejecutadas las tareas pasadas (usado por la carga inicial).
function marcarPasadas(hoy = dates.today()) {
  for (const t of tareasDelAnio(hoy)) if (hoy >= t.desde) marcar(t.clave);
}

function programar() {
  const tick = () => { const h = ejecutar(); if (h.length) console.log('[tareas] ejecutadas:', h.join(', ')); };
  tick();
  return setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { ejecutar, programar, marcarPasadas, tareasDelAnio };
