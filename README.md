# kelops-logger

Send logs from Node.js to KELOPS. No dependencies, built on the native `fetch` (Node.js 18 or newer). Meant for server-side code, so the API key never has to reach a browser.

## Installation

```
npm install kelops-logger
```

## Quick start

```ts
import { KelopsLogger } from 'kelops-logger'

const logger = new KelopsLogger({
  apiKey: process.env.KELOPS_API_KEY!,
  service: 'billing-api',
  onError: (error) => console.error(error.code, error.message),
})

await logger.info('Service started', { port: 3000 })

try {
  await chargeCard(order)
} catch (error) {
  await logger.error('Card charge failed', { orderId: order.id, error })
}

await logger.close()
```

The methods `debug`, `info`, `warn` and `error` take a message and an optional `context` object. `Error` values inside `context` are turned into `{ name, message, stack }`, and circular references are replaced with `[Circular]`.

Every call sends one request. The method returns a `Promise` that never rejects: errors are passed to `onError`. You do not have to await it, but call `await logger.close()` before the process exits.

Use another service name for a single entry:

```ts
await logger.log({ level: 'warn', message: 'Slow query', service: 'payments', context: { ms: 1800 } })
```

## Buffering

There is no queue by default. To collect logs into batches, enable `buffer`:

```ts
const logger = new KelopsLogger({
  apiKey: process.env.KELOPS_API_KEY!,
  service: 'billing-api',
  buffer: { batchSize: 200, intervalMs: 1000 },
})

logger.info('Request handled', { path: '/orders', ms: 42 })

process.on('SIGTERM', async () => {
  await logger.close()
  process.exit(0)
})
```

| Option | Default | Meaning |
|---|---|---|
| `batchSize` | 100 | how many entries to collect before sending |
| `intervalMs` | 2000 | how long to wait before sending an incomplete batch |
| `maxQueue` | 10000 | maximum number of entries kept in memory |

Only one request is in flight at a time, the rest waits in the queue. When the queue is full, the oldest entries are dropped and `onError` is called once with the code `QUEUE_OVERFLOW`.

The package never subscribes to process signals on its own. Call `flush()` or `close()` where your application shuts down.

## Uncaught exceptions

The `captureUncaught` option sends uncaught exceptions (`uncaughtException`) and unhandled promise rejections (`unhandledRejection`) to KELOPS. It is off by default.

```ts
const logger = new KelopsLogger({
  apiKey: process.env.KELOPS_API_KEY!,
  service: 'billing-api',
  captureUncaught: true,
})
```

What happens when an error occurs:

1. An `error` entry is sent with the message `Uncaught exception: ...` or `Unhandled promise rejection: ...`. The `context` holds `error` (name, message, stack) and `origin`.
2. The package waits for the delivery, but no longer than 3 seconds.
3. The process exits with code 1, just as it would without this option.

The wait time can be changed with `captureUncaught: { flushTimeoutMs: 5000 }`.

If your application already has its own `uncaughtException` or `unhandledRejection` handler, the package only sends the entry and does not exit: the decision stays with your handler.

The option can be enabled for one logger per process, a second `new KelopsLogger` with `captureUncaught` throws an error. `await logger.close()` removes the handlers.

## Using the client directly

If you need your own queue, use `KelopsClient`. It takes ready-made entries and sends them in batches, splitting them into requests of 2000 entries:

```ts
import { KelopsClient } from 'kelops-logger'

const client = new KelopsClient({ apiKey: process.env.KELOPS_API_KEY! })

const result = await client.send([
  { timestamp: new Date().toISOString(), level: 'info', service: 'billing-api', message: 'one' },
  { timestamp: new Date().toISOString(), level: 'warn', service: 'billing-api', message: 'two' },
])
```

`send` returns `{ accepted, rejected, error? }`. If a request fails, it throws a `KelopsError`.

## Options

| Option | Required | Default | Meaning |
|---|---|---|---|
| `apiKey` | yes | | KELOPS API key (`klp_...`) |
| `service` | yes, for `KelopsLogger` | | service name, added to every entry |
| `projectId` | no | project of the key | project to write to |
| `timeoutMs` | no | 10000 | timeout of a single request |
| `retry` | no | see below | retry settings |
| `buffer` | no | off | queue |
| `captureUncaught` | no | off | send uncaught exceptions |
| `onError` | no | | called on any delivery error |
| `fetch` | no | global `fetch` | custom implementation, for example in tests |

## Errors and retries

A request is retried after a network error, a timeout, status 429 and any 5xx. If the server sends `Retry-After`, it is used, otherwise the delay doubles with every attempt.

```ts
retry: { attempts: 3, baseDelayMs: 500, maxDelayMs: 30000 }
```

`attempts` is the total number of attempts including the first one. 4xx errors (invalid key, forbidden project, invalid data) are not retried.

`KelopsError` has `code`, `message`, `status` and `retryAfterMs`. Server codes (`INVALID_API_KEY`, `API_KEY_REVOKED`, `PROJECT_FORBIDDEN`, `RATE_LIMITED`, `VALIDATION_FAILED`, `OVERLOADED` and others) are passed as they are. The package adds its own:

| Code | When |
|---|---|
| `NETWORK` | the request did not reach the server |
| `TIMEOUT` | the server did not answer within `timeoutMs` |
| `SERIALIZATION_FAILED` | an entry could not be converted to JSON |
| `QUEUE_OVERFLOW` | the queue was full and the oldest entries were dropped |
| `CLOSED` | an entry was sent to a closed logger |

If the server accepts some entries and rejects the rest (`ITEMS_REJECTED`), nothing is retried, and `onError` receives the reason for the first rejection.

## Development

```
npm install
npm test
npm run typecheck
npm run build
```

Structure:

- `src/transport.ts` one request to the server and parsing of the response
- `src/retry.ts` retry rules and delays
- `src/client.ts` `KelopsClient`: splitting into batches and retries
- `src/buffer.ts` queue
- `src/logger.ts` `KelopsLogger`: level methods, `flush`, `close`
- `src/uncaught.ts` capturing of uncaught exceptions
- `src/serialize.ts` preparing `context` for sending
- `src/errors.ts` `KelopsError`
- `src/types.ts` types

The server address is hardcoded in `src/transport.ts` (`DEFAULT_URL`). The tests replace `fetch` and do not touch the network, except `test/integration.test.ts`, which starts a local HTTP server.

## License

MIT
