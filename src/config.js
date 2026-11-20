'use strict';
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');

module.exports = {
  root,
  port: Number(process.env.PORT) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'ccb-dev-secret-cambiar-en-produccion',
  dataDir,
  dbFile: process.env.DB_FILE || path.join(dataDir, 'club.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  timeZone: 'Europe/Madrid',

  // Herramientas de demostración que aparecen en los mockups
  // ("Probar fechas", "Simular una cuenta sin permisos", pago simulado).
  demoTools: process.env.DEMO_TOOLS !== '0',

  club: {
    nombre: 'Club Ciclista de Brenes',
    direccion: 'Complejo polideportivo Raúl Fernández Pavón · Brenes, Sevilla',
    localidad: 'Brenes, Sevilla',
  },

  // Reglas de negocio parametrizables
  cuotaImporteDefecto: 30, // € (importe usado en los mockups)
  puntosPorTipo: { SEMANAL: 3, ESPECIAL: 3 }, // REGN-015 (especial: supuesto)
  antelacionSemanalDias: 14, // REGN-007
  consultaEspecial: { apertura: 14, cierre: 7 }, // REGN-009
  descuentoEquipacion: { completoPorUnidad: 5, reducidoPorUnidad: 2.5 }, // REGN-014
  mandatoMaxAnios: 2, // REGN-006
  gestionMinutos: 30, // validez de la segunda identificación

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Club Ciclista de Brenes <no-reply@clubciclistabrenes.es>',
  },

  // Textos de pie de página tal y como aparecen en los mockups
  labels: {
    publicFooter: 'Prototipo · Datos de ejemplo',
    areaFooterLeft: 'Prototipo · Datos ficticios',
    socioFooterCenter: 'Área de socios',
    gestionFooterCenter: 'Vista de gestión · Permisos de ejemplo',
    accesoFooterRight: 'Prototipo de acceso · No se envían datos',
    pagoFooterRight: 'Demostración · Sin cobros reales',
  },
};
