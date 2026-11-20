'use strict';
// Área de gestión de la junta directiva (mockups 11–16, 18, 20, 23, 24, 28–32, 34, 39, 40).
const express = require('express');
const config = require('../config');
const dates = require('../lib/dates');
const fmt = require('../lib/format');
const socios = require('../services/socios');
const junta = require('../services/junta');
const salidas = require('../services/salidas');
const participacion = require('../services/participacion');
const cuotas = require('../services/cuotas');
const { requireSocio, requireGestion, flash, destinoSeguro } = require('../lib/middleware');
const { ReglaError } = require('../lib/errors');

const router = express.Router();

// ancho: el de cada pestaña en los mockups
const TABS = [
  { clave: 'socios', etiqueta: 'Socios', url: '/gestion/socios', ancho: 116 },
  { clave: 'salidas', etiqueta: 'Salidas', url: '/gestion/salidas', ancho: 116 },
  { clave: 'participacion', etiqueta: 'Participación', url: '/gestion/participacion', ancho: 156 },
  { clave: 'cuotas', etiqueta: 'Cuotas', url: '/gestion/cuotas', ancho: 116 },
];
router.use((req, res, next) => { res.locals.tabs = TABS.filter((t) => req.permisos.includes(t.clave)); next(); });

// Ejecuta una acción y, si incumple una regla de negocio, vuelve con el mensaje.
function accion(fn, volver) {
  return (req, res, next) => {
    try { return fn(req, res); } catch (e) {
      if (e instanceof ReglaError) { flash(req, 'error', e.message); return res.redirect(typeof volver === 'function' ? volver(req) : volver); }
      return next(e);
    }
  };
}

// ---- Segunda identificación (mockups 23 y 24) ----
router.get('/', requireSocio, (req, res) => {
  if (!req.gestionActiva) return res.redirect('/gestion/acceso');
  return res.redirect(res.locals.tabs[0] ? res.locals.tabs[0].url : '/gestion/sin-permisos');
});

router.get('/acceso', requireSocio, (req, res) => {
  res.render('gestion/acceso', { titulo: 'Verifica tu identidad', next: req.query.next || '', valores: {} });
});

router.post('/acceso', requireSocio, async (req, res) => {
  const { email, password, next } = req.body;
  const s = await socios.autenticar(email, password);
  if (!s || s.id !== req.usuario.id) {
    return res.status(400).render('gestion/acceso', {
      titulo: 'Verifica tu identidad', next, valores: { email },
      error: s ? 'Identifícate con la misma cuenta con la que has iniciado sesión.' : 'El correo electrónico o la contraseña no son correctos.',
    });
  }
  if (!junta.permisos(s.id).length) return res.redirect('/gestion/sin-permisos');
  req.session.gestionHasta = Date.now() + config.gestionMinutos * 60 * 1000;
  return res.redirect(destinoSeguro(next, '/gestion'));
});

router.get('/sin-permisos', requireSocio, (req, res) => {
  res.status(403).render('gestion/sin-permisos', { titulo: 'Acceso restringido' });
});

router.get('/volver', (req, res) => res.redirect('/salidas'));

// ---- Socios (mockups 39, 40, 11, 18) ----
router.get('/socios', requireGestion('socios'), (req, res) => {
  const q = String(req.query.q || '').slice(0, 80);
  const lista = socios.listar({ q });
  res.render('gestion/socios', {
    titulo: 'Socios', tab: 'socios', q, lista,
    total: lista.filter((s) => s.estado !== 'PENDIENTE').length,
    activos: lista.filter((s) => s.estado === 'ACTIVO').length,
    pendientes: lista.filter((s) => s.estado === 'PENDIENTE').length,
  });
});

router.get('/socios/nuevo', requireGestion('socios'), (req, res) => {
  res.render('gestion/nuevo-socio', { titulo: 'Nuevo socio', tab: 'socios', valores: {} });
});

router.post('/socios/nuevo', requireGestion('socios'), (req, res) => {
  try {
    const { id, numero } = socios.crearDirecto(req.body, req.usuario.id);
    flash(req, 'ok', `Socio creado con el número ${numero}. Su cuota de ${dates.anio(dates.today())} queda pendiente de pago.`);
    return res.redirect(`/gestion/socios/${id}`);
  } catch (e) {
    if (!(e instanceof ReglaError)) throw e;
    return res.status(400).render('gestion/nuevo-socio', {
      titulo: 'Nuevo socio', tab: 'socios', errores: e.errores || {}, error: e.errores ? null : e.message,
      valores: { ...req.body, password: '', password2: '' },
    });
  }
});

function cargarSocio(req, res, next) {
  const s = socios.obtener(Number(req.params.id));
  if (!s) return res.status(404).render('public/error', { titulo: 'Socio no encontrado', mensaje: 'El socio que buscas no existe.' });
  req.socio = s; res.locals.socio = s;
  return next();
}

router.get('/socios/:id', requireGestion('socios'), cargarSocio, (req, res) => {
  res.render('gestion/ficha', {
    titulo: 'Ficha del socio', tab: 'socios', historial: socios.historialAltas(req.socio.id),
    cargo: junta.cargoActual(req.socio.id), editar: req.query.editar === '1',
    valores: { ...req.socio, fecha_nacimiento: dates.isoToDmy(req.socio.fecha_nacimiento) },
  });
});

router.post('/socios/:id', requireGestion('socios'), cargarSocio, (req, res) => {
  try {
    socios.actualizarDatos(req.socio.id, req.body);
    if (req.body.cargo !== undefined) junta.asignarCargo(req.socio.id, req.body.cargo || null);
    flash(req, 'ok', 'Datos del socio actualizados.');
    return res.redirect(`/gestion/socios/${req.socio.id}`);
  } catch (e) {
    if (!(e instanceof ReglaError)) throw e;
    return res.status(400).render('gestion/ficha', {
      titulo: 'Ficha del socio', tab: 'socios', historial: socios.historialAltas(req.socio.id),
      cargo: junta.cargoActual(req.socio.id), editar: true, valores: req.body, errores: e.errores || {}, error: e.message,
    });
  }
});

const volverFicha = (req) => `/gestion/socios/${req.params.id}`;
router.post('/socios/:id/aprobar', requireGestion('socios'), accion((req, res) => {
  const n = socios.aprobarSolicitud(Number(req.params.id), req.usuario.id);
  flash(req, 'ok', `Alta registrada con el número de socio ${n}.`);
  res.redirect(volverFicha(req));
}, volverFicha));
router.post('/socios/:id/rechazar', requireGestion('socios'), accion((req, res) => {
  socios.rechazarSolicitud(Number(req.params.id));
  flash(req, 'ok', 'Solicitud rechazada.');
  res.redirect('/gestion/socios');
}, volverFicha));
router.post('/socios/:id/baja', requireGestion('socios'), accion((req, res) => {
  socios.darDeBaja(Number(req.params.id));
  flash(req, 'ok', 'Socio dado de baja. Su número queda en el historial.');
  res.redirect(volverFicha(req));
}, volverFicha));
router.post('/socios/:id/reingreso', requireGestion('socios'), accion((req, res) => {
  const n = socios.reingresar(Number(req.params.id));
  flash(req, 'ok', `Nueva alta registrada con el número ${n}.`);
  res.redirect(volverFicha(req));
}, volverFicha));

router.get('/socios/:id/alta-vigente', requireGestion('socios'), cargarSocio, (req, res) => {
  const vigente = socios.historialAltas(req.socio.id).find((h) => !h.fecha_fin) || null;
  res.render('gestion/alta-vigente', { titulo: 'Alta vigente', tab: 'socios', vigente });
});

// ---- Salidas y rutas (mockups 12, 13, 20) ----
// Fecha propuesta para una salida nueva: el primer domingo con la antelación mínima (REGN-007)
function fechaSugerida() {
  let f = dates.addDays(dates.today(), config.antelacionSemanalDias);
  while (dates.diaSemana(f) !== 'domingo') f = dates.addDays(f, 1);
  return f;
}

function vistaPreparar(req, res, extra = {}) {
  const rutas = salidas.rutas();
  const sugerida = fechaSugerida();
  const editando = req.query.editar ? salidas.obtener(Number(req.query.editar)) : null;
  const valores = extra.valores || (editando
    ? { fecha: dates.isoToDmy(editando.fecha), hora: editando.hora, tipo: editando.tipo, ruta_id: String(editando.ruta_id) }
    : { fecha: dates.isoToDmy(sugerida), hora: '09:00', tipo: '', ruta_id: req.query.ruta || (rutas[0] ? String(rutas[0].id) : '') });
  res.status(extra.status || 200).render('gestion/preparar', {
    titulo: 'Preparar una salida', tab: 'salidas', rutas, editando, valores,
    errores: extra.errores || {}, error: extra.error,
    programadas: salidas.listarGestion().filter((s) => s.estado_efectivo === 'PUBLICADA').reverse(),
    sugerida,
  });
}

router.get('/salidas', requireGestion('salidas'), (req, res) => vistaPreparar(req, res));

router.post('/salidas', requireGestion('salidas'), (req, res) => {
  try {
    const editar = Number(req.body.editar) || null;
    const id = editar ? salidas.modificar(editar, req.body) : salidas.publicar(req.body, req.usuario.id);
    if (editar) flash(req, 'ok', 'Salida modificada. Se ha avisado a los socios.');
    return res.redirect(`/gestion/salidas/${id}/publicada`);
  } catch (e) {
    if (!(e instanceof ReglaError)) throw e;
    if (req.body.editar) req.query.editar = req.body.editar;
    return vistaPreparar(req, res, { status: 400, valores: req.body, errores: e.errores || {}, error: e.errores ? null : e.message });
  }
});

router.get('/salidas/:id/publicada', requireGestion('salidas'), (req, res) => {
  const s = salidas.obtener(Number(req.params.id));
  if (!s) return res.redirect('/gestion/salidas');
  res.render('gestion/publicada', { titulo: 'Salida publicada', tab: 'salidas', salida: s });
});

router.post('/salidas/:id/cancelar', requireGestion('salidas'), accion((req, res) => {
  salidas.cancelar(Number(req.params.id));
  flash(req, 'ok', 'Salida cancelada. Se ha avisado a los socios por correo y WhatsApp.');
  res.redirect('/gestion/salidas');
}, '/gestion/salidas'));

router.get('/rutas/nueva', requireGestion('salidas'), (req, res) => {
  res.render('gestion/crear-ruta', { titulo: 'Crear ruta', tab: 'salidas', valores: {} });
});

router.post('/rutas', requireGestion('salidas'), (req, res) => {
  try {
    const id = salidas.crearRuta(req.body);
    flash(req, 'ok', 'Ruta guardada. Ya puedes seleccionarla en la salida.');
    return res.redirect(`/gestion/salidas?ruta=${id}`);
  } catch (e) {
    if (!(e instanceof ReglaError)) throw e;
    return res.status(400).render('gestion/crear-ruta', { titulo: 'Crear ruta', tab: 'salidas', valores: req.body, errores: e.errores || {}, error: e.errores ? null : e.message });
  }
});

// ---- Participación (mockups 14, 28–32) ----
function salidasValidables() {
  return salidas.realizadas().filter((s) => s.tipo !== 'PRUEBA_SOCIAL');
}

router.get('/participacion', requireGestion('participacion'), (req, res) => {
  const lista = salidasValidables();
  const pendientes = new Map(participacion.pendientesPorSalida().map((p) => [p.salida_id, p.n]));
  let salida = req.query.salida ? salidas.obtener(Number(req.query.salida)) : null;
  if (!salida || salida.tipo === 'PRUEBA_SOCIAL') salida = lista.find((s) => pendientes.get(s.id)) || lista[0] || null;
  res.render('gestion/participacion', {
    titulo: 'Participación de la ruta', tab: 'participacion', salida, lista, pendientes,
    filas: salida ? participacion.listaSalida(salida.id) : [],
    candidatos: salida ? socios.activos().filter((s) => s.id !== req.usuario.id) : [], // uno mismo se apunta desde su área
  });
});

function cargarParticipante(req, res, next) {
  const salida = salidas.obtener(Number(req.params.salidaId));
  const fila = salida && participacion.listaSalida(salida.id).find((f) => f.socio_id === Number(req.params.socioId));
  if (!fila) return res.redirect(`/gestion/participacion${salida ? `?salida=${salida.id}` : ''}`);
  req.salida = salida; req.fila = fila;
  return next();
}

router.get('/participacion/:salidaId/socio/:socioId', requireGestion('participacion'), cargarParticipante, (req, res) => {
  res.render('gestion/participante', { titulo: `${req.fila.nombre} ${req.fila.apellidos}`, tab: 'participacion', salida: req.salida, f: req.fila });
});

const volverParticipante = (req) => (req.body.volver === 'lista'
  ? `/gestion/participacion?salida=${req.params.salidaId}`
  : `/gestion/participacion/${req.params.salidaId}/socio/${req.params.socioId}`);

router.post('/participacion/:salidaId/socio/:socioId/confirmar', requireGestion('participacion'), accion((req, res) => {
  participacion.confirmar(Number(req.params.salidaId), Number(req.params.socioId), req.usuario.id);
  res.redirect(volverParticipante(req));
}, volverParticipante));

router.post('/participacion/:salidaId/socio/:socioId/rechazar', requireGestion('participacion'), accion((req, res) => {
  participacion.rechazar(Number(req.params.salidaId), Number(req.params.socioId), req.usuario.id);
  res.redirect(volverParticipante(req));
}, volverParticipante));

// "Añadir socio a la ruta" (mockup 31)
router.post('/participacion/:salidaId/anadir', requireGestion('participacion'), accion((req, res) => {
  const salidaId = Number(req.params.salidaId);
  salidas.inscribir(salidaId, Number(req.body.socio_id), { origen: 'MANUAL' });
  const destino = req.body.volver === 'pruebas' ? `/gestion/pruebas?salida=${salidaId}` : `/gestion/participacion?salida=${salidaId}`;
  res.redirect(destino);
}, (req) => (req.body.volver === 'pruebas' ? `/gestion/pruebas?salida=${req.params.salidaId}` : `/gestion/participacion?salida=${req.params.salidaId}`)));

// ---- Resultado de prueba social (mockups 15, 34) ----
// Solo las pruebas del periodo de clasificación en curso: los periodos cerrados no se modifican (RQF-012).
router.get('/pruebas', requireGestion('participacion'), (req, res) => {
  const periodo = dates.periodoDe(dates.today());
  const pruebas = salidas.pruebasSociales().filter((p) => p.fecha >= periodo.inicio && p.fecha <= periodo.fin)
    .map((p) => ({ ...p, resumen: participacion.resumenPrueba(p.id) }));
  const prueba = pruebas.find((p) => p.id === Number(req.query.salida)) || pruebas.find((p) => p.estado_efectivo === 'REALIZADA') || pruebas[0] || null;
  res.render('gestion/pruebas', {
    titulo: 'Resultado de prueba social', tab: 'participacion', pruebas, prueba,
    filas: prueba ? participacion.resultadosPrueba(prueba.id) : [],
    candidatos: prueba ? socios.activos().filter((s) => s.id !== req.usuario.id) : [],
  });
});

router.post('/pruebas/:id', requireGestion('participacion'), accion((req, res) => {
  const tiempos = {};
  const errores = [];
  for (const [k, v] of Object.entries(req.body.tiempo || {})) {
    const txt = String(v || '').trim();
    if (!txt || txt === '00:00:00') continue;
    const seg = fmt.hmsASegundos(txt);
    if (seg == null) errores.push(txt); else tiempos[Number(k)] = seg;
  }
  if (errores.length) throw new ReglaError(`Revisa el formato de los tiempos (hh:mm:ss): ${errores.join(', ')}.`);
  const n = participacion.guardarResultados(Number(req.params.id), tiempos, req.usuario.id);
  flash(req, 'ok', `Resultado guardado: ${n} socios clasificados. La clasificación general se ha actualizado.`);
  res.redirect(`/gestion/pruebas?salida=${req.params.id}`);
}, (req) => `/gestion/pruebas?salida=${req.params.id}`));

// ---- Cuotas (mockup 16) ----
router.get('/cuotas', requireGestion('cuotas'), (req, res) => {
  const anio = Number(req.query.anio) || dates.anio(dates.today());
  const inf = cuotas.informe(anio);
  let seleccionada = req.query.cuota ? cuotas.obtener(Number(req.query.cuota)) : null;
  if (seleccionada && (seleccionada.anio !== anio || seleccionada.estado_visible !== 'PENDIENTE')) seleccionada = null;
  if (!seleccionada) seleccionada = inf.filas.find((f) => f.estado_visible === 'PENDIENTE') || null;
  res.render('gestion/cuotas', {
    titulo: 'Cuotas de socios', tab: 'cuotas', anio, inf, seleccionada, hoy: dates.today(),
    valores: req.session.pagoValores || {},
  });
  req.session.pagoValores = null;
});

router.post('/cuotas/:id/pago', requireGestion('cuotas'), (req, res, next) => {
  const { estado, forma, fecha } = req.body;
  try {
    const c = cuotas.registrarPago(Number(req.params.id), { estado, forma, fecha }, req.usuario.id);
    flash(req, 'ok', `Pago registrado. Comprobante emitido${c.fecha_envio ? ' y enviado por correo' : ''} a ${c.nombre} ${c.apellidos}.`);
    return res.redirect(`/gestion/cuotas?anio=${c.anio}`);
  } catch (e) {
    if (!(e instanceof ReglaError)) return next(e);
    flash(req, 'error', e.message);
    req.session.pagoValores = { estado, forma, fecha };
    return res.redirect(`/gestion/cuotas?cuota=${Number(req.params.id)}`);
  }
});

router.get('/cuotas/informe.csv', requireGestion('cuotas'), (req, res) => {
  const anio = Number(req.query.anio) || dates.anio(dates.today());
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="informe-cuotas-${anio}.csv"`);
  res.send(cuotas.informeCsv(anio));
});

router.get('/cuotas/informe', requireGestion('cuotas'), (req, res) => {
  const anio = Number(req.query.anio) || dates.anio(dates.today());
  res.render('gestion/informe-cuotas', { titulo: `Informe de cuotas ${anio}`, inf: cuotas.informe(anio) });
});

module.exports = router;
