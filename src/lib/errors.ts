export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code ?? "UNKNOWN_ERROR",
      },
    };
  }
}

export function notFound(message = "Not found"): ApiError {
  return new ApiError(404, message, "NOT_FOUND");
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, message, "BAD_REQUEST");
}

export function conflict(message: string): ApiError {
  return new ApiError(409, message, "CONFLICT");
}
