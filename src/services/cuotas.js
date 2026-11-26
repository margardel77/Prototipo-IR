'use strict';
// SUBS-001 (parte de cuotas) · Cuotas anuales, pagos y comprobantes.
const db = require('../db/database');
const config = require('../config');
const dates = require('../lib/dates');
const fmt = require('../lib/format');
const com = require('./comunicaciones');
const { ReglaError } = require('../lib/errors');

function importeAnio(anio) {
  const r = db.get('SELECT importe FROM importes_cuota WHERE anio = ?', anio);
  return r ? r.importe : config.cuotaImporteDefecto;
}

// RQF-004 · Genera la cuota del año para cada socio activo (idempotente).
function generarCuotasAnio(anio) {
  const importe = importeAnio(anio);
  const socios = db.all("SELECT id FROM socios WHERE estado = 'ACTIVO'");
  let n = 0;
  for (const s of socios) {
    const r = db.run(
      "INSERT OR IGNORE INTO cuotas (socio_id, anio, importe, estado) VALUES (?,?,?,'PENDIENTE')", s.id, anio, importe,
    );
    n += Number(r.changes);
  }
  return n;
}

// El número de socio que se muestra es el que tenía en ese ejercicio (el último asignado hasta
// el 31 de diciembre), aunque después lo haya perdido por una baja («N.º liberado»).
const SELECT_CUOTA = `
  SELECT c.*, s.nombre, s.apellidos, s.email, s.estado AS socio_estado,
         (SELECT numero FROM asignaciones_numero a WHERE a.socio_id = s.id AND a.fecha_asignacion <= (c.anio || '-12-31')
          ORDER BY a.fecha_asignacion DESC, a.id DESC LIMIT 1) AS numero,
         cp.id AS comprobante_id, cp.fecha_emision, cp.fecha_envio, cp.mensaje
  FROM cuotas c JOIN socios s ON s.id = c.socio_id
  LEFT JOIN comprobantes cp ON cp.cuota_id = c.id`;

// Estado que se muestra: una cuota sin pagar de un socio que ya está de baja aparece como «Baja».
function estadoVisible(c) {
  if (c.estado === 'PAGADA') return 'PAGADA';
  return c.socio_estado === 'BAJA' ? 'BAJA' : 'PENDIENTE';
}
const decorar = (c) => (c ? { ...c, estado_visible: estadoVisible(c) } : c);

// En el orden en que se registraron (como en el listado del mockup)
function listarPorAnio(anio) {
  return db.all(`${SELECT_CUOTA} WHERE c.anio = ? ORDER BY c.id`, anio).map(decorar);
}
function obtener(id) { return decorar(db.get(`${SELECT_CUOTA} WHERE c.id = ?`, id)); }
function deSocio(socioId) { return db.all(`${SELECT_CUOTA} WHERE c.socio_id = ? ORDER BY c.anio DESC`, socioId).map(decorar); }
function deSocioAnio(socioId, anio) { return decorar(db.get(`${SELECT_CUOTA} WHERE c.socio_id = ? AND c.anio = ?`, socioId, anio)); }
function aniosDisponibles() { return db.all('SELECT DISTINCT anio FROM cuotas ORDER BY anio DESC').map((r) => r.anio); }

function textoComprobante(c) {
  return [
    `${config.club.nombre} · Comprobante de cuota ${c.anio}`,
    `Socio n.º ${c.numero ?? '—'}: ${c.nombre} ${c.apellidos}`,
    `Cuota anual ${c.anio}: ${fmt.euros(c.importe)} · Abonada`,
    `Fecha de pago: ${dates.corta(c.fecha_pago)}`,
    `Forma de pago: ${fmt.ETIQ.formaPago[c.forma_pago]}`,
  ].join('\n');
}

// RQF-007 · Emite el comprobante y lo envía por correo al socio.
function emitirComprobante(cuotaId, hoy = dates.today()) {
  const c = obtener(cuotaId);
  if (!c || c.estado !== 'PAGADA') throw new ReglaError('Solo una cuota pagada tiene comprobante.');
  if (c.comprobante_id) return c;
  const mensaje = textoComprobante(c);
  db.run('INSERT INTO comprobantes (cuota_id, fecha_emision, mensaje) VALUES (?,?,?)', cuotaId, hoy, mensaje);
  let enviado = false;
  try { enviado = com.enviarEmail(c.email, `Comprobante de tu cuota ${c.anio}`, mensaje); } catch { enviado = false; }
  if (enviado) {
    db.run('UPDATE comprobantes SET fecha_envio = ? WHERE cuota_id = ?', hoy, cuotaId);
  } else {
    for (const to of com.emailsDirectiva(hoy)) {
      com.enviarEmail(to, 'Aviso a tesorería: comprobante no enviado', `No se pudo enviar el comprobante de ${c.nombre} ${c.apellidos} (${c.anio}). Está disponible en su área personal.`);
    }
  }
  return obtener(cuotaId);
}

// La tesorería registra un pago ya recibido en efectivo o con tarjeta.
function registrarPago(cuotaId, { fecha, forma, estado = 'PAGADA' }, registradoPor) {
  if (estado !== 'PAGADA') throw new ReglaError('Para registrar el pago, marca la cuota como abonada.');
  const fechaPago = dates.parseFecha(fecha);
  if (!fechaPago) throw new ReglaError('Indica una fecha de pago válida (por ejemplo, 12 nov 2026).');
  if (fechaPago > dates.today()) throw new ReglaError('La fecha de pago no puede ser posterior a hoy.');
  if (!['TARJETA', 'EFECTIVO'].includes(forma)) throw new ReglaError('La forma de pago debe ser tarjeta o efectivo.');
  return db.tx(() => {
    const c = obtener(cuotaId);
    if (!c) throw new ReglaError('La cuota seleccionada no existe.');
    if (c.estado === 'PAGADA') throw new ReglaError('Esta cuota ya está registrada como abonada.');
    if (c.estado_visible === 'BAJA') throw new ReglaError('El socio está de baja y su número se ha liberado. Si vuelve, registra una nueva alta.');
    db.run("UPDATE cuotas SET estado='PAGADA', fecha_pago=?, forma_pago=?, registrado_por=? WHERE id=?", fechaPago, forma, registradoPor || null, cuotaId);
    return emitirComprobante(cuotaId, dates.today());
  });
}

// Pago de la cuota con la tarjeta de prueba desde «Mi cuota» (pago simulado: no hay pasarela real).
function pagarConTarjeta(socioId, anio, hoy = dates.today()) {
  return db.tx(() => {
    const c = deSocioAnio(socioId, anio);
    if (!c) throw new ReglaError('No tienes ninguna cuota de ese ejercicio.');
    if (c.estado === 'PAGADA') throw new ReglaError('Esta cuota ya está abonada.');
    db.run("UPDATE cuotas SET estado='PAGADA', fecha_pago=?, forma_pago='TARJETA', registrado_por=? WHERE id=?", hoy, socioId, c.id);
    return emitirComprobante(c.id, hoy);
  });
}

// RQF-008 · Informe del estado de las cuotas de un año
function informe(anio) {
  const filas = listarPorAnio(anio);
  const pagadas = filas.filter((f) => f.estado_visible === 'PAGADA');
  const pendientes = filas.filter((f) => f.estado_visible === 'PENDIENTE');
  const bajas = filas.filter((f) => f.estado_visible === 'BAJA');
  return {
    anio, filas,
    numPagadas: pagadas.length, numPendientes: pendientes.length, numBajas: bajas.length,
    recaudado: pagadas.reduce((a, f) => a + f.importe, 0),
    pendiente: pendientes.reduce((a, f) => a + f.importe, 0),
  };
}

function informeCsv(anio) {
  const inf = informe(anio);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [['Número', 'Nombre', 'Apellidos', 'Ejercicio', 'Importe', 'Estado', 'Fecha de pago', 'Forma de pago'].map(esc).join(';')];
  for (const f of inf.filas) {
    lineas.push([f.numero, f.nombre, f.apellidos, f.anio, f.importe.toFixed(2).replace('.', ','), fmt.ETIQ.estadoCuota[f.estado_visible],
      f.fecha_pago ? dates.isoToDmy(f.fecha_pago) : '', f.forma_pago ? fmt.ETIQ.formaPago[f.forma_pago] : ''].map(esc).join(';'));
  }
  lineas.push('');
  lineas.push([esc('Cuotas pagadas'), inf.numPagadas].join(';'));
  lineas.push([esc('Cuotas pendientes'), inf.numPendientes].join(';'));
  lineas.push([esc('Socios de baja'), inf.numBajas].join(';'));
  lineas.push([esc('Total recaudado'), esc(inf.recaudado.toFixed(2).replace('.', ','))].join(';'));
  lineas.push([esc('Total pendiente'), esc(inf.pendiente.toFixed(2).replace('.', ','))].join(';'));
  return `﻿${lineas.join('\r\n')}`;
}

// RQF-005 · Recordatorio de renovación
function enviarRecordatorios(anio) {
  const pendientes = db.all(
    `SELECT c.*, s.email, s.nombre FROM cuotas c JOIN socios s ON s.id = c.socio_id
     WHERE c.anio = ? AND c.estado = 'PENDIENTE' AND s.estado = 'ACTIVO'`, anio,
  );
  for (const c of pendientes) {
    com.enviarEmail(c.email, `Recordatorio: renueva tu cuota ${anio}`,
      `Hola, ${c.nombre}:\n\nTu cuota anual ${anio} (${fmt.euros(c.importe)}) sigue pendiente. La fecha límite de renovación es el 30 de marzo.\n` +
      'Puedes pagarla con tarjeta desde «Mi cuota» o en efectivo en la sede del club. Si no la abonas en plazo pasarás a estado de baja y perderás tu número de socio.');
  }
  return pendientes.length;
}

module.exports = {
  importeAnio, generarCuotasAnio, listarPorAnio, obtener, deSocio, deSocioAnio, aniosDisponibles, estadoVisible,
  registrarPago, pagarConTarjeta, emitirComprobante, informe, informeCsv, enviarRecordatorios,
};
