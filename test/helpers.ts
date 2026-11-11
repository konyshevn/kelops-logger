import type { LogEntry } from '../src/types'

export interface Call {
  url: string
  init: RequestInit
}

type Handler = (call: Call) => Response | Promise<Response>

export function mockFetch(...handlers: Handler[]) {
  const calls: Call[] = []
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    const handler = handlers.length > 1 ? handlers.shift()! : handlers[0]!
    return handler(call)
  }) as typeof fetch
  return { fetch: fetchMock, calls }
}

export function reply(body: unknown, status = 202, headers: Record<string, string> = {}): Handler {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
}

export function accepted(): Handler {
  return (call) => {
    const count = bodyOf(call).logs.length
    return new Response(JSON.stringify({ success: true, accepted: count, rejected: 0 }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    })
  }
}

export function fail(error: unknown): Handler {
  return () => {
    throw error
  }
}

export function bodyOf(call: Call): { project_id?: string; logs: LogEntry[] } {
  return JSON.parse(call.init.body as string)
}

export function makeLogs(count: number): LogEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: '2026-11-11T10:00:00.000Z',
    level: 'info' as const,
    service: 'test',
    message: `message ${index}`,
  }))
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
