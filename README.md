# Club Ciclista de Brenes · Sistema de información

Aplicación web funcional (backend + frontend) construida a partir de la ERS y el DAS del proyecto
**IR2627-G1-13** y de los mockups de Figma (`ClubCiclistaBrenes.pdf`).

## Puesta en marcha

Requisitos: **Node.js 22.13 o superior** (usa el SQLite integrado en Node; sin dependencias nativas).

```bash
npm install
npm start            # http://localhost:3000
```

La primera vez se crea `data/club.db` con los datos de ejemplo de los mockups.

| Comando          | Qué hace                                                   |
|------------------|------------------------------------------------------------|
| `npm start`      | Arranca el servidor                                        |
| `npm run dev`    | Arranca con recarga automática                             |
| `npm run seed`   | Borra la base de datos y vuelve a cargar los datos de ejemplo |
| `npm test`       | 21 pruebas: reglas de negocio y flujos completos por HTTP  |

### Cuentas de ejemplo (contraseña `socio1234`)

| Correo               | Persona            | Cargo / permisos de gestión                         |
|----------------------|--------------------|-----------------------------------------------------|
| socio@example.com    | Socio de ejemplo   | Presidente: socios, salidas, participación, cuotas  |
| socioc@example.com   | Socio de ejemplo C | Secretario: socios, salidas, participación          |
| elena@example.com    | Elena García López | Tesorera: socios y cuotas                           |
| socioa@example.com   | Socio de ejemplo A | Sin cargo (no entra en gestión)                     |
| sociob@example.com   | Socio de ejemplo B | Sin cargo · cuota 2026 pendiente                    |

Para registrar un socio nuevo, el pago simulado acepta cualquier tarjeta terminada en **4242**.

### Configuración (variables de entorno)

`PORT`, `SESSION_SECRET` (obligatorio cambiarlo en producción), `DATA_DIR`, `DEMO_TOOLS=0` (oculta
"Probar fechas" y "Simular una cuenta sin permisos"), y `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM` para enviar correos reales. Sin SMTP, los correos y avisos de WhatsApp quedan
registrados en la tabla `comunicaciones` como `SIMULADO`.

## Arquitectura (DAS · arquitectura lógica en tres capas)

```
src/
  routes/        Capa de presentación: publico.js, socio.js, gestion.js
  views/         Plantillas EJS de las pantallas de los mockups
  public/        CSS (tokens extraídos del Figma), JS del cliente
  services/      Capa de lógica: un servicio por subsistema de la ERS
    socios.js          SUBS-001 altas, bajas, reingresos, números de socio
    cuotas.js          SUBS-001 cuotas, pagos, comprobantes, informes
    salidas.js         SUBS-002 rutas, salidas, inscripciones
    participacion.js   SUBS-003 declaraciones, validación, baremo, clasificación
    comunicaciones.js  SUBS-004 correo y WhatsApp
    junta.js           SUBS-005 cargos y permisos
    equipacion.js      SUBS-006 pedidos y descuentos
    tareas.js          Tareas automáticas del sistema (cuotas, recordatorios, bajas, periodos)
  db/            Capa de persistencia: esquema SQLite y datos de ejemplo
data/            Base de datos y fotografías subidas (no se versiona)
```

## Pantallas (mockups → rutas)

| Mockup | Pantalla                         | Ruta |
|-------:|----------------------------------|------|
| 01 | Salidas semanales (pública)          | `/` |
| 02 | Iniciar sesión                       | `/acceso` |
| 21, 25, 26, 22 | Registro, pago, pago rechazado, confirmación | `/registro`, `/registro/pago`, … |
| 03 | Salidas del club                     | `/salidas` |
| 04, 27, 35 | Detalle de salida y participantes | `/salidas/:id` |
| 05 | Inscripción registrada               | `/salidas/:id/inscripcion` |
| 06 | Declarar asistencia                  | `/salidas/:id/declarar` |
| 07 | Mi participación                     | `/salidas/:id/participacion` |
| 33 | Probar disponibilidad (fecha de prueba) | modal en detalle / declarar |
| 08, 17 | Mi cuota y comprobante           | `/cuota`, `/cuota/:anio/comprobante` |
| 09, 19 | Pedido de equipación y confirmación | `/equipacion`, `/equipacion/pedidos/:id` |
| 10 | Clasificación                        | `/clasificacion` |
| 23, 24 | Segunda identificación / sin permisos | `/gestion/acceso`, `/gestion/sin-permisos` |
| 36, 11, 18 | Socios, ficha, alta vigente   | `/gestion/socios`, `/gestion/socios/:id`, `…/alta-vigente` |
| 12, 13, 20 | Preparar salida, crear ruta, salida publicada | `/gestion/salidas`, `/gestion/rutas/nueva`, `…/publicada` |
| 14, 31, 28–30, 32 | Participación, añadir socio, validación | `/gestion/participacion`, `…/socio/:id` |
| 15, 34 | Resultado de prueba social        | `/gestion/pruebas` |
| 16 | Cuotas de socios (tesorería)         | `/gestion/cuotas` (+ informe CSV / PDF) |

## Reglas de negocio implementadas

REGN-001 a REGN-015 (plazo de renovación, baja por impago, unicidad y reingreso de números, mínimo de
cargos, mandato de 2 años, 14 días de antelación, vueltas A/B, consulta de salidas especiales,
participación única, puntos solo validados, baremo de pruebas sociales, periodos semestrales, descuento de
equipación, 3 puntos por salida semanal) y los requisitos de conducta RQF-004 a RQF-014.

## Supuestos tomados donde la ERS no concreta

- Descuento de equipación: 5 € por prenda (completo) o 2,50 € (reducido); configurable en `src/config.js`.
- Las salidas especiales validadas dan 3 puntos, como las semanales.
- El pago con tarjeta del registro es una simulación (la pasarela de pagos está fuera de alcance).
- La directiva aprueba la solicitud de alta; entonces se asigna el número y se registra la cuota.
