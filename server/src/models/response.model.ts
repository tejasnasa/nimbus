export class ServerResponse<T = null> {
  success: boolean;
  message: string;
  responseObject: T;
  statusCode: number;
  accessToken: string | undefined;

  constructor(
    status: boolean,
    message: string,
    responseObject: T,
    statusCode: number,
    accessToken?: string
  ) {
    this.success = status;
    this.message = message;
    this.responseObject = responseObject;
    this.statusCode = statusCode;
    this.accessToken = accessToken;
  }

  static failed(errorMessage: string): ServerResponse {
    return new ServerResponse(false, errorMessage, null, 400);
  }
}
