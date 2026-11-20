'use strict';
// Área pública: salidas abiertas a todos, inicio de sesión y registro.
const crypto = require('node:crypto');
const express = require('express');
const dates = require('../lib/dates');
const fmt = require('../lib/format');
const socios = require('../services/socios');
const salidas = require('../services/salidas');
const cuotas = require('../services/cuotas');
const { destinoSeguro, flash } = require('../lib/middleware');

const router = express.Router();

// Agrupa las salidas por mes ("Calendario de noviembre")
function agruparPorMes(lista) {
  const grupos = [];
  for (const s of lista) {
    const clave = s.fecha.slice(0, 7);
    let g = grupos.find((x) => x.clave === clave);
    if (!g) { g = { clave, mes: dates.nombreMes(s.fecha), anio: s.fecha.slice(0, 4), salidas: [] }; grupos.push(g); }
    g.salidas.push(s);
  }
  return grupos;
}

router.get('/', (req, res) => {
  if (req.usuario) return res.redirect('/salidas');
  const lista = salidas.calendario();
  res.render('public/salidas', { titulo: 'Salidas semanales', grupos: agruparPorMes(lista) });
});

// ---- Inicio de sesión (mockup 02) ----
router.get('/acceso', (req, res) => {
  if (req.usuario) return res.redirect(destinoSeguro(req.query.next, '/salidas'));
  res.render('public/acceso', { titulo: 'Iniciar sesión', next: req.query.next || '' });
});

router.post('/acceso', async (req, res) => {
  const { email, password, next } = req.body;
  const s = await socios.autenticar(email, password);
  const render = (error) => res.status(400).render('public/acceso', { titulo: 'Iniciar sesión', next, error, valores: { email } });
  if (!s) return render('El correo electrónico o la contraseña no son correctos.');
  if (s.estado === 'PENDIENTE') return render('Tu solicitud de alta está pendiente de revisión por la directiva. Podrás acceder cuando la apruebe.');
  if (s.estado !== 'ACTIVO') return render('Tu cuenta está de baja. Contacta con la directiva en la sede del club para volver a darte de alta.');
  req.session = { socioId: s.id };
  return res.redirect(destinoSeguro(next, '/salidas'));
});

router.post('/salir', (req, res) => { req.session = null; res.redirect('/'); });
router.get('/salir', (req, res) => { req.session = null; res.redirect('/'); });

// ---- Registro en 3 pasos (mockups 21, 25, 26, 22) ----
// Los datos del paso 1 se guardan solo en memoria del servidor hasta completar el pago.
const borradores = new Map();
const TTL = 30 * 60 * 1000;
function guardarBorrador(datos) {
  const id = crypto.randomUUID();
  borradores.set(id, { datos, expira: Date.now() + TTL });
  for (const [k, v] of borradores) if (v.expira < Date.now()) borradores.delete(k);
  return id;
}
function leerBorrador(req) {
  const b = req.session.registro && borradores.get(req.session.registro);
  return b && b.expira > Date.now() ? b.datos : null;
}

router.get('/registro', (req, res) => {
  if (req.usuario) return res.redirect('/salidas');
  const d = leerBorrador(req) || {};
  res.render('public/registro', { titulo: 'Crea tu cuenta', valores: { ...d, password: '', password2: '' } });
});

router.post('/registro', (req, res) => {
  const d = req.body;
  const { errores } = socios.validarDatos(d, { conPassword: true });
  if (!errores.email && socios.porEmail(d.email)) errores.email = 'Ya existe una cuenta con ese correo electrónico.';
  if (Object.keys(errores).length) {
    return res.status(400).render('public/registro', { titulo: 'Crea tu cuenta', errores, valores: { ...d, password: '', password2: '' } });
  }
  const datos = {
    nombre: d.nombre, apellidos: d.apellidos, fecha_nacimiento: d.fecha_nacimiento, telefono: d.telefono,
    direccion: d.direccion, email: d.email, password: d.password, password2: d.password2,
  };
  req.session.registro = guardarBorrador(datos);
  return res.redirect('/registro/pago');
});

function datosPago() {
  const anio = dates.anio(dates.today());
  return { anio, importe: cuotas.importeAnio(anio) };
}

router.get('/registro/pago', (req, res) => {
  const d = leerBorrador(req);
  if (!d) return res.redirect('/registro');
  res.render('public/registro-pago', { titulo: 'Completa tu registro', ...datosPago(), valores: { titular: `${d.nombre} ${d.apellidos}`.toUpperCase() } });
});

router.post('/registro/pago', (req, res) => {
  const d = leerBorrador(req);
  if (!d) return res.redirect('/registro');
  const { titular = '', numero = '', caducidad = '', cvc = '' } = req.body;
  const errores = {};
  const digitos = numero.replace(/\D/g, '');
  if (!titular.trim()) errores.titular = 'Escribe el titular de la tarjeta.';
  if (digitos.length < 12 || digitos.length > 19) errores.numero = 'Escribe un número de tarjeta de prueba.';
  const cad = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(caducidad.trim());
  if (!cad) errores.caducidad = 'Usa el formato MM/AA.';
  if (!/^\d{3,4}$/.test(cvc.trim())) errores.cvc = '3 o 4 cifras.';
  if (Object.keys(errores).length) {
    return res.status(400).render('public/registro-pago', { titulo: 'Completa tu registro', ...datosPago(), errores, valores: { titular, caducidad } });
  }
  // Simulación: solo la tarjeta de prueba terminada en 4242 se acepta.
  if (!digitos.endsWith('4242')) return res.redirect('/registro/pago/rechazado');
  try {
    socios.crearSolicitud(d, `Tarjeta de prueba terminada en ${digitos.slice(-4)}`);
  } catch (e) {
    if (e.errores) { flash(req, 'error', e.message); return res.redirect('/registro'); }
    throw e;
  }
  borradores.delete(req.session.registro);
  req.session.registro = null;
  req.session.registroOk = { ...datosPago(), tarjeta: digitos.slice(-4), nombre: `${d.nombre} ${d.apellidos}`.trim(), email: d.email, fecha: dates.today() };
  return res.redirect('/registro/confirmacion');
});

// «Descargar comprobante» del pago simulado del registro (mockup 22)
router.get('/registro/comprobante.pdf', (req, res) => {
  const ok = req.session.registroOk;
  if (!ok) return res.redirect('/registro');
  const pdf = require('../lib/pdf').comprobante({
    subtitulo: `Comprobante de cuota · ${ok.anio}`,
    titulo: 'Pago simulado completado',
    filas: [
      ['Solicitante', ok.nombre || '—'],
      ['Correo electrónico', ok.email || '—'],
      ['Concepto', `Cuota anual ${ok.anio} · Nuevo registro`],
      ['Fecha de pago', dates.corta(ok.fecha || dates.today())],
      ['Forma de pago', `Tarjeta de prueba terminada en ${ok.tarjeta}`],
    ],
    importe: { concepto: `Cuota anual ${ok.anio} · Abonada en la simulación`, valor: fmt.euros(ok.importe) },
    nota: ['Sin transacción bancaria real.', 'La directiva revisará tus datos antes de activar la cuenta.'],
  });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="comprobante-registro-${ok.anio}.pdf"`);
  return res.send(pdf);
});

router.get('/registro/pago/rechazado', (req, res) => {
  res.render('public/registro-rechazado', { titulo: 'No se ha completado el pago', ...datosPago() });
});

router.get('/registro/confirmacion', (req, res) => {
  const ok = req.session.registroOk;
  if (!ok) return res.redirect('/registro');
  res.render('public/registro-confirmacion', { titulo: 'Pago simulado completado', ...ok });
});

module.exports = router;
module.exports.agruparPorMes = agruparPorMes;
