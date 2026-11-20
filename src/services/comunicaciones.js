'use strict';
// SUBS-004 · Subsistema de comunicación y comprobantes.
// Todo mensaje queda registrado en la bandeja `comunicaciones`. Si hay un
// servidor SMTP configurado se envía de verdad; si no, queda como SIMULADO.
// WhatsApp se registra para la pasarela de mensajería (RQF-002).
const db = require('../db/database');
const config = require('../config');
const dates = require('../lib/dates');

let transporter = null;
function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

function registrar(canal, destinatario, asunto, cuerpo, estado) {
  const r = db.run(
    'INSERT INTO comunicaciones (canal, destinatario, asunto, cuerpo, creado_en, enviado_en, estado) VALUES (?,?,?,?,?,?,?)',
    canal, destinatario, asunto || null, cuerpo, dates.now(), estado === 'PENDIENTE' ? null : dates.now(), estado,
  );
  return Number(r.lastInsertRowid);
}

// Devuelve true si el correo se ha entregado (o simulado) correctamente.
function enviarEmail(destinatario, asunto, cuerpo) {
  const t = getTransporter();
  if (!t) { registrar('EMAIL', destinatario, asunto, cuerpo, 'SIMULADO'); return true; }
  const id = registrar('EMAIL', destinatario, asunto, cuerpo, 'PENDIENTE');
  t.sendMail({ from: config.smtp.from, to: destinatario, subject: asunto, text: cuerpo })
    .then(() => db.run("UPDATE comunicaciones SET estado='ENVIADO', enviado_en=? WHERE id=?", dates.now(), id))
    .catch((e) => db.run("UPDATE comunicaciones SET estado='ERROR', error=? WHERE id=?", String(e.message || e), id));
  return true;
}

function enviarWhatsappGrupo(cuerpo) {
  registrar('WHATSAPP', 'Grupo CLUB CICLISTA BRENES', null, cuerpo, 'SIMULADO');
  return true;
}

function emailsDirectiva(hoy = dates.today()) {
  return db.all(
    `SELECT DISTINCT s.email FROM cargos c JOIN socios s ON s.id = c.socio_id
     WHERE c.fecha_inicio <= ? AND (c.fecha_fin IS NULL OR c.fecha_fin >= ?)`, hoy, hoy,
  ).map((r) => r.email);
}

function emailsSociosActivos() {
  return db.all("SELECT email FROM socios WHERE estado='ACTIVO'").map((r) => r.email);
}

function bandeja(limit = 50) {
  return db.all('SELECT * FROM comunicaciones ORDER BY id DESC LIMIT ?', limit);
}

module.exports = { enviarEmail, enviarWhatsappGrupo, emailsDirectiva, emailsSociosActivos, bandeja };
