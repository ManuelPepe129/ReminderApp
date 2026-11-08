export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code = 'bad_request', details?: unknown) =>
  new HttpError(400, code, undefined, details);
export const unauthorized = (code = 'unauthorized') => new HttpError(401, code);
export const forbidden = (code = 'forbidden') => new HttpError(403, code);
/** Also used when the caller is not a member, so that the existence of a resource is not leaked. */
export const notFound = (code = 'not_found') => new HttpError(404, code);
export const conflict = (code = 'conflict', details?: unknown) =>
  new HttpError(409, code, undefined, details);
