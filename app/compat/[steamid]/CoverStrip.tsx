import { GameArt } from '@/components/GameArt'
import type { ArtRef } from '@/lib/compatpage'

/**
 * Лента обложек в шапке — фон, который что-то значит.
 *
 * Раньше здесь лежали два library_hero по 1920px, размытые в кашу чисто ради
 * цвета, да ещё и взятые как две самые наигранные общие игры: страница
 * буквально красилась самым старым, что есть у пары. Лента показывает то же,
 * про что страница, — общие игры, — и берёт header 460×215, которые всё равно
 * нужны списку ниже.
 *
 * Та же композиция, что у карточки для шеринга (полоса обложек сверху, текст
 * под ней): превью в мессенджере и сама страница должны быть одной картинкой.
 */
export function CoverStrip({ games, eagerCount = 3 }: { games: ArtRef[]; eagerCount?: number }) {
  if (!games.length) return null

  return (
    <div aria-hidden className="absolute inset-x-0 top-0 flex h-[46svh]">
      {games.map((g, i) => (
        <GameArt
          key={g.appid}
          appid={g.appid}
          name={g.name}
          headerImage={g.headerImage}
          art={g.art}
          eager={i < eagerCount}
          sizes="(min-width: 768px) 20vw, 34vw"
          className="h-full w-1/3 shrink-0 object-cover md:w-1/5"
        />
      ))}
    </div>
  )
}
