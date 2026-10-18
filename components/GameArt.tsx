'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  artCandidates,
  artSrcSet,
  brokenImageSrc,
  HERO_SIZES,
  nextArtTry,
  PORTRAIT_HERO_MEDIA,
  type ArtTry,
  type ArtVariant,
  type GameArtUrls,
} from '@/lib/art'
import { TypeCover } from './TypeCover'

/**
 * Обложка игры с деградацией по цепочке источников.
 *
 * URL арта Steam нельзя построить по шаблону: пути контент-адресуемые, с хэшем
 * у каждого ассета (см. lib/art.ts). Поэтому первыми идут резолвленные ссылки из
 * базы, а шаблон остаётся запасным вариантом для ещё не прогретых строк.
 *
 * Размер выбирается под место: в полноэкранный герой уходит library_hero
 * 1920×620, в плитку — header 460×215. Раньше везде брался header, и герой
 * выглядел мылом.
 */
export function GameArt({
  appid,
  name,
  headerImage,
  art,
  variant = 'card',
  className = '',
  sizes,
  fallback,
  eager = false,
  fetchPriority,
  fade = false,
  anchor = null,
  portrait = false,
}: {
  appid: number
  name: string
  headerImage?: string | null
  art?: GameArtUrls | null
  variant?: ArtVariant
  className?: string
  /** Подсказка браузеру о ширине слота; для героя по умолчанию вся ширина окна */
  sizes?: string
  /**
   * Чем заменить картинку, если ни один источник не отдал арт.
   * null — «ничем», в отличие от undefined, который даёт ArtPlaceholder:
   * второму слою панели квиза заглушка с названием игры противопоказана.
   */
  fallback?: React.ReactNode
  eager?: boolean
  /**
   * Приоритет загрузки — только для той картинки, что станет LCP экрана.
   * eager лишь отменяет ленивую загрузку, а в очереди браузера картинка
   * по-прежнему стоит в общем ряду со шрифтами и скриптами; 'high' ставит её
   * первой, и React переносит тот же приоритет в свой preload.
   */
  fetchPriority?: 'high' | 'low' | 'auto'
  /**
   * Проявление по факту загрузки (opacity через CSS img[data-art-fade]).
   * Кэшированная картинка получает data-loaded сразу — уже доступный контент
   * не прячется ради анимации, правило то же, что у .anim-page-in.
   */
  fade?: boolean
  /**
   * Своя игра-ориентир: у игры не из Steam её размытый арт ложится под
   * типографскую обложку (герой, колода). У игр Steam не используется.
   */
  anchor?: { appid: number; name: string } | null
  /**
   * Герой на портретном экране — вертикальный постер вместо library_hero.
   *
   * library_hero — полоса 1920×620, а герой на телефоне — стоячий бокс
   * (78svh и выше). object-cover вписывал полосу по высоте и показывал
   * 10–23% её ширины, растянутые в 2–4 раза: на /pick у Ravenswatch другу
   * доставалось фиолетово-золотое пятно, по которому игру не узнать. Постер
   * 600×900 (library_capsule или плоский library_600x900) в тот же бокс
   * ложится почти целиком, и это та же картинка, что Steam сам ставит в
   * библиотеку. Весит столько же (Terraria: 203 КБ против 220 КБ).
   *
   * Только по просьбе: у героев /play и /daily поверх арта стоит логотип
   * игры (HeroTitle), а у постера свой, впечатанный, — их было бы два.
   * Не загрузился постер — назад к library_hero (posterFailed), а не дальше
   * по цепочке к капсуле. Плоский library_600x900 есть не у всех: у игр,
   * вышедших после перехода Valve на хэшированные пути, его нет вовсе, и
   * 404 приходит ещё до гидрации — его ловит проверка при монтировании.
   */
  portrait?: boolean
}) {
  const source = { appid, art, headerImage }
  const candidates = artCandidates(source, variant)
  // Состояние сбрасывается при смене игры без useEffect: обновление во время
  // рендера — штатный приём React для «состояния, зависящего от пропсов»
  const [tried, setTried] = useState<ArtTry>({ appid, idx: 0, posterFailed: false })
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  if (tried.appid !== appid) {
    setTried({ appid, idx: 0, posterFailed: false })
    if (loaded) setLoaded(false)
  }

  const idx = tried.appid === appid ? tried.idx : 0
  const src = candidates[idx]
  const posterFailed = tried.appid === appid && tried.posterFailed
  // Постер для портретного экрана — пока герой на первом кандидате и
  // постер не отказал (см. portrait)
  const posterSet =
    portrait && variant === 'hero' && appid > 0 && idx === 0 && !posterFailed
      ? artSrcSet(source, 'poster')
      : undefined

  // Отказ картинки — один разбор на оба пути, onError и проверку ниже:
  // постер — назад к полосе героя, остальное — следующий кандидат
  const fail = (url: string) => setTried((t) => nextArtTry(t, { appid, idx, url, posterSet }))

  // Кэшированная картинка может быть готова до подписки на onLoad
  useEffect(() => {
    if (!fade || loaded) return
    const el = imgRef.current
    if (el?.complete && el.naturalWidth > 0) setLoaded(true)
  }, [fade, loaded, src])

  /*
   * ОТКАЗ ДО ГИДРАЦИИ. Картинку из серверной разметки браузер качает сразу,
   * а React вешает на неё onError только при гидрации и уже случившуюся
   * ошибку не повторяет. Герою /pick на телефоне это стоило картинки целиком:
   * сканер предзагрузки просит плоский library_600x900_2x первым, 404 у игры
   * без плоских путей приходит за сотни миллисекунд, а гидрация — дольше
   * секунды. onError так и не звучал, и вместо героя оставалась битая
   * картинка с alt="" поверх тёмного фона. Так же молча вставала и цепочка
   * кандидатов у любого серверного героя.
   *
   * Поэтому один раз при монтировании смотрим, не отказала ли она уже, — тем
   * же приёмом, что у логотипа в HeroTitle. Дальше события приходят живыми:
   * и новые кандидаты, и <img>, который React создаёт сам, подписаны до
   * своего запроса. Сработали оба пути на один отказ — nextArtTry второй
   * гасит.
   */
  const failedBeforeMount = useEffectEvent((url: string) => fail(url))
  useEffect(() => {
    const url = brokenImageSrc(imgRef.current)
    if (url) failedBeforeMount(url)
  }, [])

  /*
   * Игре не из Steam картинок взять неоткуда — вместо заглушки типографская
   * обложка. fallback={null} («ничем») уважается: это вторые, декоративные
   * слои, и обложка там легла бы поверх настоящей.
   */
  if (!src && appid < 0 && fallback !== null)
    return (
      <TypeCover
        appid={appid}
        name={name}
        variant={variant}
        className={className}
      >
        {anchor && (
          <GameArt
            appid={anchor.appid}
            name={anchor.name}
            variant={variant === 'poster' ? 'poster' : 'hero'}
            // Размыт на 28 px — разрешение не видно вовсе, берём самый лёгкий
            sizes="60px"
            fallback={null}
            className="type-cover-anchor"
          />
        )}
      </TypeCover>
    )

  if (!src)
    return (
      <>{fallback !== undefined ? fallback : <ArtPlaceholder name={name} className={className} />}</>
    )

  // srcSet имеет смысл только пока показываем самый крупный вариант: на
  // запасных ссылках размеры уже другие
  const srcSet = idx === 0 ? artSrcSet(source, variant) : undefined
  const slot = sizes ?? (variant === 'hero' ? HERO_SIZES : undefined)

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? slot : undefined}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={fetchPriority}
      onError={(e) => fail(e.currentTarget.currentSrc)}
      onLoad={fade ? () => setLoaded(true) : undefined}
      data-art-fade={fade ? '' : undefined}
      data-loaded={fade && loaded ? '' : undefined}
      className={className}
    />
  )
  if (!posterSet) return img
  /*
   * <picture> с display: contents — бокса у обёртки нет, картинка по-прежнему
   * absolute-слой героя. Цена: React не ставит preload в <head> для <img>
   * внутри <picture>. Герою с fetchPriority="high" это стоит немного —
   * картинка стоит первой в разметке страницы, и сканер предзагрузки
   * находит её сразу, с тем же высоким приоритетом (замер сборки: запрос
   * героя /pick и с preload, и без него уходит на 12–17 мс от начала).
   */
  return (
    <picture className="contents">
      <source media={PORTRAIT_HERO_MEDIA} srcSet={posterSet} sizes={slot} />
      {img}
    </picture>
  )
}

/** Типографская заглушка: название игры вместо иконки битой картинки. */
export function ArtPlaceholder({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center px-3 text-center ${className}`}
      style={{
        background:
          'radial-gradient(80% 120% at 50% 0%, color-mix(in srgb, var(--ink) 10%, transparent), transparent 70%), var(--surface)',
      }}
    >
      <span className="text-xs font-semibold leading-tight text-dim line-clamp-3">{name}</span>
    </div>
  )
}
