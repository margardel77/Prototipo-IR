'use strict';
// SUBS-001 · Subsistema de gestión de socios (altas, bajas, renovaciones, números).
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const dates = require('../lib/dates');
const cuotas = require('./cuotas');
const com = require('./comunicaciones');
const { ReglaError } = require('../lib/errors');

const SELECT_SOCIO = `
  SELECT s.*, (SELECT numero FROM asignaciones_numero a WHERE a.socio_id = s.id AND a.fecha_fin IS NULL) AS numero
  FROM socios s`;

function obtener(id) { return db.get(`${SELECT_SOCIO} WHERE s.id = ?`, id); }
function porEmail(email) { return db.get(`${SELECT_SOCIO} WHERE s.email = ?`, String(email || '').trim()); }

// Listado de socios. Los antiguos socios (de baja) solo aparecen al buscarlos por nombre o número.
function listar({ q = '', incluirPendientes = true, incluirBajas = Boolean(q.trim()) } = {}) {
  const filtro = `%${q.trim()}%`;
  const rows = db.all(
    `${SELECT_SOCIO} WHERE (? = '' OR (s.nombre || ' ' || s.apellidos) LIKE ?
       OR EXISTS (SELECT 1 FROM asignaciones_numero a WHERE a.socio_id = s.id AND CAST(a.numero AS TEXT) = ?))
     ${incluirPendientes ? '' : "AND s.estado <> 'PENDIENTE'"}
     ${incluirBajas ? '' : "AND s.estado <> 'BAJA'"}`,
    q.trim(), filtro, q.trim(),
  );
  const orden = { PENDIENTE: 0, ACTIVO: 1, BAJA: 2 };
  return rows.sort((a, b) => (orden[a.estado] - orden[b.estado]) || ((a.numero ?? 1e9) - (b.numero ?? 1e9)) || a.nombre.localeCompare(b.nombre));
}

function activos() {
  return db.all(`${SELECT_SOCIO} WHERE s.estado = 'ACTIVO' ORDER BY s.nombre, s.apellidos`);
}

function historialAltas(socioId) {
  return db.all('SELECT * FROM asignaciones_numero WHERE socio_id = ? ORDER BY fecha_asignacion DESC, id DESC', socioId);
}

// REGN-003 / REGN-004 · siguiente número libre al final de la lista
function siguienteNumero() {
  return (db.get('SELECT MAX(numero) m FROM asignaciones_numero').m || 0) + 1;
}

async function autenticar(email, password) {
  const s = porEmail(email);
  if (!s) return null;
  const ok = await bcrypt.compare(String(password || ''), s.password_hash);
  return ok ? s : null;
}

function validarDatos(d, { conPassword }) {
  const errores = {};
  const req = (k, msg) => { if (!String(d[k] || '').trim()) errores[k] = msg; };
  req('nombre', 'Escribe tu nombre.');
  req('apellidos', 'Escribe tus apellidos.');
  req('direccion', 'Escribe tu dirección.');
  req('telefono', 'Escribe un teléfono de contacto.');
  const fn = dates.parseFecha(d.fecha_nacimiento);
  if (!fn) errores.fecha_nacimiento = 'Usa el formato DD/MM/AAAA.';
  else if (fn >= dates.today()) errores.fecha_nacimiento = 'La fecha de nacimiento no es válida.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email || '').trim())) errores.email = 'Escribe un correo electrónico válido.';
  if (d.telefono && !/^[+\d][\d\s]{7,}$/.test(String(d.telefono).trim())) errores.telefono = 'Escribe un teléfono válido.';
  if (conPassword) {
    if (String(d.password || '').length < 8) errores.password = 'Usa al menos 8 caracteres.';
    if (d.password !== d.password2) errores.password2 = 'Las contraseñas no coinciden.';
  }
  return { errores, fechaNacimiento: fn };
}

// Paso 1 + 2 del registro: crea la solicitud (estado PENDIENTE) tras el pago simulado.
function crearSolicitud(d, pagoSimulado) {
  const { errores, fechaNacimiento } = validarDatos(d, { conPassword: true });
  if (Object.keys(errores).length) throw Object.assign(new ReglaError('Revisa los datos del formulario.'), { errores });
  if (porEmail(d.email)) throw Object.assign(new ReglaError('Ya existe una cuenta con ese correo electrónico.'), { errores: { email: 'Ya existe una cuenta con ese correo.' } });
  const hash = bcrypt.hashSync(d.password, 10);
  const r = db.run(
    `INSERT INTO socios (nombre, apellidos, fecha_nacimiento, direccion, telefono, email, password_hash, estado, solicitud_fecha, solicitud_pago, creado_en)
     VALUES (?,?,?,?,?,?,?,'PENDIENTE',?,?,?)`,
    d.nombre.trim(), d.apellidos.trim(), fechaNacimiento, d.direccion.trim(), d.telefono.trim(), d.email.trim().toLowerCase(), hash,
    dates.today(), pagoSimulado || null, dates.now(),
  );
  for (const to of com.emailsDirectiva()) {
    com.enviarEmail(to, 'Nueva solicitud de alta', `${d.nombre} ${d.apellidos} ha solicitado el alta en el club. Revísala en la gestión de socios.`);
  }
  return Number(r.lastInsertRowid);
}

// Alta directa por la directiva (mockup «Nuevo socio»): queda activo con el siguiente número libre
// y con la cuota del año pendiente, que se abona por banco, en efectivo o desde «Mi cuota».
function crearDirecto(d, actorId, hoy = dates.today()) {
  const { errores, fechaNacimiento } = validarDatos(d, { conPassword: true });
  if (!errores.email && porEmail(d.email)) errores.email = 'Ya existe una cuenta con ese correo electrónico.';
  if (Object.keys(errores).length) throw Object.assign(new ReglaError('Revisa los datos del formulario.'), { errores });
  const hash = bcrypt.hashSync(d.password, 10);
  return db.tx(() => {
    const r = db.run(
      `INSERT INTO socios (nombre, apellidos, fecha_nacimiento, direccion, telefono, email, password_hash, fecha_alta, estado, creado_en)
       VALUES (?,?,?,?,?,?,?,?,'ACTIVO',?)`,
      d.nombre.trim(), d.apellidos.trim(), fechaNacimiento, d.direccion.trim(), d.telefono.trim(), d.email.trim().toLowerCase(), hash, hoy, dates.now(),
    );
    const id = Number(r.lastInsertRowid);
    const numero = siguienteNumero();
    db.run('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion) VALUES (?,?,?)', id, numero, hoy);
    const anio = dates.anio(hoy);
    db.run("INSERT INTO cuotas (socio_id, anio, importe, estado, registrado_por) VALUES (?,?,?,'PENDIENTE',?)", id, anio, cuotas.importeAnio(anio), actorId || null);
    com.enviarEmail(d.email.trim(), 'Bienvenido al Club Ciclista de Brenes',
      `Hola, ${d.nombre.trim()}:\n\nLa directiva te ha dado de alta en el club con el número de socio ${numero}. Ya puedes iniciar sesión en el área de socios con este correo.\n` +
      `Tu cuota de ${anio} está pendiente: puedes abonarla por banco, en efectivo en la sede o desde «Mi cuota».`);
    return { id, numero };
  });
}

// La directiva revisa la solicitud y da el alta: número nuevo + cuota del año abonada.
function aprobarSolicitud(socioId, actorId, hoy = dates.today()) {
  return db.tx(() => {
    const s = obtener(socioId);
    if (!s || s.estado !== 'PENDIENTE') throw new ReglaError('Esta solicitud ya no está pendiente.');
    const numero = siguienteNumero();
    db.run('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion) VALUES (?,?,?)', socioId, numero, hoy);
    db.run("UPDATE socios SET estado='ACTIVO', fecha_alta=? WHERE id=?", hoy, socioId);
    const anio = dates.anio(hoy);
    const importe = cuotas.importeAnio(anio);
    const pagada = Boolean(s.solicitud_pago);
    const r = db.run(
      'INSERT INTO cuotas (socio_id, anio, importe, estado, fecha_pago, forma_pago, registrado_por) VALUES (?,?,?,?,?,?,?)',
      socioId, anio, importe, pagada ? 'PAGADA' : 'PENDIENTE', pagada ? s.solicitud_fecha : null, pagada ? 'TARJETA' : null, actorId || null,
    );
    if (pagada) cuotas.emitirComprobante(Number(r.lastInsertRowid), hoy);
    com.enviarEmail(s.email, 'Bienvenido al Club Ciclista de Brenes',
      `Hola, ${s.nombre}:\n\nLa directiva ha revisado tu solicitud. Ya eres socio del club con el número ${numero}. Ya puedes iniciar sesión en el área de socios.`);
    return numero;
  });
}

function rechazarSolicitud(socioId) {
  const s = obtener(socioId);
  if (!s || s.estado !== 'PENDIENTE') throw new ReglaError('Esta solicitud ya no está pendiente.');
  db.run("UPDATE socios SET estado='BAJA' WHERE id=?", socioId);
}

// Baja: se cierra la asignación vigente; el número queda en el histórico.
function darDeBaja(socioId, hoy = dates.today()) {
  return db.tx(() => {
    const s = obtener(socioId);
    if (!s || s.estado !== 'ACTIVO') throw new ReglaError('Solo se puede dar de baja a un socio activo.');
    const cargo = db.get('SELECT COUNT(*) n FROM cargos WHERE socio_id=? AND fecha_inicio<=? AND (fecha_fin IS NULL OR fecha_fin>=?)', socioId, hoy, hoy).n;
    if (cargo) throw new ReglaError('Retira antes su cargo en la junta directiva.');
    db.run('UPDATE asignaciones_numero SET fecha_fin=? WHERE socio_id=? AND fecha_fin IS NULL', hoy, socioId);
    db.run("UPDATE socios SET estado='BAJA' WHERE id=?", socioId);
  });
}

// REGN-004 · Reingreso: nueva alta con el siguiente número libre.
function reingresar(socioId, hoy = dates.today()) {
  return db.tx(() => {
    const s = obtener(socioId);
    if (!s || s.estado !== 'BAJA') throw new ReglaError('Solo se puede registrar el reingreso de un socio de baja.');
    const numero = siguienteNumero();
    db.run('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion) VALUES (?,?,?)', socioId, numero, hoy);
    db.run("UPDATE socios SET estado='ACTIVO', fecha_alta=? WHERE id=?", hoy, socioId);
    const anio = dates.anio(hoy);
    db.run("INSERT OR IGNORE INTO cuotas (socio_id, anio, importe, estado) VALUES (?,?,?,'PENDIENTE')", socioId, anio, cuotas.importeAnio(anio));
    return numero;
  });
}

function actualizarDatos(socioId, d) {
  const { errores, fechaNacimiento } = validarDatos(d, { conPassword: false });
  const otro = porEmail(d.email);
  if (otro && otro.id !== socioId) errores.email = 'Ese correo ya pertenece a otra cuenta.';
  if (Object.keys(errores).length) throw Object.assign(new ReglaError('Revisa los datos del formulario.'), { errores });
  db.run('UPDATE socios SET nombre=?, apellidos=?, fecha_nacimiento=?, direccion=?, telefono=?, email=? WHERE id=?',
    d.nombre.trim(), d.apellidos.trim(), fechaNacimiento, d.direccion.trim(), d.telefono.trim(), d.email.trim().toLowerCase(), socioId);
}

// RQF-006 · Baja automática por impago (31 de marzo)
function bajaPorImpago(anio, hoy = dates.today()) {
  const morosos = db.all(
    `SELECT s.id, s.nombre, s.apellidos, s.telefono FROM socios s JOIN cuotas c ON c.socio_id = s.id
     WHERE c.anio = ? AND c.estado = 'PENDIENTE' AND s.estado = 'ACTIVO'`, anio,
  );
  for (const m of morosos) {
    db.run('UPDATE cargos SET fecha_fin=? WHERE socio_id=? AND (fecha_fin IS NULL OR fecha_fin>=?)', dates.addDays(hoy, -1), m.id, hoy);
    db.run('UPDATE asignaciones_numero SET fecha_fin=? WHERE socio_id=? AND fecha_fin IS NULL', hoy, m.id);
    db.run("UPDATE socios SET estado='BAJA' WHERE id=?", m.id);
  }
  if (morosos.length) {
    const lista = morosos.map((m) => `- ${m.nombre} ${m.apellidos} (${m.telefono})`).join('\n');
    for (const to of com.emailsDirectiva(hoy)) {
      com.enviarEmail(to, `Socios dados de baja por impago (${anio})`, `Estos socios han pasado a estado de baja. Retíralos del grupo de WhatsApp del club:\n\n${lista}`);
    }
  }
  return morosos.length;
}

module.exports = {
  obtener, porEmail, listar, activos, historialAltas, siguienteNumero, autenticar, validarDatos,
  crearSolicitud, crearDirecto, aprobarSolicitud, rechazarSolicitud, darDeBaja, reingresar, actualizarDatos, bajaPorImpago,
};
