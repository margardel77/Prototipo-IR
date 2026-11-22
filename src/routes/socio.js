'use strict';
// Área personal del socio (mockups 03–10, 17, 19, 27, 33, 35–38 y 41–43).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const dates = require('../lib/dates');
const fmt = require('../lib/format');
const salidas = require('../services/salidas');
const participacion = require('../services/participacion');
const cuotas = require('../services/cuotas');
const db = require('../db/database');
const equipacion = require('../services/equipacion');
const { requireSocio, flash, fechaReferencia } = require('../lib/middleware');
const { ReglaError } = require('../lib/errors');
const { agruparPorMes } = require('./publico');

const router = express.Router();

fs.mkdirSync(config.uploadsDir, { recursive: true });
const subida = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)),
});

function cargarSalida(req, res, next) {
  const s = salidas.obtener(Number(req.params.id));
  if (!s) return res.status(404).render('public/error', { titulo: 'Salida no encontrada', mensaje: 'La salida que buscas no existe.' });
  req.salida = s;
  res.locals.salida = s;
  const ref = fechaReferencia(req, s.id);
  req.fechaRef = ref.fecha;
  res.locals.fechaRef = ref;
  res.locals.decl = participacion.estadoDeclaracion(s, req.usuario.id, ref.fecha);
  return next();
}

// ---- Salidas ----
router.get('/salidas', requireSocio, (req, res) => {
  const ahora = Date.now();
  const lista = salidas.calendario({ socioId: req.usuario.id }).map((s) => {
    const inscrito = salidas.estaInscrito(s.id, req.usuario.id);
    const puedeDesapuntarse = inscrito && !salidas.motivoNoDesapuntarse(s, req.usuario.id, ahora);
    return { ...s, inscrito, puedeDesapuntarse, plazo: salidas.plazoConsulta(s, dates.today()) };
  });
  res.render('socio/salidas', { titulo: 'Salidas del club', nav: 'salidas', salidas: lista, grupos: agruparPorMes(lista) });
});

router.get('/salidas/:id', requireSocio, cargarSalida, (req, res) => {
  res.render('socio/detalle', {
    titulo: req.salida.ruta_nombre, nav: 'salidas',
    inscritos: salidas.inscritos(req.salida.id),
    plazo: salidas.plazoConsulta(req.salida, dates.today()),
    motivoNoDesapuntarse: res.locals.decl.inscrito ? salidas.motivoNoDesapuntarse(req.salida, req.usuario.id) : null,
  });
});

router.post('/salidas/:id/apuntarme', requireSocio, cargarSalida, (req, res) => {
  try {
    salidas.inscribir(req.salida.id, req.usuario.id, { origen: 'APP' });
  } catch (e) {
    if (e instanceof ReglaError) { flash(req, 'error', e.message); return res.redirect(`/salidas/${req.salida.id}`); }
    throw e;
  }
  return res.redirect(`/salidas/${req.salida.id}/inscripcion`);
});

router.get('/salidas/:id/inscripcion', requireSocio, cargarSalida, (req, res) => {
  if (!res.locals.decl.inscrito) return res.redirect(`/salidas/${req.salida.id}`);
  res.render('socio/inscripcion', { titulo: 'Inscripción registrada', nav: 'salidas' });
});

router.post('/salidas/:id/desapuntarme', requireSocio, cargarSalida, (req, res) => {
  const detalle = `/salidas/${req.salida.id}`;
  const volver = req.body.volver === 'listado' ? '/salidas' : detalle;
  try {
    if (salidas.desapuntar(req.salida.id, req.usuario.id)) {
      flash(req, 'ok', 'Has cancelado tu inscripción a la salida.');
    }
  } catch (e) {
    if (!(e instanceof ReglaError)) throw e;
    flash(req, 'error', e.message);
  }
  return res.redirect(volver);
});

router.get('/salidas/:id/declarar', requireSocio, cargarSalida, (req, res) => {
  if (res.locals.decl.participacion) return res.redirect(`/salidas/${req.salida.id}/participacion`);
  res.render('socio/declarar', { titulo: 'Declarar asistencia', nav: 'salidas' });
});

router.post('/salidas/:id/declarar', requireSocio, (req, res, next) => subida.single('evidencia')(req, res, next), cargarSalida, (req, res) => {
  try {
    participacion.declarar(req.salida.id, req.usuario.id, {
      archivo: req.file ? req.file.filename : null,
      nombreArchivo: req.file ? path.basename(req.file.originalname).slice(0, 120) : null,
      hoy: req.fechaRef,
    });
  } catch (e) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    if (e instanceof ReglaError) { flash(req, 'error', e.message); return res.redirect(`/salidas/${req.salida.id}/declarar`); }
    throw e;
  }
  return res.redirect(`/salidas/${req.salida.id}/participacion`);
});

router.get('/salidas/:id/participacion', requireSocio, cargarSalida, (req, res) => {
  if (!res.locals.decl.participacion) return res.redirect(`/salidas/${req.salida.id}/declarar`);
  res.render('socio/participacion', { titulo: 'Mi participación', nav: 'salidas', p: res.locals.decl.participacion });
});

// "Probar fechas" (mockup 33): simula la fecha para el plazo de declaración de una salida.
router.post('/salidas/:id/fecha-prueba', requireSocio, (req, res) => {
  const s = salidas.obtener(Number(req.params.id));
  if (!s || !config.demoTools) return res.redirect('/salidas');
  const mapa = { ...(req.session.fechasPrueba || {}) };
  const modos = { antes: dates.addDays(s.fecha, -3), domingo: s.fecha, despues: dates.addDays(s.fecha, 4) };
  if (modos[req.body.modo]) mapa[s.id] = modos[req.body.modo]; else delete mapa[s.id];
  req.session.fechasPrueba = mapa;
  const volver = String(req.body.volver || '');
  return res.redirect(/^\/salidas\/\d+(\/[a-z]+)?$/.test(volver) ? volver : `/salidas/${s.id}`);
});

// Fotografías de evidencia: solo el propio socio o la directiva con permiso.
router.get('/evidencias/:archivo', requireSocio, (req, res) => {
  const archivo = path.basename(req.params.archivo);
  const db = require('../db/database');
  const p = db.get('SELECT socio_id FROM participaciones WHERE evidencia_archivo = ?', archivo);
  if (!p) return res.sendStatus(404);
  const autorizado = p.socio_id === req.usuario.id || (req.gestionActiva && req.permisos.includes('participacion'));
  if (!autorizado) return res.sendStatus(403);
  return res.sendFile(path.join(config.uploadsDir, archivo), { headers: { 'Cache-Control': 'private, max-age=3600' } });
});

// ---- Mi cuota (mockups 08 y 36) ----
// «Estado de la cuota · Solo para probar el prototipo»: permite ver como pendiente una cuota ya
// abonada para recorrer el pago de renovación. Es solo una vista de prueba: no cambia los datos.
function cuotaDelSocio(req, anioPedido) {
  const lista = cuotas.deSocio(req.usuario.id);
  const anio = Number(anioPedido) || dates.anio(dates.today());
  const real = lista.find((c) => c.anio === anio) || lista[0] || null;
  if (!real) return { real: null, cuota: null, simulada: false };
  const sim = config.demoTools && req.session.cuotaPrueba === real.id && real.estado === 'PAGADA';
  const cuota = sim
    ? { ...real, estado: 'PENDIENTE', estado_visible: 'PENDIENTE', fecha_pago: null, forma_pago: null, fecha_emision: null, comprobante_id: null }
    : real;
  return { real, cuota, simulada: sim };
}

router.get('/cuota', requireSocio, (req, res) => {
  const { cuota, real, simulada } = cuotaDelSocio(req, req.query.anio);
  res.render('socio/cuota', {
    titulo: 'Mi cuota', nav: 'cuota', cuota, simulada,
    tarjetaPago: cuota && db.get('SELECT ultimos FROM pagos_tarjeta WHERE cuota_id=?', cuota.id),
    tarjetaGuardada: db.get('SELECT ultimos FROM tarjetas_guardadas WHERE socio_id=?', req.usuario.id),
    probar: config.demoTools && real && (real.estado === 'PAGADA' || simulada),
  });
});

router.post('/cuota/estado-prueba', requireSocio, (req, res) => {
  const { real } = cuotaDelSocio(req, req.body.anio);
  if (config.demoTools && real && real.estado === 'PAGADA' && req.body.estado === 'PENDIENTE') req.session.cuotaPrueba = real.id;
  else req.session.cuotaPrueba = null;
  return res.redirect(real ? `/cuota?anio=${real.anio}` : '/cuota');
});

// Pago de renovación con la tarjeta de prueba (mockups 42, 41 y 43)
function validarTarjeta(body) {
  const { titular = '', numero = '', caducidad = '', cvc = '' } = body;
  const errores = {};
  const digitos = String(numero).replace(/\D/g, '');
  if (!String(titular).trim()) errores.titular = 'Escribe el titular de la tarjeta.';
  if (digitos.length < 12 || digitos.length > 19) errores.numero = 'Escribe un número de tarjeta de prueba.';
  if (!/^(0[1-9]|1[0-2])\/(\d{2})$/.test(String(caducidad).trim())) errores.caducidad = 'Usa el formato MM/AA.';
  if (!/^\d{3,4}$/.test(String(cvc).trim())) errores.cvc = '3 o 4 cifras.';
  return { errores, digitos, valores: { titular, caducidad } };
}

router.get('/cuota/pago', requireSocio, (req, res) => {
  const { cuota } = cuotaDelSocio(req, req.query.anio);
  if (!cuota || cuota.estado !== 'PENDIENTE' || cuota.estado_visible === 'BAJA') return res.redirect('/cuota');
  const tarjetaGuardada = db.get('SELECT ultimos FROM tarjetas_guardadas WHERE socio_id=?', req.usuario.id);
  res.render('socio/cuota-pago', { titulo: 'Paga tu cuota', nav: 'cuota', cuota, tarjetaGuardada, valores: { titular: `${req.usuario.nombre} ${req.usuario.apellidos}`.toUpperCase() } });
});

router.post('/cuota/pago', requireSocio, (req, res) => {
  const { cuota, simulada } = cuotaDelSocio(req, req.body.anio);
  if (!cuota || cuota.estado !== 'PENDIENTE') return res.redirect('/cuota');
  const tarjetaGuardada = db.get('SELECT ultimos FROM tarjetas_guardadas WHERE socio_id=?', req.usuario.id);
  const tarjeta = req.body.usar_guardada && tarjetaGuardada
    ? { errores: {}, digitos: tarjetaGuardada.ultimos, valores: {} }
    : validarTarjeta(req.body);
  const { errores, digitos, valores } = tarjeta;
  if (Object.keys(errores).length) return res.status(400).render('socio/cuota-pago', { titulo: 'Paga tu cuota', nav: 'cuota', cuota, errores, valores, tarjetaGuardada });
  // Simulación: solo la tarjeta de prueba terminada en 4242 se acepta.
  if (!digitos.endsWith('4242')) return res.redirect(`/cuota/pago/rechazado?anio=${cuota.anio}`);
  if (simulada) req.session.cuotaPrueba = null; // ya estaba abonada: solo termina la prueba
  else db.tx(() => {
    cuotas.pagarConTarjeta(req.usuario.id, cuota.anio);
    db.run('INSERT OR REPLACE INTO pagos_tarjeta (cuota_id, ultimos) VALUES (?,?)', cuota.id, digitos.slice(-4));
  });
  if (req.body.guardar_tarjeta) {
    db.run('INSERT OR REPLACE INTO tarjetas_guardadas (socio_id, ultimos) VALUES (?,?)', req.usuario.id, digitos.slice(-4));
  }
  req.session.renovacionOk = { anio: cuota.anio, importe: cuota.importe, tarjeta: digitos.slice(-4) };
  return res.redirect('/cuota/pago/confirmacion');
});

router.get('/cuota/pago/rechazado', requireSocio, (req, res) => {
  const { cuota } = cuotaDelSocio(req, req.query.anio);
  if (!cuota) return res.redirect('/cuota');
  res.render('socio/cuota-rechazado', { titulo: 'No se ha completado el pago', nav: 'cuota', cuota });
});

router.get('/cuota/pago/confirmacion', requireSocio, (req, res) => {
  const ok = req.session.renovacionOk;
  if (!ok) return res.redirect('/cuota');
  res.render('socio/cuota-confirmacion', { titulo: 'Pago simulado completado', nav: 'cuota', ...ok });
});

router.get('/cuota/:anio/comprobante', requireSocio, (req, res) => {
  const c = cuotas.deSocioAnio(req.usuario.id, Number(req.params.anio));
  if (!c || c.estado !== 'PAGADA' || !c.comprobante_id) return res.redirect('/cuota');
  res.render('socio/comprobante', { titulo: 'Comprobante de pago', nav: 'cuota', cuota: c });
});

router.get('/cuota/:anio/comprobante.pdf', requireSocio, (req, res) => {
  const c = cuotas.deSocioAnio(req.usuario.id, Number(req.params.anio));
  if (!c || c.estado !== 'PAGADA' || !c.comprobante_id) return res.redirect('/cuota');
  const pdf = require('../lib/pdf').comprobante({
    subtitulo: `Comprobante de cuota · ${c.anio}`,
    titulo: 'Comprobante de pago',
    filas: [
      ['Socio', `${c.nombre} ${c.apellidos}`],
      ['Número de socio', String(c.numero ?? '—')],
      ['Cuota anual', `${fmt.euros(c.importe)} · Abonada`],
      [c.fecha_pago === c.fecha_emision ? 'Fecha de pago y emisión' : 'Fecha de pago', dates.corta(c.fecha_pago)],
      ...(c.fecha_pago === c.fecha_emision ? [] : [['Fecha de emisión', dates.corta(c.fecha_emision)]]),
      ['Forma de pago', fmt.ETIQ.formaPago[c.forma_pago]],
    ],
    importe: { concepto: `Cuota anual ${c.anio} · Abonada`, valor: fmt.euros(c.importe) },
    nota: [c.forma_pago === 'TARJETA' ? 'Pago simulado con la tarjeta de prueba: sin transacción bancaria real.' : 'Pago registrado por la tesorería del club.'],
  });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="comprobante-cuota-${c.anio}.pdf"`);
  return res.send(pdf);
});

// ---- Equipación (mockups 37, 38, 09 y 19) ----
router.get('/equipacion', requireSocio, (req, res) => {
  res.render('socio/equipacion', { titulo: 'Equipaciones', nav: 'equipacion', articulos: equipacion.articulos() });
});

router.get('/equipacion/articulos/:id', requireSocio, (req, res) => {
  const a = equipacion.articulo(Number(req.params.id));
  if (!a) return res.redirect('/equipacion');
  res.render('socio/articulo', { titulo: a.nombre, nav: 'equipacion', articulo: a, max: equipacion.MAX_CANTIDAD });
});

router.post('/equipacion/carrito', requireSocio, (req, res) => {
  try {
    equipacion.anadirAlCarrito(req.usuario.id, req.body.articulo_id, req.body.talla, req.body.cantidad);
  } catch (e) {
    if (!(e instanceof ReglaError)) throw e;
    flash(req, 'error', e.message);
    return res.redirect(Number(req.body.articulo_id) ? `/equipacion/articulos/${Number(req.body.articulo_id)}` : '/equipacion');
  }
  return res.redirect('/equipacion/carrito');
});

function vistaCarrito(req, res, extra = {}) {
  const lineas = equipacion.carrito(req.usuario.id);
  res.status(extra.status || 200).render('socio/carrito', {
    titulo: 'Carrito', nav: 'equipacion', lineas, max: equipacion.MAX_CANTIDAD,
    calculo: equipacion.calcular(req.usuario.id, lineas), campania: equipacion.campaniaActiva(), error: extra.error,
  });
}

router.get('/equipacion/carrito', requireSocio, (req, res) => vistaCarrito(req, res));

router.post('/equipacion/carrito/:linea', requireSocio, (req, res) => {
  try { equipacion.cambiarCantidad(req.usuario.id, Number(req.params.linea), req.body.cantidad); } catch (e) {
    if (!(e instanceof ReglaError)) throw e;
    flash(req, 'error', e.message);
  }
  return res.redirect('/equipacion/carrito');
});

router.post('/equipacion/pedido', requireSocio, (req, res) => {
  try {
    const id = equipacion.confirmarCarrito(req.usuario.id);
    return res.redirect(`/equipacion/pedidos/${id}`);
  } catch (e) {
    if (!(e instanceof ReglaError)) throw e;
    return vistaCarrito(req, res, { status: 400, error: e.message });
  }
});

router.get('/equipacion/pedidos/:id', requireSocio, (req, res) => {
  const p = equipacion.pedido(Number(req.params.id));
  if (!p || p.socio_id !== req.usuario.id) return res.redirect('/equipacion');
  res.render('socio/pedido', { titulo: 'Pedido registrado', nav: 'equipacion', pedido: p });
});

// ---- Clasificación (mockup 10) ----
router.get('/clasificacion', requireSocio, (req, res) => {
  const hoy = dates.today();
  const actual = dates.periodoDe(hoy);
  const disponibles = participacion.periodosDisponibles(hoy); // del más reciente al más antiguo
  const masAntiguo = disponibles[disponibles.length - 1] || actual;
  let periodo = dates.periodoPorClave(req.query.periodo) || actual;
  if (periodo.clave > actual.clave) periodo = actual;
  if (periodo.clave < masAntiguo.clave) periodo = masAntiguo;
  const anterior = periodo.clave > masAntiguo.clave ? dates.periodoVecino(periodo, -1) : null;
  const siguiente = periodo.clave < actual.clave ? dates.periodoVecino(periodo, 1) : null;

  const fechas = participacion.fechasConClasificacion();
  const pedida = dates.parseFecha(req.query.fecha);
  const fecha = pedida || fechas[fechas.length - 1] || null;
  const fechaAnterior = fecha ? [...fechas].reverse().find((f) => f < fecha) || null : null;
  const fechaSiguiente = fecha ? fechas.find((f) => f > fecha) || null : null;

  const cat = participacion.categoria(req.query.cat) ? req.query.cat : '';
  const catSalida = participacion.categoria(req.query.catsal) ? req.query.catsal : '';
  res.render('socio/clasificacion', {
    titulo: 'Clasificación', nav: 'clasificacion', periodo, anterior, siguiente, cat, catSalida,
    categorias: participacion.CATEGORIAS, filas: participacion.clasificacion(periodo, cat),
    fecha, fechaAnterior, fechaSiguiente, filasSalida: fecha ? participacion.clasificacionFecha(fecha, catSalida) : [],
  });
});

module.exports = router;
