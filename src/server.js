'use strict';
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');
const config = require('./config');
const db = require('./db/database');
const seed = require('./db/seed');
const tareas = require('./services/tareas');
const { contexto } = require('./lib/middleware');
const { ReglaError } = require('./lib/errors');

function crearApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
  app.use('/fonts', express.static(path.join(config.root, 'node_modules/@fontsource/inter/files'), { maxAge: '30d' }));
  app.use(express.urlencoded({ extended: true, limit: '200kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieSession({
    name: 'ccb_sesion', keys: [config.sessionSecret], httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 3600 * 1000,
  }));
  app.use(contexto);

  app.use(require('./routes/publico'));
  app.use(require('./routes/socio'));
  app.use('/gestion', require('./routes/gestion'));

  app.use((req, res) => res.status(404).render('public/error', { titulo: 'Página no encontrada', mensaje: 'La página que buscas no existe o se ha movido.' }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof ReglaError) {
      return res.status(400).render('public/error', { titulo: 'No se ha podido completar', mensaje: err.message });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).render('public/error', { titulo: 'Archivo demasiado grande', mensaje: 'La fotografía no puede superar los 8 MB.' });
    }
    console.error(err);
    return res.status(500).render('public/error', { titulo: 'Se ha producido un error', mensaje: 'Inténtalo de nuevo en unos minutos. Si el problema continúa, avisa a la directiva.' });
  });
  return app;
}

if (require.main === module) {
  db.open();
  if (seed.isEmpty()) {
    seed.seed();
    console.log(`Base de datos vacía: cargados los datos de ejemplo (contraseña de las cuentas: ${seed.PASSWORD_DEMO}).`);
  } else if (seed.versionAntigua()) {
    console.log('Aviso: los datos de ejemplo son de una versión anterior de los mockups.\n' +
      'Para cargar los nuevos (borra los datos actuales), para el servidor y ejecuta:  npm run seed');
  }
  tareas.programar();
  const server = crearApp().listen(config.port, () => {
    console.log(`Club Ciclista de Brenes en http://localhost:${config.port}`);
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`El puerto ${config.port} ya está en uso (¿hay otra instancia arrancada?).\n` +
        `Ciérrala o usa otro puerto, por ejemplo en PowerShell:  $env:PORT=3001; npm start`);
      process.exit(1);
    }
    throw e;
  });
}

module.exports = { crearApp };
