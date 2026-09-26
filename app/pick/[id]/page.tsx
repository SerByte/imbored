import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { GameArt } from '@/components/GameArt'
import { Icon } from '@/components/Icon'
import { Eyebrow } from '@/components/Labels'
import { dayKey } from '@/lib/daily'
import { dayLabel } from '@/lib/freshness'
import { pickCopy, quoted } from '@/lib/sharedpick'
import { OG_SITE } from '@/lib/site'
import { loadSharedPick } from './load'

/*
 * Одна точечная выборка по ключу и строка игры. Динамическая, а не ISR:
 * удаление по запросу и истечение срока обязаны быть видны сразу, а не через
 * час кэша.
 */
export const dynamic = 'force-dynamic'

const loadOnce = cache(loadSharedPick)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const got = await loadOnce(id)
  const { title, description } = pickCopy(
    got ? { name: got.meta.name, reason: got.pick.reason, kind: got.pick.kind } : null,
  )
  const url = `/pick/${id.toLowerCase()}`
  return {
    title,
    description,
    alternates: { canonical: url },
    // В переписку — да, в поисковую выдачу — нет: это чья-то ссылка, а не
    // страница сайта. follow — вес ссылке на карточку игры
    robots: { index: false, follow: true },
    openGraph: { ...OG_SITE, title, description, type: 'website', url },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** Откуда игра — без местоимений: род того, кто выбирал, неизвестен */
function sourceLine(source: string, appid: number): string {
  if (appid < 0) return 'Из библиотеки — игра другого магазина'
  return source === 'new' ? 'Из магазина Steam — ещё не куплена' : 'Из своей библиотеки Steam'
}

/**
 * «imbored выбрал мне на вечер» — выбор, которым поделились.
 *
 * Страница — дверь, а не отчёт: игра, почему она, и «а мне?». Цены нет
 * намеренно: ссылка живёт месяц, а цена — день; причина сохранена без
 * ценового хвоста (lib/sharedpick shareText). Имени того, кто выбирал, и
 * steamid здесь нет — только непрозрачный id в адресе.
 */
export default async function PickPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const got = await loadOnce(id)
  if (!got) notFound()
  const { pick, meta } = got
  const eyebrow = pick.kind === 'daily' ? 'Моя игра дня' : 'imbored выбрал мне на вечер'

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
              {eyebrow} · {dayLabel(dayKey(pick.createdAt))}
            </Eyebrow>
            {/* Кегль героя игры, как на /play и /daily: крупнее одно длинное
                слово названия на телефоне не помещается */}
            <h1 className="font-display text-display-lg [overflow-wrap:anywhere]">{meta.name}</h1>
            <blockquote className="mt-5 text-lg leading-relaxed text-ink">{quoted(pick.reason)}</blockquote>
            <p className="mt-3 text-sm text-dim">{sourceLine(pick.source, meta.appid)}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-6xl flex-col items-start gap-5 px-safe py-14">
        <h2 className="font-display text-display-sm">А тебе?</h2>
        <p className="max-w-md text-sm leading-relaxed text-dim">
          imbored читает библиотеку Steam и выбирает одну игру на вечер — с объяснением, почему
          она. Без Steam — есть демо, это минута.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {/* Квиз открыт любому: гостя он сам доведёт до входа или демо,
              а /quiz не пункт назначения, и bounceTo свёл бы его к главной */}
          <Link href="/quiz" className="btn-ember px-6 py-3">
            Выбери мне игру
          </Link>
          {meta.appid > 0 && (
            <Link href={`/game/${meta.appid}`} className="tap link-more">
              Об игре
              <Icon name="arrow" size={16} />
            </Link>
          )}
          <Link href="/room/new" prefetch={false} className="tap link-more">
            Позвать в пати
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </section>
    </div>
  )
}
