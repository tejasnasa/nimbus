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

  static ok<T>(responseObject: T, message = "OK") {
    return new ServerResponse(true, message, responseObject, 200);
  }

  static created<T>(responseObject: T, message = "Created") {
    return new ServerResponse(true, message, responseObject, 201);
  }

  static noContent(message = "No Content") {
    return new ServerResponse(true, message, null, 204);
  }

  static badRequest(message = "Bad Request") {
    return new ServerResponse(false, message, null, 400);
  }

  static unauthorized(message = "Unauthorized") {
    return new ServerResponse(false, message, null, 401);
  }

  static forbidden(message = "Forbidden") {
    return new ServerResponse(false, message, null, 403);
  }

  static notFound(message = "Not Found") {
    return new ServerResponse(false, message, null, 404);
  }

  static conflict(message = "Conflict") {
    return new ServerResponse(false, message, null, 409);
  }

  static unprocessableEntity(message = "Unprocessable Entity") {
    return new ServerResponse(false, message, null, 422);
  }

  static tooManyRequests(message = "Too Many Requests") {
    return new ServerResponse(false, message, null, 429);
  }

  static internalError(message = "Internal Server Error") {
    return new ServerResponse(false, message, null, 500);
  }

  static notImplemented(message = "Not Implemented") {
    return new ServerResponse(false, message, null, 501);
  }

  static serviceUnavailable(message = "Service Unavailable") {
    return new ServerResponse(false, message, null, 503);
  }
}
