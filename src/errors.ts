interface KelopsErrorDetails {
  status?: number
  retryAfterMs?: number
  cause?: unknown
}

export class KelopsError extends Error {
  readonly code: string
  readonly status?: number
  readonly retryAfterMs?: number

  constructor(code: string, message: string, details: KelopsErrorDetails = {}) {
    super(message, { cause: details.cause })
    this.name = 'KelopsError'
    this.code = code
    this.status = details.status
    this.retryAfterMs = details.retryAfterMs
  }
}

export function toKelopsError(error: unknown): KelopsError {
  if (error instanceof KelopsError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  return new KelopsError('UNKNOWN', message, { cause: error })
}
