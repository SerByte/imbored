import type { Metadata } from 'next'
import Link from '@/components/Link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { GameArt } from '@/components/GameArt'
import { Icon } from '@/components/Icon'
import { Eyebrow } from '@/components/Labels'
import { dayKey } from '@/lib/daily'
import { dayLabel } from '@/lib/freshness'
import { isMultiplayerMeta } from '@/lib/recommend'
import { quizHref, roomSeedHref } from '@/lib/presets'
import { seedable } from '@/lib/roomseed'
import { pickCopy, quoted } from '@/lib/sharedpick'
import { lp, toLocale, tr, type Locale } from '@/lib/i18n'
import { localeAlternates, ogSite } from '@/lib/site'
import { heroTitleClass } from '@/lib/titlesize'
import { loadSharedPick, pickHasNear, reasonOn } from './load'

/*
 * Одна точечная выборка по ключу и строка игры. Динамическая, а не ISR:
 * удаление по запросу и истечение срока обязаны быть видны сразу, а не через
 * час кэша.
 */
export const dynamic = 'force-dynamic'

const loadOnce = cache(loadSharedPick)

export async function generateMetadata({ params }: { params: Promise<{ id: string; lang?: string }> }): Promise<Metadata> {
  const { id, lang } = await params
  const locale = toLocale(lang)
  const got = await loadOnce(id)
  // Причина — только на языке страницы (reasonOn): на чужом заголовок
  // называет игру, а описание — общее обещание сайта, без чужой фразы
  const reason = got ? reasonOn(got.pick, locale) : null
  const { title } = pickCopy(got ? { name: got.meta.name, reason: reason ?? '', kind: got.pick.kind } : null, locale)
  const { description } = pickCopy(
    got && reason !== null ? { name: got.meta.name, reason, kind: got.pick.kind } : null,
    locale,
  )
  const url = `/pick/${id.toLowerCase()}`
  return {
    /*
     * Бренд уже в тексте — у пустого выбора и у «…imbored выбрал мне на
     * вечер», — и корневой шаблон «%s · imbored» (app/layout.tsx) печатал
     * его второй раз: протухшая ссылка друга стояла во вкладке и в истории
     * «Выбор на вечер — imbored · imbored». absolute идёт мимо шаблона, и
     * вкладка говорит ровно то же, что карточка в чате (pickCopy). У игры
     * дня бренда в тексте нет — ей шаблон и нужен.
     */
    title: title.includes('imbored') ? { absolute: title } : title,
    description,
    alternates: localeAlternates(locale, url),
    // В переписку — да, в поисковую выдачу — нет: это чья-то ссылка, а не
    // страница сайта. follow — вес ссылке на карточку игры
    robots: { index: false, follow: true },
    openGraph: { ...ogSite(locale), title, description, type: 'website', url: lp(locale, url) },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/**
 * Откуда игра — без местоимений: род того, кто выбирал, неизвестен. По-английски
 * род не нужен — «their» про того, кто прислал ссылку.
 */
function sourceLine(source: string, appid: number, locale: Locale): string {
  if (appid < 0)
    return tr(locale, { ru: 'Из библиотеки — игра другого магазина', en: 'From their library — a game from another store' })
  return source === 'new'
    ? tr(locale, { ru: 'Из магазина Steam — ещё не куплена', en: 'From the Steam store — not bought yet' })
    : tr(locale, { ru: 'Из своей библиотеки Steam', en: 'From their own Steam library' })
}

/**
 * «imbored выбрал мне на вечер» — выбор, которым поделились.
 *
 * Страница — дверь, а не отчёт: игра, почему она, и «а мне?». Цены нет
 * намеренно: ссылка живёт месяц, а цена — день; причина сохранена без
 * ценового хвоста (lib/sharedpick shareText). Имени того, кто выбирал, и
 * steamid здесь нет — только непрозрачный id в адресе.
 */
export default async function PickPage({ params }: { params: Promise<{ id: string; lang?: string }> }) {
  // Язык — из params: у страницы есть тесты, а next/root-params в vitest
  // бросает при импорте. Без lang (тест, вызов вне маршрута) — русский
  const { id, lang } = await params
  const locale = toLocale(lang)
  const got = await loadOnce(id)
  if (!got) notFound()
  const { pick, meta } = got
  const eyebrow =
    pick.kind === 'daily'
      ? tr(locale, { ru: 'Моя игра дня', en: 'My game of the day' })
      : tr(locale, { ru: 'imbored выбрал мне на вечер', en: 'imbored picked my game for tonight' })
  // Цитата — только на языке страницы (reasonOn): на чужом — игра, откуда она и приглашение
  const reason = reasonOn(pick, locale)
  const near = await pickHasNear(meta)

  return (
    <div className="flex-1">
      <section className="media-dark relative flex min-h-[78svh] flex-col justify-end overflow-hidden">
        <GameArt
          appid={meta.appid}
          name=""
          headerImage={meta.headerImage ?? null}
          art={meta.art}
          variant="hero"
          sizes="100vw"
          eager
          fetchPriority="high"
          // На телефоне — постер игры, а не 19% полосы library_hero вдвое
          // крупнее себя: друг по ссылке должен узнать игру (GameArt, portrait)
          portrait
          fallback={null}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/*
          Скрим и полоса — те же, что у героя /play и /daily: арт здесь чёткий
          и любой яркости, и .hero-scrim держит 0.63 над колонкой текста
          (max-w-xl в контейнере max-w-6xl — его геометрия). Скрим карточки
          игры для этого не годится: там фон размыт и приглушён заранее.
        */}
        <div aria-hidden className="absolute inset-0 hero-scrim" />
        <BlurBand height="46vh" dir="up" />
        <div aria-hidden className="grain" />

        <div className="relative mx-auto w-full max-w-6xl px-safe pb-14 pt-40">
          <div className="flex max-w-xl flex-col">
            <Eyebrow className="mb-3">
              {eyebrow} · {dayLabel(dayKey(pick.createdAt), locale)}
            </Eyebrow>
            {/* Кегль героя игры, как на /play и /daily, а у длинного имени —
                ступенью ниже, как на карточке игры: восемь строк display-lg
                закрывали причину. Слово шире колонки — тоже ступенью ниже, а
                рвётся внутри только то, что не влезло и там. Всё это —
                lib/titlesize */}
            <h1 className={heroTitleClass(meta.name)}>{meta.name}</h1>
            {reason !== null && (
              <blockquote className="mt-5 text-lg leading-relaxed text-ink">{quoted(reason, locale)}</blockquote>
            )}
            {/* Без цитаты строка о том, откуда игра, встаёт под названием на место отступа цитаты */}
            <p className={reason !== null ? 'mt-3 text-sm text-dim' : 'mt-5 text-sm text-dim'}>
              {sourceLine(pick.source, meta.appid, locale)}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-6xl flex-col items-start gap-5 px-safe py-14">
        <h2 className="font-display text-display-sm">{tr(locale, { ru: 'А тебе?', en: 'Your turn?' })}</h2>
        {/*
          Сначала — чей это выбор. Адресат видел героя на весь экран и мог
          прочесть его как совет себе, а игру выбирали по чужой библиотеке и
          под чужой вечер. «Того, кто прислал», а не «чужой»: страница одна на
          всех, и автор, открывший свою же ссылку, читает её тоже. «По твоей»,
          а не «из твоей»: выдача берёт и игры магазина, которых в библиотеке
          ещё нет (sourceLine выше). По-английски так же — based on, а не
          from: «pick from yours» обещало бы выбор только из библиотеки.
        */}
        <p className="max-w-md text-sm leading-relaxed text-dim">
          {tr(locale, {
            ru: 'Этот выбор — по библиотеке того, кто прислал ссылку. Тебе imbored выберет по твоей — одну игру на вечер, с объяснением, почему она. Без Steam — есть демо, это минута.',
            en: "This pick is based on the library of whoever sent the link. imbored will pick one for you based on yours — one game for tonight, and why it's the one. No Steam? There's a demo; it takes a minute.",
          })}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {/* Квиз открыт любому: гостя он сам доведёт до входа или демо,
              а /quiz не пункт назначения, и bounceTo свёл бы его к главной */}
          <Link href="/quiz" className="btn-ember px-6 py-3">
            {tr(locale, { ru: 'Выбери мне игру', en: 'Pick a game for me' })}
          </Link>
          {/*
            Мост от чужой игры к своей библиотеке. Голый /quiz выше начинает с
            нуля, и игра, ради которой человек открыл ссылку, терялась. Здесь
            она едет затравкой (quizHref): квиз спросит настроение, гость
            пройдёт через вход — затравку несёт и он (playQuery в
            lib/destination), — и выдача будет из соседей этой игры, под свой
            вкус. Та же ссылка, что на странице игры, и по той же мерке: только
            когда соседи есть (pickHasNear), иначе она вела бы к «похожих не
            нашлось». Серверная ссылка, ни байта скрипта. «По моей», а не «из
            моей» и на английском (based on): соседи затравки берут и игры
            магазина, которых в библиотеке нет (newPool в lib/candidates).
          */}
          {near && (
            <Link href={quizHref(null, meta.appid)} className="tap link-more">
              {locale === 'en' ? (
                <>Similar to {quoted(meta.name, locale)} — based on my library</>
              ) : (
                <>Похожее на «{meta.name}» — по моей библиотеке</>
              )}
              <Icon name="arrow" size={16} />
            </Link>
          )}
          {meta.appid > 0 && (
            <Link href={`/game/${meta.appid}`} className="tap link-more">
              {tr(locale, { ru: 'Об игре', en: 'About the game' })}
              <Icon name="arrow" size={16} />
            </Link>
          )}
          {/* Пати — только у игры, в которую играют вместе: у одиночной
              «позвать в пати» обещало бы то, чего игра не умеет. Та же
              мерка, что у колоды комнаты (isMultiplayerMeta).
              Комната — сразу с этой игрой первой картой (roomSeedHref):
              раньше ссылка вела на голый /room/new, и игра, ради которой
              звали, терялась по дороге. Мерка та же, что у создания комнаты
              (seedable): игру другого магазина, мёртвую или вытесненную
              комната первой картой не возьмёт — тогда и ссылка прежняя, без
              обещания «в эту игру». Как и игру без категорий Steam, которую
              сюда пустили теги: колода пати судит по категориям */}
          {isMultiplayerMeta(meta) && (
            <Link
              href={seedable(meta) ? roomSeedHref(meta.appid) : '/room/new'}
              prefetch={false}
              className="tap link-more"
            >
              {seedable(meta)
                ? tr(locale, { ru: 'Позвать в эту игру', en: 'Invite to this game' })
                : tr(locale, { ru: 'Позвать в пати', en: 'Invite friends' })}
              <Icon name="arrow" size={16} />
            </Link>
          )}
        </div>
      </section>
    </div>
  )
}
