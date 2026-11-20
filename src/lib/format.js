'use strict';

function euros(n) {
  const v = Number(n || 0);
  return `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })} €`;
}
function km(n) {
  const v = Number(n || 0);
  return `${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;
}
function segundosAHms(s) {
  if (s == null) return '';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return [h, m, x].map((v) => String(v).padStart(2, '0')).join(':');
}
function hmsASegundos(txt) {
  const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(String(txt || '').trim());
  if (!m) return null;
  const s = +m[1] * 3600 + +m[2] * 60 + +m[3];
  return s > 0 ? s : null;
}
const nombreCompleto = (s) => (s ? `${s.nombre} ${s.apellidos}`.trim() : '');
const inicial = (s) => (s.apellidos || s.nombre || '?').trim().charAt(0).toUpperCase();

const ETIQ = {
  formaPago: { BANCO: 'Banco', EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta (simulación)' },
  estadoCuota: { PAGADA: 'Abonada', PENDIENTE: 'Pendiente', BAJA: 'Baja' },
  estadoSocio: { ACTIVO: 'Activo', BAJA: 'Baja', PENDIENTE: 'Pendiente de revisión' },
  tipoSalida: { SEMANAL: 'Semanal', ESPECIAL: 'Especial', PRUEBA_SOCIAL: 'Prueba social' },
  estadoSalida: { PUBLICADA: 'Publicada', REALIZADA: 'Realizada', CANCELADA: 'Cancelada' },
  validacion: { PENDIENTE: 'Pendiente', APROBADA: 'Validada', RECHAZADA: 'Rechazada' },
  cargo: { PRESIDENTE: 'Presidente', SECRETARIO: 'Secretario', TESORERO: 'Tesorero', VOCAL: 'Vocal' },
};

module.exports = { euros, km, segundosAHms, hmsASegundos, nombreCompleto, inicial, ETIQ };
