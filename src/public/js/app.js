/* Club Ciclista de Brenes — interacción del cliente (sin dependencias) */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---- Menú en móvil ----
  $$('[data-menu-toggle]').forEach((b) => b.addEventListener('click', () => {
    const top = b.closest('[data-topbar]');
    const open = top.classList.toggle('is-open');
    b.setAttribute('aria-expanded', String(open));
  }));

  // ---- Modales ----
  let ultimoFoco = null;
  function abrir(id) {
    const m = document.getElementById(id);
    if (!m) return;
    ultimoFoco = document.activeElement;
    m.classList.add('is-open');
    const f = m.querySelector('input:not([type=hidden]), button');
    if (f) setTimeout(() => f.focus(), 30);
  }
  function cerrar(m) { m.classList.remove('is-open'); if (ultimoFoco) ultimoFoco.focus(); }
  $$('[data-modal-open]').forEach((b) => b.addEventListener('click', () => abrir(b.dataset.modalOpen)));
  $$('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-modal-close]')) cerrar(m); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $$('.modal.is-open').forEach(cerrar);
    $$('[data-dropdown].is-open').forEach((d) => d.classList.remove('is-open'));
  });

  // ---- Confirmación de altas y bajas de una salida ----
  const inscripcion = $('#confirmar-inscripcion');
  if (inscripcion) {
    const formulario = $('form', inscripcion);
    const titulo = $('#inscripcion-titulo', inscripcion);
    const mensaje = $('#inscripcion-mensaje', inscripcion);
    $('[data-inscripcion-cancelar]', inscripcion).addEventListener('click', () => inscripcion.close());
    $$('[data-inscripcion-url]').forEach((boton) => {
      boton.addEventListener('click', () => {
        formulario.action = boton.dataset.inscripcionUrl;
        titulo.textContent = boton.dataset.inscripcionTitulo || 'Confirmar inscripción';
        mensaje.textContent = boton.dataset.inscripcionMensaje;
        inscripcion.showModal();
      });
    });
  }

  // ---- Desplegables ----
  $$('[data-dropdown]').forEach((d) => {
    const t = $('[data-dropdown-toggle]', d);
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = d.classList.toggle('is-open');
      t.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', (e) => {
    $$('[data-dropdown].is-open').forEach((d) => { if (!d.contains(e.target)) d.classList.remove('is-open'); });
  });

  // ---- Participantes plegables ----
  $$('[data-collapsible]').forEach((c) => {
    const b = $('[data-collapse-toggle]', c);
    b.addEventListener('click', () => {
      const open = c.dataset.open !== 'true';
      c.dataset.open = String(open);
      b.setAttribute('aria-expanded', String(open));
    });
  });

  // ---- Utilidades de formularios ----
  $$('[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));
  $$('[data-autosearch]').forEach((i) => {
    let t;
    i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => i.form.submit(), 450); });
    if (i.value) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  });
  $$('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => { if (!window.confirm(f.dataset.confirm)) e.preventDefault(); }));
  $$('[data-print]').forEach((b) => b.addEventListener('click', () => window.print()));
  $$('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select, form')) return;
    window.location.href = tr.dataset.href;
  }));
  // Evita envíos dobles
  $$('form').forEach((f) => f.addEventListener('submit', (e) => {
    if (e.defaultPrevented) return;
    if (f.dataset.enviando) { e.preventDefault(); return; }
    f.dataset.enviando = '1';
    setTimeout(() => { delete f.dataset.enviando; }, 4000);
  }));

  // Filtro de la lista de socios en el modal
  $$('[data-filter-input]').forEach((input) => {
    const lista = $(input.dataset.filterInput);
    const vacio = $('[data-filter-empty]', lista);
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    input.addEventListener('input', () => {
      const q = norm(input.value.trim());
      let visibles = 0;
      $$('[data-filter-item]', lista).forEach((it) => {
        const ok = !q || norm(it.dataset.filterItem).includes(q);
        it.hidden = !ok; if (ok) visibles += 1;
      });
      if (vacio) vacio.hidden = visibles > 0;
    });
  });
  $$('[data-filter-clear]').forEach((b) => b.addEventListener('click', () => {
    const i = $(b.dataset.filterClear); i.value = ''; i.dispatchEvent(new Event('input')); i.focus();
  }));

  // Nombre del archivo de evidencia
  $$('[data-file-input]').forEach((i) => i.addEventListener('change', () => {
    const n = i.files && i.files[0] ? i.files[0].name : 'Ninguno';
    $$('[data-file-name]').forEach((el) => { el.textContent = n; });
  }));

  // Máscaras
  $$('[data-mask-date]').forEach((i) => i.addEventListener('input', (e) => {
    if (e.inputType && e.inputType.startsWith('delete')) return;
    const d = i.value.replace(/\D/g, '').slice(0, 8);
    i.value = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  }));
  $$('[data-mask-card]').forEach((i) => i.addEventListener('input', () => {
    i.value = i.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
  }));
  $$('[data-mask-exp]').forEach((i) => i.addEventListener('input', (e) => {
    if (e.inputType && e.inputType.startsWith('delete')) return;
    const d = i.value.replace(/\D/g, '').slice(0, 4);
    i.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  }));

  // ---- Preparar salida: ruta seleccionada ----
  const rutaSel = $('[data-ruta-select]');
  if (rutaSel) {
    const tipoBox = $('[data-tipo]');
    const upd = () => {
      const o = rutaSel.selectedOptions[0];
      if (!o) return;
      $('[data-ruta-km]').textContent = o.dataset.km || '—';
      $('[data-ruta-vueltas]').textContent = o.dataset.vueltas || '—';
      // Sin vueltas A y B no puede ser una salida semanal (REGN-008): se pregunta el tipo
      if (tipoBox) {
        const tipo = $('select', tipoBox);
        if (o.dataset.semanal === '1') { tipo.value = 'SEMANAL'; tipoBox.hidden = true; } else {
          if (tipo.value === 'SEMANAL') tipo.value = 'PRUEBA_SOCIAL';
          tipoBox.hidden = false;
        }
      }
    };
    rutaSel.addEventListener('change', upd);
  }

  // ---- Clasificación: «Imprimir» solo la sección elegida ----
  $$('[data-print-target]').forEach((b) => b.addEventListener('click', () => {
    const seccion = document.getElementById(b.dataset.printTarget);
    if (!seccion) { window.print(); return; }
    document.body.classList.add('imprimiendo');
    seccion.classList.add('is-printing');
    const limpiar = () => { document.body.classList.remove('imprimiendo'); seccion.classList.remove('is-printing'); window.removeEventListener('afterprint', limpiar); };
    window.addEventListener('afterprint', limpiar);
    window.print();
    setTimeout(limpiar, 1000);
  }));

  // ---- Prueba social: puestos y puntos automáticos ----
  const prueba = $('[data-prueba-form]');
  if (prueba) {
    const body = $('[data-prueba-body]', prueba);
    const baremo = (p) => (p === 1 ? 120 : p === 2 ? 105 : p === 3 ? 90 : p <= 20 ? 85 - 5 * (p - 4) : 5);
    const segundos = (v) => {
      const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(v.trim());
      if (!m) return null;
      const s = +m[1] * 3600 + +m[2] * 60 + +m[3];
      return s > 0 ? s : null;
    };
    const recalcular = (reordenar) => {
      const filas = $$('[data-prueba-fila]', body).map((tr) => ({ tr, input: $('[data-tiempo]', tr), s: segundos($('[data-tiempo]', tr).value) }));
      const con = filas.filter((f) => f.s).sort((a, b) => a.s - b.s);
      let ant = null; let puesto = 0;
      con.forEach((f, i) => { if (f.s !== ant) puesto = i + 1; ant = f.s; f.p = puesto; });
      filas.forEach((f) => {
        const pos = $('[data-pos]', f.tr);
        const invalido = f.input.value.trim() && f.input.value.trim() !== '00:00:00' && !f.s;
        pos.textContent = f.p ? f.p : '—';
        pos.classList.toggle('is-empty', !f.p);
        f.input.classList.toggle('is-empty', !f.p);
        f.input.classList.toggle('has-error', Boolean(invalido));
        $('[data-pts]', f.tr).textContent = f.p ? `${baremo(f.p)} pts` : '—';
        $('[data-estado]', f.tr).innerHTML = f.p ? '<span class="estado-pill">Clasificado</span>'
          : `<span class="estado-text">${invalido ? 'Formato hh:mm:ss' : 'Escribe el tiempo'}</span>`;
      });
      const n = $('[data-num-tiempo]'); if (n) n.textContent = con.length;
      if (reordenar) [...con, ...filas.filter((f) => !f.s)].forEach((f) => body.appendChild(f.tr));
    };
    body.addEventListener('input', (e) => {
      const i = e.target.closest('[data-tiempo]');
      if (i && !(e.inputType || '').startsWith('delete')) {
        const d = i.value.replace(/\D/g, '').slice(0, 6);
        if (d.length > 2 && !i.value.includes(':')) i.value = d.length > 4 ? `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4)}` : `${d.slice(0, 2)}:${d.slice(2)}`;
      }
      recalcular(false);
    });
    body.addEventListener('change', () => recalcular(true));
  }
})();
