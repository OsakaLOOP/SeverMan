export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message = code) { super(message); }
}
