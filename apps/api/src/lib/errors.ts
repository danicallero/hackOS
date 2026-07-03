/**
 * Explicit business-error model (plan/02: "estados de error explícitos, sin
 * silencios"). Route handlers throw AppError subclasses; the global error
 * handler in app.ts maps them to a stable JSON shape:
 *
 *   { "error": { "code": "conflict", "message": "...", "details": {...} } }
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, "bad_request", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Missing required capability", details?: Record<string, unknown>) {
    super(403, "forbidden", message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", details?: Record<string, unknown>) {
    super(404, "not_found", message, details);
  }
}

/** State conflicts: capacity full (H11), double transition, stale badge… */
export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(409, "conflict", message, details);
  }
}

/** Rate limits, e.g. H3 verification resend (3/hour, 60s apart). */
export class TooManyRequestsError extends AppError {
  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(429, "too_many_requests", message, { retryAfterSeconds });
  }
}
