import type { Metadata, ResolvingMetadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { Eyebrow, SectionLabel } from '@/components/Labels'
import { NewsBody } from '@/components/NewsBody'
import { NewsDate, ScaleBadge } from '@/components/NewsMeta'
import { getGamePatchHeads, getNewsPage } from '@/lib/db'
import {
  isNewsGid,
  newsDescription,
  newsHeading,
  newsIndexable,
  newsPageTitle,
  newsPath,
} from '@/lib/newspage'
import { getDb } from '@/lib/server'
import { OG_SITE } from '@/lib/site'

/**
 * Страница одного патча: русский пересказ, тело поста и ссылка на оригинал.
 * Зачем свой адрес и что из этого идёт в поиск — в lib/newspage.
 *
 * Сутки на ISR, как у карточки игры: пост меняет только крон новостей, и
 * редко — тело правят раз-другой после публикации, пересказ пишется однажды.
 */
export const revalidate = 86_400

/**
 * Пустой список, и он обязателен: без generateStaticParams динамический
 * сегмент не попадает в dynamicRoutes манифеста, revalidate выше не значит
 * ничего, и каждый заход рендерится заново (тот же довод — у карточки игры).
 * Пустой — значит на сборке не предрендерим ни одного поста: их тысячи, а
 * заходят на единицы. Каждый рендерится при первом заходе и живёт сутки
 * (docs: generate-static-params, «All paths at runtime»).
 */
export async function generateStaticParams(): Promise<Array<{ appid: string; gid: string }>> {
  return []
}

/**
 * Пост с игрой или null — на всё, чего страницы нет: кривой appid или gid,
 * поста нет в базе, пост не патч.
 *
 * Не патч — тоже 404: в news_items лежат и распродажи с анонсами (их
 * отсеивает классификатор lib/news), но ни лента, ни карточка игры на них не
 * ссылаются, и выставлять их отдельными страницами незачем.
 *
 * cache: generateMetadata и сама страница рендерят один запрос — база
 * читается однажды.
 */
const load = cache(async (rawAppid: string, rawGid: string) => {
  const appid = Number(rawAppid)
  if (!Number.isInteger(appid) || appid <= 0 || !isNewsGid(rawGid)) return null
  const page = await getNewsPage(await getDb(), appid, rawGid)
  return page && page.item.kind === 'patch' ? page : null
})

type Params = { params: Promise<{ appid: string; gid: string }> }

export async function generateMetadata(
  { params }: Params,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { appid, gid } = await params
  const page = await load(appid, gid)
  if (!page) return {}
  const { item, game } = page

  const title = newsPageTitle(item.title, game?.name)
  const description = newsDescription(item, game?.name)
  const canonical = newsPath(item.appid, item.gid)
  /*
   * Картинку берём у родителя, как ownAddress в lib/site: свой openGraph
   * заменяет родительский ЦЕЛИКОМ, вместе с картинкой, и без этой строки
   * ссылка на патч в мессенджере разворачивалась бы без неё.
   */
  const images = (await parent).openGraph?.images

  return {
    title,
    description,
    alternates: { canonical },
    ...(newsIndexable(item.tldr, game?.listed ?? false)
      ? {}
      : { robots: { index: false, follow: true } }),
    openGraph: {
      ...OG_SITE,
      type: 'article',
      url: canonical,
      title,
      description,
      publishedTime: new Date(item.publishedAt * 1000).toISOString(),
      ...(images?.length ? { images } : {}),
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** Сколько соседних патчей показать внизу: перелинковка, а не архив */
const OTHERS = 6

export default async function PatchPage({ params }: Params) {
  const { appid: rawAppid, gid: rawGid } = await params
  /*
   * notFound() даёт настоящий 404 потому же, почему у карточки игры: над
   * страницей нет границы Suspense — ни loading.tsx, ни своей. Каркас сюда
   * не добавлять, см. lib/firstpaint.test.ts.
   */
  const page = await load(rawAppid, rawGid)
  if (!page) notFound()
  const { item, game } = page

  const others = (await getGamePatchHeads(await getDb(), item.appid, OTHERS + 1))
    .filter((h) => h.gid !== item.gid)
    .slice(0, OTHERS)
  const gameHref = `/game/${item.appid}`

  return (
    <div className="flex-1">
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-safe pt-28 pb-16">
        <header className="flex flex-col gap-4 anim-rise">
          {/* Игры в каталоге может не быть (пост пришёл по чьей-то
              библиотеке) — тогда и её карточки нет, и ссылаться некуда */}
          {game && (
            <Link
              href={gameHref}
              className="tap tap-tight self-start text-sm text-dim transition-colors hover:text-ink"
            >
              ← {game.name}
            </Link>
          )}
          <Eyebrow as="p">Что изменилось</Eyebrow>
          <h1 className="font-display text-display-md">{newsHeading(item.title, game?.name)}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <NewsDate at={item.publishedAt} />
            <ScaleBadge scale={item.scale} />
          </div>
        </header>

        {/* Пересказ — то, ради чего у страницы вообще есть адрес. Подпись
            честная, как у «За что любят» на карточке: это собрала модель, а
            ниже — текст издателя без изменений. */}
        {item.tldr && (
          <section className="glass flex flex-col gap-2 rounded-[20px] p-5 md:p-6">
            <SectionLabel as="h2">Коротко</SectionLabel>
            <p className="leading-relaxed text-ink/90">{item.tldr}</p>
            <p className="text-[11px] text-faint">Пересказ собран ИИ по тексту патча</p>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <SectionLabel as="h2">Патч целиком</SectionLabel>
          {item.imageUrl && (
            // Кадр поста из RSS Steam, как в ленте (PatchRow, Cover). Не
            // next/image по той же причине, что в NewsBody: пришлось бы
            // открывать remotePatterns на весь CDN
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt=""
              decoding="async"
              className="w-full rounded-[14px] border border-edge object-cover"
            />
          )}
          {item.blocks.length > 0 ? (
            <NewsBody blocks={item.blocks} />
          ) : (
            <p className="text-sm leading-relaxed text-dim">
              Текста патча у нас нет — он открывается в Steam по ссылке ниже.
            </p>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-5 text-sm">
          {game && (
            <Link
              href={gameHref}
              className="tap tap-tight font-semibold underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
            >
              Всё об игре
            </Link>
          )}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="tap tap-tight text-dim underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
          >
            Оригинал в Steam
          </a>
        </div>

        {others.length > 0 && (
          <section>
            <SectionLabel as="h2" className="mb-2">
              {game ? `Другие патчи ${game.name}` : 'Другие патчи'}
            </SectionLabel>
            <ul className="flex flex-col">
              {others.map((o) => (
                <li key={o.gid} className="border-b border-rule last:border-b-0">
                  <Link
                    href={newsPath(item.appid, o.gid)}
                    className="flex items-baseline justify-between gap-4 py-3 text-sm transition-opacity hover:opacity-70"
                  >
                    <span className="min-w-0 truncate">{newsHeading(o.title, game?.name)}</span>
                    <NewsDate at={o.publishedAt} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  )
}
