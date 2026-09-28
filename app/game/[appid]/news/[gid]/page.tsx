import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GameArt } from '@/components/GameArt'
import { Icon } from '@/components/Icon'
import { Eyebrow, SectionLabel } from '@/components/Labels'
import { NewsBody } from '@/components/NewsBody'
import { NewsDate, ScaleBadge } from '@/components/NewsMeta'
import { PatchShare } from '@/components/PatchShare'
import { getGamePatchHeads } from '@/lib/db'
import {
  newsDescription,
  newsHeading,
  newsIndexable,
  newsPageTitle,
  newsPath,
} from '@/lib/newspage'
import { patchArticleLd, patchBreadcrumbLd, ldScript } from '@/lib/jsonld'
import { appBaseUrl, getDb } from '@/lib/server'
import { OG_SITE } from '@/lib/site'
import { loadPatch } from './load'

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

type Params = { params: Promise<{ appid: string; gid: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { appid, gid } = await params
  const page = await loadPatch(appid, gid)
  if (!page) return {}
  const { item, game } = page

  const title = newsPageTitle(item.title, game?.name)
  const description = newsDescription(item, game?.name)
  const canonical = newsPath(item.appid, item.gid)
  /*
   * Картинки здесь нет намеренно: у патча своя карточка (opengraph-image.tsx
   * рядом), и Next подставляет её сам — но только пока у openGraph этого
   * уровня нет своего ключа images. Раньше здесь передавалась картинка
   * родителя, и патч разворачивался в чате карточкой игры — «СТОИТ ЛИ
   * ИГРАТЬ» вместо того, что изменилось.
   */

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
  const page = await loadPatch(rawAppid, rawGid)
  if (!page) notFound()
  const { item, game } = page

  const others = (await getGamePatchHeads(await getDb(), item.appid, OTHERS + 1))
    .filter((h) => h.gid !== item.gid)
    .slice(0, OTHERS)
  const gameHref = `/game/${item.appid}`

  const baseUrl = appBaseUrl()

  return (
    <div className="relative flex-1 overflow-x-clip">
      {/* Статья и крошки — из того же, что на экране (lib/jsonld): заголовок
          как в h1, «Коротко», кадр, ссылка назад на игру, оригинал */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldScript([patchArticleLd({ item, game, baseUrl }), patchBreadcrumbLd({ item, game, baseUrl })]),
        }}
      />
      {/*
        Свет игры за шапкой патча — тот же приём и тот же лёгкий файл, что
        у героя страницы игры (размытая капсула, а не library_hero): патч —
        продолжение её карточки, и открываться он должен в её цвете.
      */}
      {game && (
        <div aria-hidden className="news-glow">
          <GameArt
            appid={item.appid}
            name=""
            headerImage={game.headerImage}
            art={game.art}
            sizes="460px"
            fallback={null}
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <article className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-safe pt-28 pb-16">
        <header className="flex flex-col gap-4 anim-rise">
          {/* Игры в каталоге может не быть (пост пришёл по чьей-то
              библиотеке) — тогда и её карточки нет, и ссылаться некуда */}
          {game && (
            <Link href={gameHref} transitionTypes={['nav-back']} className="tap tap-tight link-more self-start">
              <Icon name="back" size={16} />
              {game.name}
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
          <section className="panel-lift flex flex-col gap-2 p-5 md:p-6">
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
              className="w-full rounded-[var(--radius-card)] border border-edge object-cover"
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
          {/* Пересказ есть только у нас — отсюда им и делятся (с меткой ref) */}
          <PatchShare
            appid={item.appid}
            gid={item.gid}
            title={newsPageTitle(item.title, game?.name)}
          />
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
