'use strict';
// Carga inicial con los datos de ejemplo que aparecen en los mockups.
// Uso: `npm run seed` (borra y recrea la base de datos).
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('./database');
const dates = require('../lib/dates');

const PASSWORD_DEMO = 'socio1234';
// Versión de los datos de ejemplo: súbela cuando cambien los mockups.
const SEED_VERSION = '2';

function seed() {
  const hash = bcrypt.hashSync(PASSWORD_DEMO, 10);
  const ins = (sql, ...p) => Number(db.run(sql, ...p).lastInsertRowid);

  db.tx(() => {
    // ---- Socios ----
    const socio = (nombre, apellidos, nac, dir, tel, email, alta) => ins(
      `INSERT INTO socios (nombre, apellidos, fecha_nacimiento, direccion, telefono, email, password_hash, fecha_alta, estado, creado_en)
       VALUES (?,?,?,?,?,?,?,?,'ACTIVO',?)`, nombre, apellidos, nac, dir, tel, email, hash, alta, `${alta} 10:00`);

    const ej = socio('Socio', 'de ejemplo', '1985-04-24', 'Calle de ejemplo, 1', '600 000 000', 'socio@example.com', '2026-10-07');
    const a = socio('Socio de ejemplo', 'A', '1985-06-10', 'Calle Real, 12', '600 000 001', 'socioa@example.com', '2026-10-08');
    const b = socio('Socio de ejemplo', 'B', '1992-03-02', 'Avenida de Andalucía, 5', '600 000 002', 'sociob@example.com', '2026-10-09');
    const c = socio('Socio de ejemplo', 'C', '1974-01-15', 'Calle Sevilla, 33', '600 000 003', 'socioc@example.com', '2026-10-10');
    const el = socio('Elena', 'García López', '1988-05-20', 'Calle Guadalquivir, 8', '600 000 004', 'elena@example.com', '2026-10-12');
    // Socio de ejemplo D: n.º 57, de baja por no renovar la cuota de 2026 (mockup de cuotas: «N.º liberado»)
    const d = socio('Socio de ejemplo', 'D', '1979-09-18', 'Calle Nueva, 21', '600 000 005', 'sociod@example.com', '2025-03-02');
    db.run("UPDATE socios SET estado='BAJA' WHERE id=?", d);

    // Historial de números (Socio de ejemplo: n.º 24 hasta su baja y n.º 58 al volver)
    ins('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion, fecha_fin) VALUES (?,?,?,?)', ej, 24, '2023-01-10', '2025-09-30');
    ins('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion, fecha_fin) VALUES (?,?,?,?)', d, 57, '2025-03-02', '2026-03-31');
    ins('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion) VALUES (?,?,?)', ej, 58, '2026-10-07');
    ins('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion) VALUES (?,?,?)', a, 59, '2026-10-08');
    ins('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion) VALUES (?,?,?)', b, 60, '2026-10-09');
    ins('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion) VALUES (?,?,?)', c, 61, '2026-10-10');
    ins('INSERT INTO asignaciones_numero (socio_id, numero, fecha_asignacion) VALUES (?,?,?)', el, 62, '2026-10-12');

    // ---- Junta directiva (REGN-005) ----
    const cargo = (s, tipo, ini) => ins('INSERT INTO cargos (socio_id, tipo, fecha_inicio, fecha_fin) VALUES (?,?,?,?)',
      s, tipo, ini, dates.addDays(dates.addYears(ini, config.mandatoMaxAnios), -1));
    cargo(ej, 'PRESIDENTE', '2026-10-07');
    cargo(c, 'SECRETARIO', '2026-10-10');
    cargo(el, 'TESORERO', '2026-10-12');

    // ---- Cuotas ----
    ins('INSERT INTO importes_cuota (anio, importe) VALUES (2025, 30), (2026, 30)');
    const cuota = (s, anio, fechaPago, forma) => {
      const id = ins('INSERT INTO cuotas (socio_id, anio, importe, estado, fecha_pago, forma_pago) VALUES (?,?,?,?,?,?)',
        s, anio, 30, fechaPago ? 'PAGADA' : 'PENDIENTE', fechaPago, forma);
      if (fechaPago) {
        ins('INSERT INTO comprobantes (cuota_id, fecha_emision, fecha_envio, mensaje) VALUES (?,?,?,?)',
          id, fechaPago, fechaPago, `Club Ciclista de Brenes · Comprobante de cuota ${anio}`);
      }
    };
    cuota(ej, 2025, '2025-01-15', 'EFECTIVO');
    cuota(a, 2025, '2025-01-20', 'BANCO');
    cuota(d, 2025, '2025-03-02', 'EFECTIVO');
    // Ejercicio 2026 (mockup «Cuotas de socios»: 3 abonadas, pendientes y 1 baja)
    cuota(ej, 2026, '2026-01-12', 'BANCO');
    cuota(a, 2026, '2026-01-12', 'BANCO');
    cuota(b, 2026, null, null);
    cuota(c, 2026, null, null);
    cuota(el, 2026, '2026-02-03', 'EFECTIVO');
    cuota(d, 2026, null, null); // no la renovó: baja el 31 de marzo

    // ---- Rutas ----
    const ruta = (nombre, recorrido, km, puntos, va, vb) => ins(
      'INSERT INTO rutas (nombre, recorrido, kilometros, puntos_intermedios, vuelta_a, vuelta_b) VALUES (?,?,?,?,?,?)',
      nombre, recorrido, km, puntos, va, vb);
    const rOliv = ruta('Caminos y olivares', 'Brenes → camino de los olivares → ribera → Brenes', 45, 'Camino de los olivares · Ribera', 'Por la ribera', 'Por el pueblo');
    const rRib = ruta('Vuelta por la ribera', 'Brenes → ribera del Guadalquivir → Brenes', 32, 'Ribera del Guadalquivir', 'Por la ribera', 'Por el pueblo');
    const rSie = ruta('Ruta de la sierra', 'Brenes → caminos de la sierra → Brenes', 62, 'Caminos de la sierra', 'Por la carretera', 'Por los caminos');
    const rMel = ruta('Melonares', 'Brenes → Cantillana → embalse de El Melonares → Brenes', 58, 'Cantillana · El Melonares', null, null);
    const rGui = ruta('Guillena', 'Brenes → Alcalá del Río → Guillena → Brenes', 40, 'Alcalá del Río', null, null);
    const rVega = ruta('Contrarreloj de la vega', 'Brenes → camino de la vega → Brenes', 18, 'Camino de la vega', null, null);

    // ---- Salidas ----
    const salida = (rutaId, fecha, hora, tipo, pub) => ins(
      "INSERT INTO salidas (ruta_id, fecha, hora, tipo, estado, fecha_publicacion, publicada_por) VALUES (?,?,?,?,'PUBLICADA',?,?)",
      rutaId, fecha, hora, tipo, pub, ej);
    const inscribir = (sal, s, fecha, origen = 'APP') => ins('INSERT INTO inscripciones (salida_id, socio_id, fecha, origen) VALUES (?,?,?,?)', sal, s, fecha, origen);
    const validar = (sal, s, puntos, decl = null, foto = null) => ins(
      `INSERT INTO participaciones (salida_id, socio_id, fecha_declaracion, evidencia_archivo, evidencia_nombre, estado_validacion, validador_id, fecha_validacion, puntos_asignados)
       VALUES (?,?,?,?,?,'APROBADA',?,?,?)`, sal, s, decl, foto, foto ? 'foto-salida.jpg' : null, ej, decl || '2026-01-01 20:00', puntos);

    // Salidas semanales ya realizadas (sep–oct) que explican la clasificación del periodo
    const historicas = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'];
    const rutasRot = [rOliv, rRib, rSie];
    historicas.forEach((f, i) => {
      const id = salida(rutasRot[i % 3], f, '09:00', 'SEMANAL', dates.addDays(f, -14));
      const participantes = [a, ...(i < 5 ? [b] : []), ...(i < 4 ? [c] : [])];
      for (const s of participantes) {
        inscribir(id, s, `${dates.addDays(f, -3)} 19:00`);
        validar(id, s, 3, `${f} 14:00`);
        db.run('UPDATE participaciones SET fecha_validacion=? WHERE salida_id=? AND socio_id=?', `${dates.addDays(f, 1)} 10:00`, id, s);
      }
    });

    // Pruebas sociales del periodo actual (tiempos en borrador, aún sin guardar)
    const pGui = salida(rGui, '2026-11-01', '09:00', 'PRUEBA_SOCIAL', '2026-10-15');
    const pMel = salida(rMel, '2026-11-08', '09:00', 'PRUEBA_SOCIAL', '2026-10-20');
    const tiempo = (sal, s, seg) => ins('INSERT INTO resultados_prueba (salida_id, socio_id, tiempo_segundos, guardado) VALUES (?,?,?,0)', sal, s, seg);
    [[ej, 2010], [a, 1985], [b, 1902], [c, null], [el, 2104]].forEach(([s, t], i) => {
      inscribir(pGui, s, `2026-10-2${i} 18:00`);
      if (t) tiempo(pGui, s, t);
    });
    inscribir(pMel, b, '2026-10-28 18:00');
    inscribir(pMel, a, '2026-10-29 18:00');
    inscribir(pMel, el, '2026-11-08 08:30', 'MANUAL');
    inscribir(pMel, c, '2026-10-30 18:00');
    tiempo(pMel, b, 30 * 60 + 48);
    tiempo(pMel, a, 32 * 60 + 14);
    tiempo(pMel, el, 35 * 60 + 2);

    // Salidas semanales de noviembre (mockups)
    const s15 = salida(rOliv, '2026-11-15', '09:00', 'SEMANAL', '2026-11-01');
    const s22 = salida(rRib, '2026-11-22', '09:00', 'SEMANAL', '2026-11-08');
    salida(rSie, '2026-11-29', '08:00', 'SEMANAL', '2026-11-15');
    inscribir(s15, a, '2026-11-10 20:15');
    inscribir(s15, b, '2026-11-11 09:40');
    inscribir(s15, c, '2026-11-12 21:05');
    inscribir(s22, a, '2026-11-17 19:30');
    inscribir(s22, b, '2026-11-18 08:10');

    fs.mkdirSync(config.uploadsDir, { recursive: true });
    const foto = (src, dst) => { fs.copyFileSync(path.join(config.root, 'seed-assets', src), path.join(config.uploadsDir, dst)); return dst; };
    const fa = foto('foto-socio-a.jpg', 'seed-socio-a.jpg');
    const fb = foto('foto-socio-b.jpg', 'seed-socio-b.jpg');
    ins(`INSERT INTO participaciones (salida_id, socio_id, fecha_declaracion, evidencia_archivo, evidencia_nombre, estado_validacion)
         VALUES (?,?,?,?,?,'PENDIENTE')`, s15, a, '2026-11-15 15:30', fa, 'foto-salida.jpg');
    ins(`INSERT INTO participaciones (salida_id, socio_id, fecha_declaracion, evidencia_archivo, evidencia_nombre, estado_validacion, validador_id, fecha_validacion, puntos_asignados)
         VALUES (?,?,?,?,?,'APROBADA',?,?,3)`, s15, b, '2026-11-15 15:45', fb, 'foto-salida.jpg', ej, '2026-11-16 10:00');

    // Prueba social del primer periodo con el resultado ya guardado (mockup «Clasificación de salidas»: 11 feb 2026)
    const pVega = salida(rVega, '2026-02-11', '10:00', 'PRUEBA_SOCIAL', '2026-01-25');
    [[a, 28 * 60 + 10, 1, 120], [b, 29 * 60 + 2, 2, 105], [c, 31 * 60 + 45, 3, 90]].forEach(([s, seg, pos, pts], i) => {
      inscribir(pVega, s, `2026-02-0${i + 2} 18:00`);
      const pid = ins(`INSERT INTO participaciones (salida_id, socio_id, estado_validacion, validador_id, fecha_validacion, puntos_asignados)
                       VALUES (?,?,'APROBADA',?,?,?)`, pVega, s, ej, '2026-02-12 10:00', pts);
      ins('INSERT INTO resultados_prueba (salida_id, socio_id, participacion_id, tiempo_segundos, posicion, puntos, guardado) VALUES (?,?,?,?,?,?,1)',
        pVega, s, pid, seg, pos, pts);
    });

    // ---- Equipación (catálogo de los mockups) ----
    const articulo = (nombre, desc, precio, tallas) => ins('INSERT INTO articulos (nombre, descripcion, precio_base, tallas) VALUES (?,?,?,?)', nombre, desc, precio, tallas);
    const maillot = articulo('Maillot', 'Maillot del club para tus salidas.', 25, 'S,M,L,XL,XXL');
    const culote = articulo('Culote', 'Culote cómodo para cada ruta.', 25, 'S,M,L,XL,XXL');
    articulo('Casco', 'Casco de ciclismo para socios.', 12, 'S,M,L');
    ins('INSERT INTO campanias (nombre, fecha_inicio, fecha_fin) VALUES (?,?,?)', 'Campaña de equipación 2026', '2026-10-01', '2026-12-31');
    // Carrito del socio de ejemplo (mockup «Carrito»)
    ins('INSERT INTO carrito (socio_id, articulo_id, talla, cantidad) VALUES (?,?,?,?)', ej, maillot, 'L', 1);
    ins('INSERT INTO carrito (socio_id, articulo_id, talla, cantidad) VALUES (?,?,?,?)', ej, culote, 'M', 1);

    db.run('INSERT OR REPLACE INTO meta (clave, valor) VALUES (?,?)', 'seed_version', SEED_VERSION);
  });

  // Las tareas automáticas ya pasadas de este año se consideran ejecutadas.
  require('../services/tareas').marcarPasadas();
}

// Avisa si la base de datos se creó con datos de ejemplo de una versión anterior de los mockups.
function versionAntigua() {
  const r = db.get("SELECT valor FROM meta WHERE clave = 'seed_version'");
  return !r || r.valor !== SEED_VERSION;
}

function isEmpty() { return !db.get('SELECT id FROM socios LIMIT 1'); }

if (require.main === module) {
  if (process.argv.includes('--reset')) {
    for (const f of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) fs.rmSync(f, { force: true });
    fs.rmSync(config.uploadsDir, { recursive: true, force: true });
  }
  db.open();
  if (isEmpty()) { seed(); console.log(`Datos de ejemplo cargados. Contraseña de todas las cuentas: ${PASSWORD_DEMO}`); } else console.log('La base de datos ya tiene datos.');
  db.close();
}

module.exports = { seed, isEmpty, versionAntigua, PASSWORD_DEMO };
