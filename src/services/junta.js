'use strict';
// SUBS-005 · Subsistema de gestión de la junta directiva y permisos.
const db = require('../db/database');
const config = require('../config');
const dates = require('../lib/dates');
const { ReglaError } = require('../lib/errors');

// Funciones de gestión que habilita cada cargo
const PERMISOS_CARGO = {
  PRESIDENTE: ['socios', 'salidas', 'participacion', 'cuotas'],
  SECRETARIO: ['socios', 'salidas', 'participacion'],
  TESORERO: ['socios', 'cuotas'],
  VOCAL: ['salidas', 'participacion'], // responsable de rutas y puntuación
};
const OBLIGATORIOS = ['PRESIDENTE', 'SECRETARIO', 'TESORERO']; // REGN-005

function cargosVigentes(socioId, hoy = dates.today()) {
  return db.all(
    `SELECT * FROM cargos WHERE socio_id = ? AND fecha_inicio <= ? AND (fecha_fin IS NULL OR fecha_fin >= ?)`,
    socioId, hoy, hoy,
  );
}

function permisos(socioId, hoy = dates.today()) {
  const socio = db.get('SELECT estado FROM socios WHERE id = ?', socioId);
  if (!socio || socio.estado !== 'ACTIVO') return [];
  const set = new Set();
  for (const c of cargosVigentes(socioId, hoy)) (PERMISOS_CARGO[c.tipo] || []).forEach((p) => set.add(p));
  return ['socios', 'salidas', 'participacion', 'cuotas'].filter((p) => set.has(p));
}

function junta(hoy = dates.today()) {
  return db.all(
    `SELECT c.*, s.nombre, s.apellidos FROM cargos c JOIN socios s ON s.id = c.socio_id
     WHERE c.fecha_inicio <= ? AND (c.fecha_fin IS NULL OR c.fecha_fin >= ?) ORDER BY c.tipo`, hoy, hoy,
  );
}

function cargoActual(socioId, hoy = dates.today()) {
  return cargosVigentes(socioId, hoy)[0] || null;
}

// Asigna (o retira, con tipo vacío) el cargo de un socio respetando REGN-005 y REGN-006.
function asignarCargo(socioId, tipo, hoy = dates.today()) {
  return db.tx(() => {
    const actual = cargoActual(socioId, hoy);
    if (actual && actual.tipo === (tipo || null)) return;
    if (actual) {
      const otros = db.get(
        `SELECT COUNT(*) n FROM cargos WHERE tipo = ? AND socio_id <> ? AND fecha_inicio <= ? AND (fecha_fin IS NULL OR fecha_fin >= ?)`,
        actual.tipo, socioId, hoy, hoy,
      ).n;
      if (OBLIGATORIOS.includes(actual.tipo) && otros === 0) {
        throw new ReglaError(`La junta debe tener siempre cubierto el cargo de ${actual.tipo.toLowerCase()}. Asigna antes ese cargo a otra persona.`, 'REGN-005');
      }
      db.run('UPDATE cargos SET fecha_fin = ? WHERE id = ?', dates.addDays(hoy, -1) < actual.fecha_inicio ? actual.fecha_inicio : dates.addDays(hoy, -1), actual.id);
    }
    if (tipo) {
      if (!PERMISOS_CARGO[tipo]) throw new ReglaError('Cargo no válido.');
      const socio = db.get('SELECT estado FROM socios WHERE id = ?', socioId);
      if (!socio || socio.estado !== 'ACTIVO') throw new ReglaError('Solo un socio activo puede ocupar un cargo de la junta.');
      const fin = dates.addDays(dates.addYears(hoy, config.mandatoMaxAnios), -1); // REGN-006
      db.run('INSERT INTO cargos (socio_id, tipo, fecha_inicio, fecha_fin) VALUES (?,?,?,?)', socioId, tipo, hoy, fin);
    }
  });
}

module.exports = { PERMISOS_CARGO, permisos, cargosVigentes, cargoActual, junta, asignarCargo };
