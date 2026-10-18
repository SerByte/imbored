'use client'

import Link from '@/components/Link'
import { useLocale } from '@/components/LocaleProvider'
import { useLocaleRouter } from '@/components/useLocaleRouter'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { bounceTo, steamLoginFor } from '@/lib/destination'
import { focusAdrift } from '@/lib/focushandoff'
import { lp, tr } from '@/lib/i18n'
import { presetHint, presetLabel, ROOM_PRESETS, roomArrival, roomSeedOf, type RoomPreset } from '@/lib/presets'
import { isNeedSteam, writerStore } from '@/lib/writer'
import { Icon } from '@/components/Icon'
import { eyebrow } from '@/components/Labels'
import { PosterFan, type FanGame } from '@/components/PosterFan'
import { Spinner } from '@/components/Spinner'
import { StatusLine } from '@/components/StatusLine'
import { useSearch } from '@/components/useSearch'

/**
 * Страница-действие: выбираешь настроение — создаётся комната, и тебя уносит в
 * неё.
 *
 * Смотреть тут почти не на что, поэтому и цена ошибки здесь выше обычного: если
 * действие не состоялось, у человека на экране не остаётся НИЧЕГО — ни
 * содержимого, ни выхода. Раньше именно это и происходило.
 *
 * Что было сломано. Тело эффекта жило в `void (async () => …)()` без единого
 * try: любой сетевой сбой отклонял промис в пустоту, `error` не выставлялся, и
 * спиннер крутился до перезагрузки страницы. Ровно тот же класс ошибки, что
 * описан в докблоке lib/warmup.ts про копию цикла на /daily. Вторая половина —
 * `res.json()` без проверки `ok`: пятисотка отдаёт HTML, разбор бросает, и
 * ветка ошибки ниже была недостижима в принципе.
 *
 * 'needsteam' — сессия по вставленной ссылке: комнату создаёт только вошедший
 * через Steam (requireWriter в lib/server). «Попробовать снова» здесь соврало
 * бы, поэтому вместо повтора — вход, который вернёт сюда же и создаст
 * комнату, и дорога к открытым пати, куда подсесть можно и так.
 *
 * 'choosing' — первый шаг: хост выбирает настроение комнаты (ROOM_PRESETS), и
 * колода собирается под него. Раньше тело запроса зашивало одно настроение на
 * все комнаты, а колода его и вовсе не читала. Выбор — один тап, и он же
 * создаёт комнату: отдельной кнопки «создать» нет, как не было и раньше.
 *
 * Выбранное едет через вход ключом ?preset= (roomQuery в lib/destination):
 * развёрнутый на вход хост возвращается сюда и получает комнату сразу, без
 * повторного вопроса.
 *
 * ?hint= — мост с /play (roomBridgeHref в lib/presets): человек выбирал игру
 * компанией, а ровно такого вечера среди пресетов нет. Похожий пресет только
 * ОТМЕЧАЕТСЯ плашкой «похоже на твоё», комнату по-прежнему создаёт тап:
 * молча создать её с ближайшим настроением значило бы выдать вечер, которого
 * человек не выбирал, без способа поправить. Порядок плиток не меняется —
 * отметка, а не перестановка. С ?preset= подсказка не читается: выбранное
 * важнее похожего.
 *
 * ?game= — «Позвать в эту игру» (со страницы игры, с /pick и с /compat): игра
 * едет в тело запроса и становится первой картой комнаты. Над плитками —
 * строка «Первой картой — …», чтобы хост видел, что игра доехала, прежде чем
 * выбрать вечер. Имя спрашивается у /api/room/seed — той же проверкой, что и
 * создание, — поэтому строка не обещает игру, которую комната не возьмёт.
 * Сервер не ответил — строки нет, а игра всё равно едет: решает создание.
 * Место под строку стоит раньше ответа (см. разметку): строка, родившаяся с
 * ответом, сдвигала плитки из-под пальца.
 * Через вход игра едет вместе с настроением (roomQuery в lib/destination).
 */

/*
 * Веер на плитке настроения — кооп-игры, в которые с этим настроением уходят
 * компанией. Иллюстрация, а не колода: колоду соберёт сервер из ваших
 * библиотек. Эмодзи пресетов остаются в данных — их показывает шапка комнаты.
 */
const PRESET_ART: Record<string, readonly FanGame[]> = {
  evening: [
    { appid: 548430, name: 'Deep Rock Galactic' },
    { appid: 1426210, name: 'It Takes Two' },
    { appid: 892970, name: 'Valheim' },
  ],
  quick: [
    { appid: 252950, name: 'Rocket League' },
    { appid: 730, name: 'Counter-Strike 2' },
  ],
  cozy: [
    { appid: 413150, name: 'Stardew Valley' },
    { appid: 105600, name: 'Terraria' },
    { appid: 648800, name: 'Raft' },
  ],
  talk: [
    { appid: 945360, name: 'Among Us' },
    { appid: 728880, name: 'Overcooked! 2' },
  ],
}
type Phase = 'choosing' | 'creating' | 'failed' | 'busy' | 'needsteam'

/**
 * Хвост адреса /room/new для возврата через вход: выбранный пресет либо
 * подсказка, и игра, в которую зовут. Что из этого доедет, решает roomQuery в
 * lib/destination — здесь только сборка, без второго разбора.
 */
function arrivalQuery(preset: string | null, hint: string | null, game: number | null): URLSearchParams {
  const q = new URLSearchParams()
  if (preset) q.set('preset', preset)
  else if (hint) q.set('hint', hint)
  if (game !== null) q.set('game', String(game))
  return q
}

export default function NewRoomPage() {
  const router = useLocaleRouter()
  const locale = useLocale()
  const [phase, setPhase] = useState<Phase>('choosing')
  /** что выбрано тапом; до тапа — то, с чем вернулись со входа */
  const [picked, setPicked] = useState<RoomPreset | null>(null)
  const started = useRef(false)

  /*
   * Настроение, с которым вернулись со входа (?preset=). Через useSearch, а не
   * чтением адреса в эффекте: эффект, который ставит фазу сам, линтер
   * справедливо называет каскадным рендером, а здесь фаза выводится из
   * адреса прямо в рендере. Эффект ниже зовёт запрос только при найденном
   * пресете, поэтому пустой снимок кадра гидратации (см. components/useSearch)
   * запроса с чужим настроением не пошлёт — он не пошлёт никакого.
   */
  const search = useSearch()
  /* back создаёт комнату сразу, hint — только отметка на плитке (lib/presets) */
  const query = new URLSearchParams(search)
  const { create: back, hint } = roomArrival(query)
  const preset = picked ?? back ?? ROOM_PRESETS[0]
  /* игра, в которую зовут (?game=); имя — когда сервер подтвердил её */
  const game = roomSeedOf(query.get('game'))
  const [seed, setSeed] = useState<{ appid: number; name: string } | null>(null)
  const seedName = seed && seed.appid === game ? seed.name : null
  /*
   * Сессия по ссылке на профиль комнату не создаст — это уже известно, если
   * другая страница документа получила needsteam (lib/writer). Раньше человек
   * выбирал настроение, видел «Создаю комнату…» и только потом узнавал, что
   * нельзя. Теперь экран входа — сразу, до выбора.
   */
  const writer = useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server)
  const view: Phase =
    phase !== 'choosing' ? phase : writer === false ? 'needsteam' : back ? 'creating' : 'choosing'

  const send = useCallback(
    async (p: RoomPreset, g: number | null) => {
      try {
        const res = await fetch('/api/room/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mood: p.mood, game: g ?? undefined }),
        })
        if (res.status === 401) {
          // На языке страницы: bounceTo читает язык из пути и ведёт на лендинг
          // того же языка, а вход вернёт на /en/room/new
          router.push(bounceTo(lp(locale, '/room/new'), arrivalQuery(p.key, null, g)))
          return
        }
        // Своя ветка у 429: «попробуй ещё раз» — вредный совет, когда упёрся в
        // ограничитель частоты, а ждать надо минуты.
        if (res.status === 429) {
          setPhase('busy')
          return
        }
        if (await isNeedSteam(res)) {
          // Тот же ответ узнают и остальные страницы документа (lib/writer)
          writerStore.set(false)
          setPhase('needsteam')
          return
        }
        if (!res.ok) {
          setPhase('failed')
          return
        }
        const data = (await res.json()) as { roomId?: string }
        // replace, а не push: «назад» из комнаты не должен приводить сюда. С
        // ?preset= в адресе этот заход создал бы ВТОРУЮ комнату, а без него
        // показал бы выбор, который уже сделан
        if (data.roomId) router.replace(`/room/${data.roomId}`)
        else setPhase('failed')
      } catch {
        setPhase('failed')
      }
    },
    [router, locale],
  )

  const create = (p: RoomPreset) => {
    setPicked(p)
    setPhase('creating')
    void send(p, game)
  }

  // Вернулся со входа с уже выбранным настроением — создаём сразу. Один раз:
  // повтор после отказа — кнопкой, с тем же пресетом. Игра — из того же снимка
  // адреса, что и back: пустой кадр гидратации сюда не доходит (!back)
  useEffect(() => {
    if (!back || started.current || writerStore.get() === false) return
    started.current = true
    void send(back, game)
  }, [back, game, send])

  // Имя игры, в которую зовут, — для строки над плитками. setSeed только в
  // ответе, не в теле эффекта; отказ и сбой — строки просто нет
  useEffect(() => {
    if (game === null) return
    const ac = new AbortController()
    const stop = () => ac.abort()
    fetch(`/api/room/seed?game=${game}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { appid: number; name: string } | null) => d && setSeed(d))
      .catch(() => {})
    // Не «return () => …»: сторож фокуса (lib/focushandoff.test) считает
    // каждый «return (» в этом файле экраном, который обязан начинаться со
    // строки status
    return stop
  }, [game])

  /*
   * ЭКРАН ОТКАЗА ЗАБИРАЕТ ФОКУС, А ПОПЫТКА — ГОЛОС.
   *
   * Тап по плитке меняет весь экран на спиннер, и плитка уходит вместе с
   * фокусом — он падал в body. Потом спиннер так же целиком сменялся на «Не
   * получилось создать комнату» или «Слишком много комнат подряд», и
   * скринридер не говорил ни слова: живой области на этом пути не было, фокус
   * никуда не переезжал. Человек не знал, что попытка кончилась отказом.
   *
   * Заголовок отказа забирает фокус — и объявляет себя сам. Только после
   * попытки (тап или возврат со входа с ?preset=): экран входа, показанный
   * сразу при заходе (writer уже false), — не новость, и фокус у только что
   * открывшего страницу не отнимается. И только потерянный (focusAdrift):
   * стоящего в шапке отказ не трогает. Колбэк стабилен по picked — иначе
   * каждый рендер переподключал бы ref и забирал фокус снова.
   *
   * Сама попытка звучит строкой status: она стоит первым ребёнком фрагмента
   * во всех return и переживает подмену экранов (React сверяет по месту), а
   * спиннер с role="status" рождается вместе со своим экраном и звучит не
   * везде (components/StatusLine).
   */
  const focusFailure = useCallback(
    (el: HTMLHeadingElement | null) => {
      if (el && (picked !== null || started.current) && focusAdrift(document)) el.focus()
    },
    [picked],
  )
  const creatingLine = tr(locale, { ru: 'Создаю комнату для пати…', en: 'Creating your party room…' })
  const status = <StatusLine text={view === 'creating' ? creatingLine : null} className="sr-only" />
  const joinOpen = tr(locale, { ru: 'Подсесть к открытой пати', en: 'Join an open party' })

  if (view === 'choosing') {
    return (
      <>
      {status}
      <div className="flex-1 flex items-center justify-center px-5 py-24">
        <div className="max-w-3xl w-full flex flex-col gap-8 anim-reveal">
          <div className="text-center flex flex-col items-center gap-2">
            <h1 className="font-display text-display-md">
              {tr(locale, { ru: 'Какой будет вечер?', en: 'What kind of evening?' })}
            </h1>
            <p className="max-w-md text-dim text-sm leading-relaxed">
              {tr(locale, {
                ru: 'Колода соберётся из ваших библиотек под это настроение — его увидят все, кто зайдёт в комнату.',
                en: 'The deck is built from your libraries to fit this mood — everyone who joins the room will see it.',
              })}
              {hint &&
                tr(locale, {
                  ru: ` Ровно такого вечера, как в подборе, здесь нет — похожий, «${hint.label}», отмечен ниже, но выбирать тебе.`,
                  en: ` There's no evening exactly like the one in Pick — the closest, “${presetLabel(hint, locale)}”, is marked below, but it's your call.`,
                })}
            </p>
            {/*
              Место под строку — с кадра, где игра известна, а не с ответа
              /api/room/seed. Колонка стоит по центру экрана, и строка,
              родившаяся с ответом, поднимала заголовок и опускала плитки на
              пол-строки — через полсекунды после того, как человек уже
              целился пальцем в настроение. Так тап и приходился на соседнюю
              плитку. Высота — ровно две строки этого кегля (2 × leading-
              relaxed): игра и «не зайдёт» стоят каждая своей строкой, и
              обычное имя в одну строку влезает. Отказ сервера место не
              забирает: пустая полоса над плитками безобиднее плиток, которые
              уезжают из-под пальца. Сдвиг остаётся один — на кадре
              гидратации, когда адрес читается впервые (components/useSearch):
              он приходит раньше, чем в плитку успевают прицелиться.
            */}
            {game !== null && (
              <p className="max-w-md min-h-[3.25em] text-sm leading-relaxed">
                {seedName && (
                  <>
                    <span className="block">
                      {locale === 'en' ? `First card: “${seedName}”.` : <>Первой картой — «{seedName}».</>}
                    </span>
                    <span className="block">
                      {tr(locale, { ru: 'Не зайдёт — дальше обычная колода.', en: 'Not into it? The usual deck is next.' })}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          {/* Плитки с веером, как ответы квиза: постеры — примеры того, во
              что компания уходит с этим настроением, а не сама колода */}
          <ul className="grid gap-4 md:grid-cols-2">
            {ROOM_PRESETS.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={() => create(p)}
                  className={`panel-lift quiz-tile fan-host w-full px-6 py-6 text-left cursor-pointer${hint?.key === p.key ? ' is-hinted' : ''}`}
                >
                  <PosterFan games={PRESET_ART[p.key] ?? []} />
                  <span aria-hidden className="quiz-scrim" />
                  {/* Отметка — текстом внутри кнопки, а не только рамкой: её
                      слышит скринридер и видит тот, кто не различает цвет */}
                  {hint?.key === p.key && (
                    <span className={`relative block mb-1.5 ${eyebrow('ember')}`}>
                      {tr(locale, { ru: 'похоже на твоё', en: 'close to yours' })}
                    </span>
                  )}
                  <span className="relative block text-[1.375rem] leading-tight font-extrabold tracking-[-0.025em]">
                    {presetLabel(p, locale)}
                  </span>
                  <span className="relative block text-sm text-dim mt-1.5">{presetHint(p, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/rooms" className="tap link-more self-center">
            <Icon name="back" size={16} />
            {joinOpen}
          </Link>
        </div>
      </div>
      </>
    )
  }

  if (view === 'creating') {
    return (
      <>
      {status}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5">
        <Spinner />
        {/* aria-hidden: эту строку скринридеру говорит status выше */}
        <p aria-hidden className="text-dim text-sm">{creatingLine}</p>
      </div>
      </>
    )
  }

  if (view === 'needsteam') {
    return (
      <>
      {status}
      <div className="flex-1 flex items-center justify-center px-5 py-24">
        <div className="max-w-md w-full panel-lift p-8 text-center flex flex-col items-center gap-5 anim-reveal">
          <h1 ref={focusFailure} tabIndex={-1} className="font-display text-display-sm">
            {tr(locale, {
              ru: 'Комнату создаёт вошедший через Steam',
              en: 'Creating a room takes a Steam sign-in',
            })}
          </h1>
          <p className="text-dim text-sm leading-relaxed">
            {tr(locale, {
              ru: 'Ссылка на профиль не доказывает, что профиль твой. По ней можно смотреть подборки и голосовать в чужих пати, а создавать свои и сохранять оценки — после входа.',
              en: "A profile link doesn't prove the profile is yours. With it you can browse picks and vote in other people's parties; creating your own and saving ratings come after you sign in.",
            })}
          </p>
          {/* Настроение — в адрес, только если его правда выбрали: экран входа
              бывает и до выбора, и тогда после входа ждёт выбор, а не комната
              с настроением по умолчанию. Игра едет в любом случае */}
          <a
            href={steamLoginFor(
              lp(locale, `/room/new?${arrivalQuery(picked || back ? preset.key : null, hint?.key ?? null, game)}`),
            )}
            className="btn-ember is-block py-3"
          >
            {tr(locale, { ru: 'Войти через Steam', en: 'Sign in with Steam' })}
          </a>
          <Link href="/rooms" className="tap link-more">
            <Icon name="arrow" size={16} className="rotate-180" />
            {joinOpen}
          </Link>
        </div>
      </div>
      </>
    )
  }

  return (
    <>
    {status}
    <div className="flex-1 flex items-center justify-center px-5 py-24">
      <div className="max-w-md w-full panel-lift p-8 text-center flex flex-col items-center gap-5 anim-reveal">
        <h1 ref={focusFailure} tabIndex={-1} className="font-display text-display-sm">
          {view === 'busy'
            ? tr(locale, { ru: 'Слишком много комнат подряд', en: 'Too many rooms in a row' })
            : tr(locale, { ru: 'Не получилось создать комнату', en: "Couldn't create the room" })}
        </h1>
        <p className="text-dim text-sm leading-relaxed">
          {view === 'busy'
            ? tr(locale, {
                ru: 'С твоего адреса за последний час создано много комнат. Подожди немного — или подсядь к уже открытой пати.',
                en: "A lot of rooms were created from your address in the last hour. Wait a bit — or join a party that's already open.",
              })
            : tr(locale, {
                ru: 'Скорее всего, это на нашей стороне. Обычно помогает повторить.',
                en: "It's most likely on our end. Trying again usually helps.",
              })}
        </p>
        {/* Повтор на месте, а не ссылка на эту же страницу: перезаход сюда
            прошёл бы через started.current и снова упёрся бы в ту же попытку. */}
        {view === 'failed' && (
          <button type="button" onClick={() => create(preset)} className="btn-ember is-block py-3">
            {tr(locale, { ru: 'Попробовать снова', en: 'Try again' })}
          </button>
        )}
        <Link href="/rooms" className="tap link-more">
          <Icon name="arrow" size={16} className="rotate-180" />
          {tr(locale, { ru: 'К списку пати', en: 'All parties' })}
        </Link>
      </div>
    </div>
    </>
  )
}
