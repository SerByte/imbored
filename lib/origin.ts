/**
 * Собственный адрес приложения и проверка «запрос пришёл с него же».
 *
 * Модуль без единого импорта: его читает proxy.ts, а тот исполняется до
 * роутов и не должен тянуть за собой базу, next/headers и прочий серверный
 * груз lib/server (который отсюда же реэкспортирует appBaseUrl).
 */

/**
 * Базовый адрес приложения.
 *
 * От него зависит куда больше, чем кажется: return_to у Steam OpenID, ссылки
 * self-chaining'а кронов, watchdog дайджеста и metadataBase для всех
 * og-картинок. Незаданная переменная роняла всё это разом на localhost:3000 —
 * без исключения, без записи в лог, с виду работающим сайтом и битыми
 * каноническими ссылками.
 *
 * Поэтому здесь лестница, а не одна заглушка: сначала APP_BASE_URL, потом то,
 * что Vercel проставляет сам (домен продакшена, затем адрес конкретного
 * деплоя — он же покрывает превью), и только потом localhost.
 *
 * Отказ — по VERCEL, а НЕ по isDeployed(). Разница принципиальная: isDeployed
 * включает NODE_ENV === 'production', а его выставляет обычный next build, и
 * бросок здесь ломал бы локальную сборку — appBaseUrl зовётся на уровне модуля
 * в app/layout.tsx, то есть прямо на сборе данных страниц. На самом Vercel обе
 * VERCEL_*_URL стоят всегда, так что ветка отказа — это страховка от чужого
 * рантайма, а не ожидаемый путь.
 */
export function appBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`
  if (process.env.VERCEL) {
    throw new Error(
      'APP_BASE_URL не задан, и Vercel не сообщил адрес деплоя. ' +
        'Укажи APP_BASE_URL в настройках проекта.',
    )
  }
  return 'http://localhost:3000'
}

/**
 * Имя хоста, на котором сейчас браузер, — по нему он раскладывает куки
 * (порт и схема куки не делят). null — понять не из чего.
 *
 * Из заголовков, а не из req.url: адрес запроса Next собирает из Host только
 * на Vercel (trustHostHeader), а локально подставляет свой -H и порт, и
 * человек на 127.0.0.1 выглядел бы сидящим на localhost. Порядок — как у
 * самого Next для Server Actions: x-forwarded-host, затем host.
 *
 * Заголовки подделать может кто угодно, но только в собственном запросе, —
 * поэтому доверять им можно лишь решение «перекинуть ли на канонический
 * адрес». Сам адрес, куда кидать, отсюда браться не должен.
 */
export function browserHost(headers: Headers): string | null {
  const raw = headers.get('x-forwarded-host')?.split(',')[0]?.trim() || headers.get('host')
  if (!raw) return null
  try {
    return new URL(`http://${raw}`).hostname
  } catch {
    return null
  }
}

/**
 * Пришёл ли запрос с нашей же страницы.
 *
 * Роуты читают тело через req.json(), а он разбирает JSON при ЛЮБОМ
 * Content-Type — значит, обычная форма с enctype=text/plain с чужого сайта
 * доходит до /api/connect и /api/auth/logout без всякого предзапроса CORS.
 * Кука SameSite=Lax тут не спасает: logout её и не требует, а connect её
 * СТАВИТ — и человек незаметно оказывается в чужом профиле.
 *
 * Первым смотрится Sec-Fetch-Site: его выставляет сам браузер, и скрипт
 * подделать его не может. same-origin — наш fetch; none — человек сам
 * открыл адрес (закладка, строка адреса). same-site и cross-site — отказ:
 * поддомены тоже чужие, своих у сайта нет.
 *
 * Если заголовка нет (старый браузер), решает Origin: он обязан быть одним
 * из разрешённых. Нет и его — отказ: наш собственный fetch из любого живого
 * браузера несёт хотя бы Origin, а скриптам и кронам в POST-ручках делать
 * нечего — кроны ходят GET'ом.
 */
export function sameOrigin(headers: Headers, allowed: readonly string[]): boolean {
  const site = headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin' || site === 'none'
  const origin = headers.get('origin')
  return origin !== null && origin !== 'null' && allowed.includes(origin)
}

/** Методы, которые ничего не меняют и потому проверки не требуют. */
export function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}
