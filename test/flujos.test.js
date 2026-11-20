'use strict';
// Pruebas de extremo a extremo sobre HTTP: navegación, permisos y flujos de los mockups.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-flujos-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db/database');

db.open();
require('../src/db/seed').seed();
const { crearApp } = require('../src/server');

let base; let server;
test.before(async () => {
  server = crearApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

function cliente() {
  const jar = {};
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  async function req(ruta, { method = 'GET', form, body } = {}) {
    const headers = { cookie: cookie() };
    let payload = body;
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
    const r = await fetch(base + ruta, { method, headers, body: payload, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return { status: r.status, location: r.headers.get('location'), text: await r.text() };
  }
  return {
    req,
    async login(email, password = 'socio1234') { return req('/acceso', { method: 'POST', form: { email, password, next: '' } }); },
    async gestion(email, password = 'socio1234') { return req('/gestion/acceso', { method: 'POST', form: { email, password, next: '' } }); },
  };
}

test('el área pública muestra las salidas y pide sesión para inscribirse', async () => {
  const c = cliente();
  const r = await c.req('/');
  assert.equal(r.status, 200);
  assert.match(r.text, /Salidas semanales/);
  assert.match(r.text, /Caminos y olivares/);
  assert.match(r.text, /Necesitas iniciar sesión/);
  const p = await c.req('/salidas');
  assert.equal(p.status, 302);
  assert.match(p.location, /^\/acceso\?next=/);
});

test('registro en tres pasos: pago rechazado, pago aprobado, revisión y alta por la directiva', async () => {
  const nuevo = cliente();
  const datos = { nombre: 'Lucía', apellidos: 'Romero Díaz', fecha_nacimiento: '03/05/1990', telefono: '600 111 222', direccion: 'Calle Nueva, 4, Brenes 41310', email: 'lucia@example.com', password: 'clave-segura', password2: 'clave-segura' };
  const mal = await nuevo.req('/registro', { method: 'POST', form: { ...datos, password2: 'otra' } });
  assert.equal(mal.status, 400);
  assert.match(mal.text, /Las contraseñas no coinciden/);
  assert.equal((await nuevo.req('/registro', { method: 'POST', form: datos })).location, '/registro/pago');
  const rechazado = await nuevo.req('/registro/pago', { method: 'POST', form: { titular: 'LUCIA', numero: '4000 0000 0000 0002', caducidad: '12/29', cvc: '123' } });
  assert.equal(rechazado.location, '/registro/pago/rechazado');
  const ok = await nuevo.req('/registro/pago', { method: 'POST', form: { titular: 'LUCIA', numero: '4242 4242 4242 4242', caducidad: '12/29', cvc: '123' } });
  assert.equal(ok.location, '/registro/confirmacion');
  assert.match((await nuevo.req('/registro/confirmacion')).text, /Tarjeta de prueba terminada en 4242/);

  const pendiente = await nuevo.login('lucia@example.com', 'clave-segura');
  assert.equal(pendiente.status, 400);
  assert.match(pendiente.text, /pendiente de revisión/);

  const pres = cliente();
  await pres.login('socio@example.com');
  await pres.gestion('socio@example.com');
  const lista = await pres.req('/gestion/socios');
  assert.match(lista.text, /1 solicitud pendiente/);
  const id = db.get("SELECT id FROM socios WHERE email='lucia@example.com'").id;
  await pres.req(`/gestion/socios/${id}/aprobar`, { method: 'POST', form: {} });
  const ficha = await pres.req(`/gestion/socios/${id}`);
  assert.match(ficha.text, /Alta registrada con el número de socio 63/);

  assert.equal((await nuevo.login('lucia@example.com', 'clave-segura')).location, '/salidas');
  const cuota = await nuevo.req('/cuota');
  assert.match(cuota.text, /Abonada/);
  assert.match(cuota.text, /Tarjeta \(simulación\)/);
});

test('socio: apuntarse, declarar con foto y la directiva valida (puntos y clasificación)', async () => {
  const ej = cliente();
  await ej.login('socio@example.com');
  const s15 = db.get("SELECT id FROM salidas WHERE fecha='2026-11-15'").id;
  assert.equal((await ej.req(`/salidas/${s15}/apuntarme`, { method: 'POST', form: {} })).location, `/salidas/${s15}/inscripcion`);
  assert.match((await ej.req(`/salidas/${s15}/inscripcion`)).text, /Inscripción registrada/);

  // "Probar fechas": antes del domingo no se puede declarar
  await ej.req(`/salidas/${s15}/fecha-prueba`, { method: 'POST', form: { modo: 'antes', volver: `/salidas/${s15}` } });
  assert.match((await ej.req(`/salidas/${s15}`)).text, /Disponible el domingo/);
  await ej.req(`/salidas/${s15}/fecha-prueba`, { method: 'POST', form: { modo: 'domingo', volver: `/salidas/${s15}` } });
  assert.match((await ej.req(`/salidas/${s15}`)).text, /Declarar asistencia/);

  const fd = new FormData();
  fd.append('evidencia', new Blob([fs.readFileSync(path.join(__dirname, '../seed-assets/foto-socio-a.jpg'))], { type: 'image/jpeg' }), 'mi-foto.jpg');
  const dec = await ej.req(`/salidas/${s15}/declarar`, { method: 'POST', body: fd });
  assert.equal(dec.location, `/salidas/${s15}/participacion`);
  const part = await ej.req(`/salidas/${s15}/participacion`);
  assert.match(part.text, /Pendiente de validación/);
  assert.match(part.text, /mi-foto\.jpg/);
  const otra = await ej.req(`/salidas/${s15}/declarar`);
  assert.equal(otra.location, `/salidas/${s15}/participacion`);

  // La foto solo la ve el propio socio o la directiva
  const archivo = db.get('SELECT evidencia_archivo FROM participaciones WHERE salida_id=? AND socio_id=1', s15).evidencia_archivo;
  const a = cliente(); await a.login('socioa@example.com');
  assert.equal((await a.req(`/evidencias/${archivo}`)).status, 403);
  assert.equal((await ej.req(`/evidencias/${archivo}`)).status, 200);

  await ej.gestion('socio@example.com');
  const lista = await ej.req(`/gestion/participacion?salida=${s15}`);
  assert.match(lista.text, /Socio de ejemplo C/);
  await ej.req(`/gestion/participacion/${s15}/socio/1/confirmar`, { method: 'POST', form: { volver: 'lista' } });
  await ej.req(`/gestion/participacion/${s15}/socio/4/confirmar`, { method: 'POST', form: { volver: 'lista' } });
  const ranking = await ej.req('/clasificacion');
  assert.match(ranking.text, /Socio de ejemplo C<\/td>|Socio de ejemplo C/);
  const p = db.get('SELECT puntos_asignados, estado_validacion FROM participaciones WHERE salida_id=? AND socio_id=4', s15);
  assert.deepEqual({ ...p }, { puntos_asignados: 3, estado_validacion: 'APROBADA' });
});

test('permisos: socio sin cargo no entra en gestión y la tesorera solo ve sus funciones', async () => {
  const a = cliente();
  await a.login('socioa@example.com');
  assert.doesNotMatch((await a.req('/salidas')).text, /Ir a gestión/);
  assert.equal((await a.gestion('socioa@example.com')).location, '/gestion/sin-permisos');
  assert.equal((await a.req('/gestion/socios')).location, '/gestion/acceso?next=%2Fgestion%2Fsocios');

  const el = cliente();
  await el.login('elena@example.com');
  assert.equal((await el.gestion('elena@example.com', 'mala')).status, 400);
  await el.gestion('elena@example.com');
  const cuotas = await el.req('/gestion/cuotas');
  assert.equal(cuotas.status, 200);
  assert.doesNotMatch(cuotas.text, /href="\/gestion\/salidas"/);
  assert.equal((await el.req('/gestion/salidas')).status, 403);

  // Otra cuenta no puede verificar la sesión de un socio distinto
  const c = cliente();
  await c.login('socioc@example.com');
  assert.match((await c.gestion('socio@example.com')).text, /misma cuenta/);
});

test('gestión: crear ruta, publicar salida con 14 días y registrar el pago de una cuota', async () => {
  const g = cliente();
  await g.login('socio@example.com');
  await g.gestion('socio@example.com');
  const ruta = await g.req('/gestion/rutas', { method: 'POST', form: { nombre: 'Vega del Guadalquivir', kilometros: '51,5', recorrido: 'Brenes → Tocina → Brenes', puntos_intermedios: 'Tocina', vuelta_a: 'Por la vega', vuelta_b: 'Por Cantillana' } });
  assert.match(ruta.location, /^\/gestion\/salidas\?ruta=\d+$/);
  const rutaId = ruta.location.split('=')[1];
  const corta = await g.req('/gestion/salidas', { method: 'POST', form: { fecha: '25/11/2026', hora: '09:00', tipo: 'SEMANAL', ruta_id: rutaId } });
  assert.equal(corta.status, 400);
  assert.match(corta.text, /14 días de antelación/);
  const pub = await g.req('/gestion/salidas', { method: 'POST', form: { fecha: '27/12/2026', hora: '09:00', tipo: 'SEMANAL', ruta_id: rutaId } });
  assert.match(pub.location, /\/publicada$/);
  assert.match((await g.req(pub.location)).text, /Vega del Guadalquivir/);
  assert.ok(db.get("SELECT COUNT(*) n FROM comunicaciones WHERE canal='WHATSAPP'").n >= 1);

  const cuota = db.get("SELECT c.id FROM cuotas c JOIN socios s ON s.id=c.socio_id WHERE s.email='sociob@example.com' AND c.anio=2026");
  if (cuota) {
    await g.req(`/gestion/cuotas/${cuota.id}/pago`, { method: 'POST', form: { fecha: '12/11/2026', forma: 'EFECTIVO' } });
    const fila = db.get('SELECT estado, forma_pago FROM cuotas WHERE id=?', cuota.id);
    assert.equal(fila.estado, 'PAGADA');
    assert.equal(fila.forma_pago, 'EFECTIVO');
  }
  const csv = await g.req('/gestion/cuotas/informe.csv?anio=2026');
  assert.match(csv.text, /Total recaudado/);
});

test('equipación: confirmar pedido con descuento', async () => {
  const ej = cliente();
  await ej.login('socio@example.com');
  const r = await ej.req('/equipacion/pedido', { method: 'POST', form: {} });
  assert.match(r.location, /^\/equipacion\/pedidos\/\d+$/);
  const p = await ej.req(r.location);
  assert.match(p.text, /Maillot · Talla L · 1 unidad/);
  assert.match(p.text, /50,00 €/);
  assert.match(p.text, /10,00 €/);
});
