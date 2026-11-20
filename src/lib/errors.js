'use strict';
// Error de regla de negocio: se muestra al usuario tal cual.
class ReglaError extends Error {
  constructor(msg, codigo) { super(msg); this.name = 'ReglaError'; this.codigo = codigo; }
}
module.exports = { ReglaError };
