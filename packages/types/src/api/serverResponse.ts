/**
 * Standardized REST API response envelope returned by every controller.
 *
 * All responses must go through this wrapper so the client can rely on a
 * consistent `{ success, message, responseObject, statusCode }` shape. Use the
 * static factory methods instead of the constructor.
 */
export class ServerResponse<T = null> {
  success: boolean;
  message: string;
  responseObject: T;
  statusCode: number;

  constructor(
    status: boolean,
    message: string,
    responseObject: T,
    statusCode: number,
  ) {
    this.success = status;
    this.message = message;
    this.responseObject = responseObject;
    this.statusCode = statusCode;
  }

  // ── Static factories ────────────────────────────────────────────────

  /** 200 OK — successful request with a payload. */
  static ok<T>(responseObject: T, message = "OK") {
    return new ServerResponse(true, message, responseObject, 200);
  }

  /** 201 Created — resource successfully created. */
  static created<T>(responseObject: T, message = "Created") {
    return new ServerResponse(true, message, responseObject, 201);
  }

  /** 204 No Content — success with no payload. */
  static noContent(message = "No Content") {
    return new ServerResponse(true, message, null, 204);
  }

  /** 400 Bad Request — malformed input or failed validation. */
  static badRequest(message = "Bad Request") {
    return new ServerResponse(false, message, null, 400);
  }

  /** 401 Unauthorized — missing or invalid session. */
  static unauthorized(message = "Unauthorized") {
    return new ServerResponse(false, message, null, 401);
  }

  /** 403 Forbidden — authenticated but lacking permission (RBAC). */
  static forbidden(message = "Forbidden") {
    return new ServerResponse(false, message, null, 403);
  }

  /** 404 Not Found — resource does not exist. */
  static notFound(message = "Not Found") {
    return new ServerResponse(false, message, null, 404);
  }

  /** 409 Conflict — e.g. duplicate resource or state clash. */
  static conflict(message = "Conflict") {
    return new ServerResponse(false, message, null, 409);
  }

  /** 422 Unprocessable Entity — semantically invalid request. */
  static unprocessableEntity(message = "Unprocessable Entity") {
    return new ServerResponse(false, message, null, 422);
  }

  /** 429 Too Many Requests — rate limit exceeded. */
  static tooManyRequests(message = "Too Many Requests") {
    return new ServerResponse(false, message, null, 429);
  }

  /** 500 Internal Server Error — unexpected failure; payload may carry debug info. */
  static internalError<T>(
    responseObject: T,
    message = "Internal Server Error",
  ) {
    return new ServerResponse(false, message, responseObject, 500);
  }

  /** 501 Not Implemented — endpoint not yet supported. */
  static notImplemented(message = "Not Implemented") {
    return new ServerResponse(false, message, null, 501);
  }

  /** 503 Service Unavailable — dependency down or maintenance mode. */
  static serviceUnavailable(message = "Service Unavailable") {
    return new ServerResponse(false, message, null, 503);
  }
}
