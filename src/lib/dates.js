'use strict';
// Utilidades de fecha. Todas las fechas se manejan como cadenas ISO locales
// ('YYYY-MM-DD' y 'HH:MM') en la zona horaria del club (Europe/Madrid).
const { timeZone } = require('../config');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_ABR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function partsNow() {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

const today = () => partsNow().date;
const nowTime = () => partsNow().time;
const now = () => { const p = partsNow(); return `${p.date} ${p.time}`; };

const formatoDesfase = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'longOffset' });
function desfaseMs(instante) {
  const zona = formatoDesfase.formatToParts(instante).find((p) => p.type === 'timeZoneName').value;
  if (zona === 'GMT') return 0;
  const [horas, minutos] = zona.slice(4).split(':').map(Number);
  return (zona[3] === '-' ? -1 : 1) * (horas * 60 + minutos) * 60_000;
}

function instanteLocal(fecha, hora) {
  const local = Date.parse(`${fecha}T${hora}Z`);
  const anterior = local - desfaseMs(local - 86_400_000);
  const posterior = local - desfaseMs(local + 86_400_000);
  // En otoño se usa la primera hora repetida. En primavera se adelanta la hora inexistente.
  if (anterior + desfaseMs(anterior) === local) return anterior;
  return posterior + desfaseMs(posterior) === local ? posterior : anterior;
}

function toDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fromDate(dt) { return dt.toISOString().slice(0, 10); }

function addDays(iso, n) { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return fromDate(d); }
function addYears(iso, n) { const d = toDate(iso); d.setUTCFullYear(d.getUTCFullYear() + n); return fromDate(d); }
function diffDays(a, b) { return Math.round((toDate(a) - toDate(b)) / 86400000); } // a - b

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dia = (iso) => toDate(iso).getUTCDate();
const anio = (iso) => toDate(iso).getUTCFullYear();
const mes = (iso) => toDate(iso).getUTCMonth();
const diaSemana = (iso) => DIAS[toDate(iso).getUTCDay()];

// "15 nov 2026"
function corta(iso) { if (!iso) return '—'; return `${dia(iso)} ${MESES_ABR[mes(iso)]} ${anio(iso)}`; }
// "15 nov"
function diaMes(iso) { return `${dia(iso)} ${MESES_ABR[mes(iso)]}`; }
// "Domingo, 15 de noviembre de 2026"
function larga(iso) { return `${cap(diaSemana(iso))}, ${dia(iso)} de ${MESES[mes(iso)]} de ${anio(iso)}`; }
// "Domingo, 15 nov 2026"
function media(iso) { return `${cap(diaSemana(iso))}, ${corta(iso)}`; }
const mesAbrMayus = (iso) => MESES_ABR[mes(iso)].toUpperCase();
const nombreMes = (iso) => MESES[mes(iso)];

// "15 nov · 15:30" a partir de 'YYYY-MM-DD HH:MM'
function diaHora(dt) { if (!dt) return '—'; return `${diaMes(dt.slice(0, 10))} · ${dt.slice(11, 16)}`; }

function edad(fechaNacimiento, hoy = today()) {
  const [y, m, d] = fechaNacimiento.split('-').map(Number);
  const [ty, tm, td] = hoy.split('-').map(Number);
  let e = ty - y;
  if (tm < m || (tm === m && td < d)) e -= 1;
  return e;
}

// Acepta 'DD/MM/AAAA', 'YYYY-MM-DD' o '12 nov 2026'. Devuelve ISO o null.
function parseFecha(txt) {
  if (!txt) return null;
  const s = String(txt).trim();
  let y, m, d;
  let mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const mtTexto = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/^(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\.?\s+(?:de\s+)?(\d{4})$/);
  if (mt) { d = +mt[1]; m = +mt[2]; y = +mt[3]; } else if (mtTexto && MESES_ABR.includes(mtTexto[2])) {
    d = +mtTexto[1]; m = MESES_ABR.indexOf(mtTexto[2]) + 1; y = +mtTexto[3];
  } else {
    mt = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!mt) return null;
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return fromDate(dt);
}
const isoToDmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// Periodos de clasificación (REGN-013)
function periodoDe(iso) {
  const y = anio(iso);
  return mes(iso) < 6
    ? { clave: `${y}-1`, inicio: `${y}-01-01`, fin: `${y}-06-30` }
    : { clave: `${y}-2`, inicio: `${y}-07-01`, fin: `${y}-12-31` };
}
function periodoPorClave(clave) {
  const m = /^(\d{4})-([12])$/.exec(clave || '');
  if (!m) return null;
  return periodoDe(m[2] === '1' ? `${m[1]}-01-01` : `${m[1]}-07-01`);
}
function etiquetaPeriodo(p) {
  return p.clave.endsWith('-1') ? `del 1 ene al 30 jun ${p.inicio.slice(0, 4)}` : `del 1 jul al 31 dic ${p.inicio.slice(0, 4)}`;
}
// "Período 2 · jul – dic 2026"
function etiquetaPeriodoCorta(p) {
  return p.clave.endsWith('-1') ? `Período 1 · ene – jun ${p.inicio.slice(0, 4)}` : `Período 2 · jul – dic ${p.inicio.slice(0, 4)}`;
}
// Periodo anterior (-1) o siguiente (+1)
function periodoVecino(p, paso) {
  return periodoDe(paso < 0 ? addDays(p.inicio, -1) : addDays(p.fin, 1));
}

module.exports = {
  today, now, nowTime, instanteLocal, addDays, addYears, diffDays, anio, corta, diaMes, larga, media, diaHora,
  mesAbrMayus, nombreMes, diaSemana, edad, parseFecha, isoToDmy, periodoDe, periodoPorClave, etiquetaPeriodo,
  etiquetaPeriodoCorta, periodoVecino, cap,
};
