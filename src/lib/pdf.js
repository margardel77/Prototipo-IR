'use strict';
// Generador mínimo de PDF (una página A4, fuentes estándar Helvetica) para los comprobantes
// que se descargan con «Descargar comprobante». Sin dependencias externas.

const A4 = { w: 595.28, h: 841.89 };
const COLORES = {
  dark: [0x20, 0x29, 0x1f], green: [0x42, 0x51, 0x37], muted: [0x59, 0x61, 0x55],
  lime: [0xde, 0xf1, 0x79], soft: [0xe9, 0xed, 0xdf], line: [0xda, 0xdf, 0xd2],
};
const rgb = (c) => c.map((v) => (v / 255).toFixed(3)).join(' ');

// Texto en WinAnsiEncoding (cp1252): los caracteres latinos coinciden con Latin-1.
const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97 };
function codificar(txt) {
  const bytes = [];
  for (const ch of String(txt).replace(/→/g, '->')) {
    const cp = ch.codePointAt(0);
    let b;
    if (CP1252[ch] !== undefined) b = CP1252[ch];
    else if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) b = cp;
    else b = 0x3f; // '?'
    if (b === 0x28 || b === 0x29 || b === 0x5c) bytes.push(0x5c); // escapa ( ) \
    bytes.push(b);
  }
  return Buffer.from(bytes).toString('latin1');
}

// Anchura aproximada de Helvetica (para alinear a la derecha).
function anchura(txt, size, negrita) { return String(txt).length * size * (negrita ? 0.56 : 0.52); }

class Pagina {
  constructor() { this.ops = []; }
  rect(x, y, w, h, color, radio = 0) {
    const yy = A4.h - y - h; // coordenadas desde arriba
    this.ops.push(`${rgb(color)} rg`);
    if (!radio) { this.ops.push(`${x} ${yy} ${w} ${h} re f`); return this; }
    const r = radio; const k = 0.5523 * r;
    this.ops.push([
      `${x + r} ${yy} m`, `${x + w - r} ${yy} l`, `${x + w - r + k} ${yy} ${x + w} ${yy + r - k} ${x + w} ${yy + r} c`,
      `${x + w} ${yy + h - r} l`, `${x + w} ${yy + h - r + k} ${x + w - r + k} ${yy + h} ${x + w - r} ${yy + h} c`,
      `${x + r} ${yy + h} l`, `${x + r - k} ${yy + h} ${x} ${yy + h - r + k} ${x} ${yy + h - r} c`,
      `${x} ${yy + r} l`, `${x} ${yy + r - k} ${x + r - k} ${yy} ${x + r} ${yy} c`, 'f',
    ].join('\n'));
    return this;
  }
  texto(x, y, txt, { size = 11, negrita = false, color = COLORES.dark, derecha = false } = {}) {
    const xx = derecha ? x - anchura(txt, size, negrita) : x;
    this.ops.push(`BT /${negrita ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${xx.toFixed(2)} ${(A4.h - y).toFixed(2)} Td (${codificar(txt)}) Tj ET`);
    return this;
  }
  linea(x, y, w, color = COLORES.line) { return this.rect(x, y, w, 0.8, color); }
}

function documento(pagina, titulo) {
  const contenido = Buffer.from(pagina.ops.join('\n'), 'latin1');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    null, // contenido
    `<< /Title (${codificar(titulo)}) /Producer (Club Ciclista de Brenes) >>`,
  ];
  const partes = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let pos = partes[0].length;
  objs.forEach((o, i) => {
    let buf;
    if (o === null) {
      buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${contenido.length} >>\nstream\n`, 'latin1'), contenido, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    } else buf = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
    offsets.push(pos); partes.push(buf); pos += buf.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  partes.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}

// Comprobante con cabecera del club, una lista de datos y un importe destacado.
function comprobante({ titulo, subtitulo, filas, importe, nota }) {
  const p = new Pagina();
  const x = 56; const w = A4.w - 2 * x;
  p.rect(0, 0, A4.w, 96, COLORES.dark);
  p.rect(x, 25, 46, 46, COLORES.lime, 10).texto(x + 10, 54, 'CB', { size: 17, negrita: true });
  p.texto(x + 62, 54, 'Club Ciclista de Brenes', { size: 19, negrita: true, color: [255, 255, 255] });
  p.texto(x, 140, subtitulo.toUpperCase(), { size: 10, negrita: true, color: COLORES.green });
  p.texto(x, 172, titulo, { size: 24, negrita: true });
  let y = 222;
  for (const [k, v] of filas) {
    p.texto(x, y, k, { size: 10, negrita: true, color: COLORES.muted });
    p.texto(x, y + 18, v, { size: 13 });
    y += 52;
  }
  if (importe) {
    p.rect(x, y + 6, w, 64, COLORES.soft, 8);
    p.texto(x + 18, y + 44, importe.concepto, { size: 12, negrita: true });
    p.texto(x + w - 18, y + 46, importe.valor, { size: 22, negrita: true, derecha: true });
    y += 96;
  }
  p.linea(x, y + 10, w);
  (nota || []).forEach((l, i) => p.texto(x, y + 34 + i * 16, l, { size: 10, color: COLORES.muted }));
  p.texto(x, A4.h - 40, 'Club Ciclista de Brenes · Complejo polideportivo Raúl Fernández Pavón · Brenes, Sevilla', { size: 8.5, color: COLORES.muted });
  return documento(p, `${titulo} · ${subtitulo}`);
}

module.exports = { comprobante, codificar };
