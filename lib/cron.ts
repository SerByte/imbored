import { timingSafeEqual } from 'node:crypto'

/**
 * Авторизация фоновых задач. Первый в проекте путь, не завязанный на куку
 * imbored_session: у крона сессии нет и быть не может.
 *
 * Vercel сам подставляет заголовок Authorization: Bearer $CRON_SECRET, когда
 * переменная задана в окружении проекта. x-cron-secret оставлен для ручного
 * curl и внешнего пингера.
 *
 * Без секрета в проде — закрыто наглухо: иначе публичный роут, дёргающий
 * Steam и Claude, становится бесплатным усилителем для любого желающего.
 * Локально без секрета открыто, чтобы не мешать разработке.
 */
export function cronAuthorized(headers: Headers): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return !process.env.VERCEL && process.env.NODE_ENV !== 'production'

  const given =
    headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? headers.get('x-cron-secret') ?? ''

  // сравнение длин до timingSafeEqual: на разной длине он бросает
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Запас на хвост вызова крона — то, что идёт ПОСЛЕ среза.
 *
 * Хвост — это finally: отметка в catalog_meta, отдача аренды и передача звена.
 * Передача самая долгая: passChain делает до двух запросов с паузой 1.5 с, а
 * ребёнок отвечает не сразу, а после getDb и взятия аренды — на холодном старте
 * это секунды. Не уложился хвост — инстанс снимают на maxDuration, и finally
 * не выполняется: цепочка молча рвётся, аренда висит ещё TTL.
 */
export const CRON_TAIL_MS = 12_000

/**
 * Срок среза — от НАЧАЛА вызова, а не от старта after().
 *
 * Стояло `Date.now() + 50_000` внутри after(), то есть уже после ответа. До
 * него на холодном старте проходят getDb с миграциями, взятие аренды и счёт
 * очереди — секунды, которых в бюджете не было. А maxDuration считает их все:
 * after живёт не дольше maxDuration маршрута (docs Next, after.md, Duration).
 * Бюджет 50 с плюс неучтённое начало плюс хвост выходили за 60.
 *
 * startedAt берётся первой строкой GET; maxDurationSec — экспорт того же роута,
 * чтобы срок не разъехался с потолком при его правке.
 */
export function sliceDeadline(startedAt: number, maxDurationSec: number): number {
  return startedAt + maxDurationSec * 1000 - CRON_TAIL_MS
}

export type SliceClock = {
  /**
   * Зовётся в начале каждой итерации. false — следующая, если окажется не
   * короче самой долгой из уже пройденных, до срока не уложится.
   */
  next(): boolean
  /** Самая долгая итерация среза на сейчас, мс */
  readonly longestMs: number
}

/**
 * Часы среза: не пускают в итерацию, которая заведомо не уложится.
 *
 * Срок проверялся только на входе в итерацию: «прошёл ли он». Итерация
 * карточки — это два похода в Steam через пейсер (1.7 с на шаг, таймаут по
 * 10 с) и вызов модели; начатая за секунду до срока, она выходила за него на
 * всю свою длину — ровно в хвост, отведённый под finally.
 *
 * Вопрос теперь другой: «уложится ли ещё одна». Длина итерации заранее не
 * известна, поэтому берётся самая долгая из уже пройденных в этом срезе —
 * оценка сверху по фактам, а не по худшему случаю (худший — двадцать с лишним
 * секунд на таймаутах — урезал бы срез вдвое ради редкого события). Первая
 * итерация идёт по-старому, по одному сроку: сравнить её ещё не с чем.
 *
 * Итерация меряется от начала до начала следующей, поэтому в неё попадает всё,
 * включая ветки с continue.
 */
export function sliceClock(deadlineAt: number): SliceClock {
  let longest = 0
  let prev: number | null = null
  return {
    next() {
      const t = Date.now()
      if (prev !== null) longest = Math.max(longest, t - prev)
      prev = t
      return t + longest <= deadlineAt
    },
    get longestMs() {
      return longest
    },
  }
}

/** Сколько крон пересказов может молчать, прежде чем его считают отвалившимся */
export const DIGEST_STALE_SEC = 3 * 3600

/**
 * Пора ли пнуть крон пересказов вручную.
 *
 * У новостей есть подстраховка — суточный крон в vercel.json, — а у пересказов
 * нет: на Hobby лимит два расписания на проект, и оба заняты. Значит пересказы
 * висят на одном GitHub Actions, а он глушит расписания после шестидесяти дней
 * тишины в репозитории и вообще ничего не обещает по срокам. Отвалиться это
 * может молча.
 *
 * Поэтому крон новостей, закончив цепочку, смотрит на возраст последнего среза
 * пересказов и при нужде пинает их сам. Три часа — с запасом на обычные
 * опоздания GitHub (10–15 минут) и на пропущенный слот-другой.
 *
 * Неразобранный JSON, отсутствующая запись и мусор в поле означают одно и то
 * же: подтверждения, что пересказы живы, у нас нет. Значит пинаем.
 */
export function digestLooksStale(
  raw: string | null,
  nowSec: number,
  maxAgeSec = DIGEST_STALE_SEC,
): boolean {
  if (!raw) return true
  try {
    const at = Number((JSON.parse(raw) as { at?: unknown }).at ?? 0)
    if (!Number.isFinite(at) || at <= 0) return true
    return nowSec - at >= maxAgeSec
  } catch {
    return true
  }
}
