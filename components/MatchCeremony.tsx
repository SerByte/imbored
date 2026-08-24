'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useRef } from 'react'
import { ClickSpark } from '@/components/ClickSpark'
import { EchoTitle } from '@/components/EchoTitle'
import { GameArt } from '@/components/GameArt'
import { LogoMark } from '@/components/Logo'
import { Magnet } from '@/components/Magnet'
import { SplitHeading } from '@/components/SplitHeading'
import { SteamLaunch } from '@/components/SteamLaunch'
import type { GameArtUrls } from '@/lib/art'
import { STORE_LABEL } from '@/lib/stores'

gsap.registerPlugin(useGSAP)

/**
 * Матч — самая большая эмоция продукта, и до сих пор она получала ту же
 * 550-миллисекундную размывку, что и абзац политики конфиденциальности.
 *
 * КРИТИЧНО: таймлайн привязан к matchedAppid, а НЕ к рендеру. Комната
 * опрашивается каждые 2.5 с, и анимация, завязанная на рендер, перезапускалась
 * бы каждые 2.5 секунды — стробоскоп на главном экране продукта.
 */
export function MatchCeremony({
  game,
  memberCount,
}: {
  game: {
    appid: number
    name: string
    headerImage: string | null
    art?: GameArtUrls | null
    store: string | null
    storeUrl: string | null
  }
  memberCount: number
}) {
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      tl.from('[data-beat="art"]', { opacity: 0, duration: 0.5 }, 0.26)
        .from('[data-beat="logo"]', { opacity: 0, scale: 0.7, duration: 0.45 }, 0.38)
        .from('[data-beat="cover"]', { opacity: 0, scale: 0.94, duration: 0.6 }, 0.7)
        .from('[data-beat="cta"]', { opacity: 0, y: 16, duration: 0.5 }, 1.05)
        .from('[data-beat="foot"]', { opacity: 0, duration: 0.4 }, 1.2)
      return () => tl.kill()
    },
    // Ключ — сам матч. Пока appid не сменился, церемония не повторяется.
    { scope, dependencies: [game.appid] },
  )

  return (
    <div
      ref={scope}
      className="media-dark media-full relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden"
    >
      <div data-beat="art" className="absolute inset-0">
        <GameArt
          appid={game.appid}
          name={game.name}
          headerImage={game.headerImage}
          art={game.art}
          variant="hero"
          eager
          className="absolute inset-0 h-full w-full object-cover blur-3xl opacity-30 scale-110"
        />
      </div>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'radial-gradient(60% 60% at 50% 45%, transparent, #0b0c10 90%)' }}
      />
      <div aria-hidden className="grain" />

      <div className="relative max-w-lg w-full text-center flex flex-col items-center gap-5">
        {/* Один залп в центр улыбающегося логотипа — на 1.1 с, ровно когда
            церемония доходит до кульминации. Клика здесь нет, поэтому fireOnMount. */}
        <div data-beat="logo">
          <ClickSpark fireOnMount>
            <LogoMark size={56} happy />
          </ClickSpark>
        </div>

        {/* Призраков ровно столько, сколько людей в комнате: голоса схлопываются
            в одно слово — буквальная картинка того, что сейчас произошло. */}
        <EchoTitle
          text="Это матч!"
          ghosts={memberCount}
          className="font-display text-display-md"
        />

        <p className="text-dim">Все в комнате хотят играть в одно и то же:</p>

        <div data-beat="cover" className="w-full max-w-md">
          <GameArt
            appid={game.appid}
            name={game.name}
            headerImage={game.headerImage}
            art={game.art}
            sizes="(min-width: 768px) 448px, 100vw"
            eager
            className="w-full rounded-[20px] border border-edge aspect-[460/215] object-cover"
          />
        </div>

        <SplitHeading as="div" className="text-2xl font-bold" delay={0.9} stagger={0.05}>
          {game.name}
        </SplitHeading>

        <div data-beat="cta">
          <Magnet>
            {game.storeUrl ? (
              <a
                href={game.storeUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-ember px-8 py-3"
              >
                Открыть в {STORE_LABEL[game.store ?? ''] ?? 'магазине'}
              </a>
            ) : (
              <SteamLaunch
                appid={game.appid}
                className="btn-ember px-8 py-3"
              />
            )}
          </Magnet>
        </div>

        <p data-beat="foot" className="text-xs text-faint">
          Зови всех в войс — договорились же.
        </p>
      </div>
    </div>
  )
}
