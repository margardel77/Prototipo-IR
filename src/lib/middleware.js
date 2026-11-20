'use strict';
const { statSync } = require('node:fs');
const path = require('node:path');
const config = require('../config');
const dates = require('./dates');
const fmt = require('./format');
const socios = require('../services/socios');
const junta = require('../services/junta');

const VERSION_ESTATICOS = Date.now().toString(36);
const RUTA_ESTILOS = path.join(config.root, 'src', 'public', 'css', 'styles.css');

// Variables comunes para todas las vistas
function contexto(req, res, next) {
  res.locals.v = VERSION_ESTATICOS;
  // El modo watch puede servir cambios de CSS sin reiniciar el servidor.
  res.locals.vCss = process.env.NODE_ENV === 'production'
    ? VERSION_ESTATICOS
    : statSync(RUTA_ESTILOS).mtimeMs.toString(36);
  const s = req.session || {};
  let usuario = null;
  if (s.socioId) {
    usuario = socios.obtener(s.socioId);
    if (!usuario || usuario.estado !== 'ACTIVO') { req.session = null; usuario = null; }
  }
  req.usuario = usuario;
  const permisos = usuario ? junta.permisos(usuario.id) : [];
  req.permisos = permisos;
  req.gestionActiva = Boolean(usuario && permisos.length && s.gestionHasta && s.gestionHasta > Date.now());
  Object.assign(res.locals, {
    usuario, permisos, config, dates, fmt, ruta: req.path, query: req.query,
    flash: s.flash || null, errores: {}, valores: {}, titulo: '',
  });
  if (s.flash) req.session.flash = null;
  next();
}

function flash(req, tipo, texto) { req.session.flash = { tipo, texto }; }

function requireSocio(req, res, next) {
  if (req.usuario) return next();
  const destino = req.method === 'GET' ? req.originalUrl : '/salidas';
  return res.redirect(`/acceso?next=${encodeURIComponent(destino)}`);
}

// Requiere la segunda identificación y el permiso indicado
function requireGestion(permiso) {
  return (req, res, next) => {
    if (!req.usuario) return res.redirect(`/acceso?next=${encodeURIComponent(req.originalUrl)}`);
    if (!req.gestionActiva) return res.redirect(`/gestion/acceso?next=${encodeURIComponent(req.originalUrl)}`);
    if (permiso && !req.permisos.includes(permiso)) {
      return res.status(403).render('gestion/sin-permisos', { titulo: 'Acceso restringido', motivo: 'permiso' });
    }
    req.session.gestionHasta = Date.now() + config.gestionMinutos * 60 * 1000;
    return next();
  };
}

// Fecha de referencia para el plazo de declaración ("Probar fechas")
function fechaReferencia(req, salidaId) {
  const sim = config.demoTools && req.session.fechasPrueba && req.session.fechasPrueba[salidaId];
  return { fecha: sim || dates.today(), simulada: Boolean(sim) };
}

// Solo permite redirecciones internas
function destinoSeguro(next, defecto) {
  return typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : defecto;
}

module.exports = { contexto, flash, requireSocio, requireGestion, fechaReferencia, destinoSeguro, fmt };
