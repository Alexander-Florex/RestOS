// ──────────────────────────────────────────────
// http-error.ts — Error tipado para respuestas HTTP
// ──────────────────────────────────────────────
export class HttpError extends Error {
  public statusCode: number;
  public details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message = 'Solicitud inválida', details?: unknown) {
    return new HttpError(400, message, details);
  }
  static unauthorized(message = 'No autorizado') {
    return new HttpError(401, message);
  }
  static forbidden(message = 'Acceso denegado') {
    return new HttpError(403, message);
  }
  static notFound(message = 'Recurso no encontrado') {
    return new HttpError(404, message);
  }
  static conflict(message = 'Conflicto') {
    return new HttpError(409, message);
  }
}
