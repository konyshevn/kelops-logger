# kelops-logger

Отправка логов из Node.js в KELOPS. Без зависимостей, работает на встроенном `fetch` (Node.js 18 и новее). Подходит для серверного кода: ключ API не нужно передавать в браузер.

## Установка

```
npm install kelops-logger
```

## Быстрый старт

```ts
import { KelopsLogger } from 'kelops-logger'

const logger = new KelopsLogger({
  apiKey: process.env.KELOPS_API_KEY!,
  service: 'billing-api',
  onError: (error) => console.error(error.code, error.message),
})

await logger.info('Сервис запущен', { port: 3000 })

try {
  await chargeCard(order)
} catch (error) {
  await logger.error('Не удалось списать оплату', { orderId: order.id, error })
}

await logger.close()
```

Методы `debug`, `info`, `warn`, `error` принимают сообщение и необязательный объект `context`. Значения `Error` в `context` превращаются в `{ name, message, stack }`, циклические ссылки заменяются на `[Circular]`.

Каждый вызов отправляет один запрос. Метод возвращает `Promise`, который никогда не отклоняется: ошибки приходят в `onError`. Можно не ждать результат, но перед завершением процесса вызовите `await logger.close()`.

Другой сервис для одной записи:

```ts
await logger.log({ level: 'warn', message: 'Медленный запрос', service: 'payments', context: { ms: 1800 } })
```

## Очередь

По умолчанию очереди нет. Чтобы собирать логи в пачки, включите `buffer`:

```ts
const logger = new KelopsLogger({
  apiKey: process.env.KELOPS_API_KEY!,
  service: 'billing-api',
  buffer: { batchSize: 200, intervalMs: 1000 },
})

logger.info('Запрос обработан', { path: '/orders', ms: 42 })

process.on('SIGTERM', async () => {
  await logger.close()
  process.exit(0)
})
```

| Параметр | По умолчанию | Значение |
|---|---|---|
| `batchSize` | 100 | сколько записей накопить до отправки |
| `intervalMs` | 2000 | через сколько отправить накопленное, если пачка не набралась |
| `maxQueue` | 10000 | максимум записей в памяти |

В очереди только один запрос выполняется одновременно, остальное копится. При переполнении удаляются самые старые записи, а `onError` получает один вызов с кодом `QUEUE_OVERFLOW`.

Пакет сам не подписывается на сигналы процесса. Вызывайте `flush()` или `close()` там, где приложение завершается.

## Необработанные исключения

Опция `captureUncaught` отправляет в KELOPS необработанные исключения (`uncaughtException`) и необработанные отклонённые промисы (`unhandledRejection`). По умолчанию выключена.

```ts
const logger = new KelopsLogger({
  apiKey: process.env.KELOPS_API_KEY!,
  service: 'billing-api',
  captureUncaught: true,
})
```

Что происходит при ошибке:

1. В KELOPS уходит запись уровня `error` с сообщением `Uncaught exception: ...` или `Unhandled promise rejection: ...`. В `context` лежат `error` (имя, сообщение, стек) и `origin`.
2. Пакет ждёт отправки, но не дольше 3 секунд.
3. Процесс завершается с кодом 1, как и без этой опции.

Время ожидания можно изменить: `captureUncaught: { flushTimeoutMs: 5000 }`.

Если в приложении уже есть свой обработчик `uncaughtException` или `unhandledRejection`, пакет только отправляет запись и процесс не завершает: решение остаётся за вашим обработчиком.

Опцию можно включить только у одного логгера в процессе, второй `new KelopsLogger` с `captureUncaught` бросит ошибку. `await logger.close()` снимает обработчики.

## Свой способ отправки

Если нужна своя очередь, используйте `KelopsClient`. Он принимает готовые записи и отправляет их пачками, делит на запросы по 2000 штук:

```ts
import { KelopsClient } from 'kelops-logger'

const client = new KelopsClient({ apiKey: process.env.KELOPS_API_KEY! })

const result = await client.send([
  { timestamp: new Date().toISOString(), level: 'info', service: 'billing-api', message: 'one' },
  { timestamp: new Date().toISOString(), level: 'warn', service: 'billing-api', message: 'two' },
])
```

`send` возвращает `{ accepted, rejected, error? }`. Если запрос не удался, бросает `KelopsError`.

## Параметры

| Параметр | Обязательный | По умолчанию | Значение |
|---|---|---|---|
| `apiKey` | да | | ключ API из KELOPS (`klp_...`) |
| `service` | да, для `KelopsLogger` | | имя сервиса, попадает в каждую запись |
| `projectId` | нет | проект из ключа | проект, в который писать |
| `timeoutMs` | нет | 10000 | таймаут одного запроса |
| `retry` | нет | см. ниже | настройки повторов |
| `buffer` | нет | выключена | очередь |
| `captureUncaught` | нет | выключена | отправка необработанных исключений |
| `onError` | нет | | вызывается при любой ошибке отправки |
| `fetch` | нет | глобальный `fetch` | своя реализация, например для тестов |

## Ошибки и повторы

Запрос повторяется при сетевой ошибке, таймауте, статусе 429 и любом 5xx. Если сервер прислал `Retry-After`, используется он, иначе задержка растёт вдвое с каждой попыткой.

```ts
retry: { attempts: 3, baseDelayMs: 500, maxDelayMs: 30000 }
```

`attempts` это общее число попыток вместе с первой. Ошибки 4xx (неверный ключ, чужой проект, неверные данные) не повторяются.

`KelopsError` содержит `code`, `message`, `status` и `retryAfterMs`. Коды сервера (`INVALID_API_KEY`, `API_KEY_REVOKED`, `PROJECT_FORBIDDEN`, `RATE_LIMITED`, `VALIDATION_FAILED`, `OVERLOADED` и другие) приходят как есть. Пакет добавляет свои:

| Код | Когда |
|---|---|
| `NETWORK` | запрос не дошёл до сервера |
| `TIMEOUT` | сервер не ответил за `timeoutMs` |
| `SERIALIZATION_FAILED` | запись не удалось превратить в JSON |
| `QUEUE_OVERFLOW` | очередь переполнилась, старые записи удалены |
| `CLOSED` | запись отправлена в закрытый логгер |

Если сервер принял часть записей, а остальные отклонил (`ITEMS_REJECTED`), повторов нет, а `onError` получает причину первого отклонения.

## Разработка

```
npm install
npm test
npm run typecheck
npm run build
```

Структура:

- `src/transport.ts` один запрос к серверу и разбор ответа
- `src/retry.ts` правила повторов и задержки
- `src/client.ts` `KelopsClient`: деление на пачки и повторы
- `src/buffer.ts` очередь
- `src/logger.ts` `KelopsLogger`: методы уровней, `flush`, `close`
- `src/uncaught.ts` перехват необработанных исключений
- `src/serialize.ts` подготовка `context` к отправке
- `src/errors.ts` `KelopsError`
- `src/types.ts` типы

Адрес сервера зашит в `src/transport.ts` (`DEFAULT_URL`). Тесты подменяют `fetch` и не ходят в сеть, кроме `test/integration.test.ts`: он поднимает локальный HTTP-сервер.

## Лицензия

MIT
