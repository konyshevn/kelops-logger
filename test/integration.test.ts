import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { KelopsClient } from '../src/client'
import { DEFAULT_URL } from '../src/transport'
import { makeLogs } from './helpers'

type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void

let server: Server | undefined

async function start(handler: Handler): Promise<typeof fetch> {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => handler(request, response, body))
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return (url, init) => fetch(String(url).replace(DEFAULT_URL, `http://127.0.0.1:${port}`), init)
}

afterEach(async () => {
  if (!server) {
    return
  }
  server.closeAllConnections()
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
})

describe('real http', () => {
  it('delivers logs to the server', async () => {
    let received: { authorization?: string; path?: string; body?: string } = {}
    const customFetch = await start((request, response, body) => {
      received = { authorization: request.headers.authorization, path: request.url, body }
      response.writeHead(202, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ success: true, accepted: 2, rejected: 0 }))
    })
    const client = new KelopsClient({ apiKey: 'klp_key', fetch: customFetch })

    expect(await client.send(makeLogs(2))).toEqual({ accepted: 2, rejected: 0 })
    expect(received.authorization).toBe('Bearer klp_key')
    expect(received.path).toBe('/api/v1/telemetry')
    expect(JSON.parse(received.body!).logs).toHaveLength(2)
  })

  it('waits for Retry-After and retries', async () => {
    let requests = 0
    const customFetch = await start((_request, response) => {
      requests++
      if (requests === 1) {
        response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' })
        response.end(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many records' } }))
        return
      }
      response.writeHead(202, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ success: true, accepted: 1, rejected: 0 }))
    })
    const client = new KelopsClient({ apiKey: 'klp_key', fetch: customFetch })

    expect(await client.send(makeLogs(1))).toEqual({ accepted: 1, rejected: 0 })
    expect(requests).toBe(2)
  })

  it('reports a timeout when the server does not answer', async () => {
    const customFetch = await start(() => undefined)
    const client = new KelopsClient({
      apiKey: 'klp_key',
      fetch: customFetch,
      timeoutMs: 50,
      retry: { attempts: 1 },
    })

    await expect(client.send(makeLogs(1))).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('reports a network error when the server is unreachable', async () => {
    const client = new KelopsClient({
      apiKey: 'klp_key',
      fetch: (_url, init) => fetch('http://127.0.0.1:1', init),
      retry: { attempts: 1 },
    })

    await expect(client.send(makeLogs(1))).rejects.toMatchObject({ code: 'NETWORK' })
  })
})
