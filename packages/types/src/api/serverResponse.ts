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

  static internalError() {
    return new ServerResponse(false, "Internal Server Error", null, 500);
  }

  static unauthorized() {
    return new ServerResponse(false, "Unauthorized", null, 401);
  }
}
