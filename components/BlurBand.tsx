/**
 * Полоса прогрессивной размывки.
 *
 * Тот же blur, что в @keyframes reveal, только в пространстве, а не во времени:
 * арт остаётся ярким и насыщенным и просто уходит в мягкость под текстом —
 * ровно так делает киношная титульная карточка. Жёсткий градиент-стоп вместо
 * этого гасит арт целиком, и текст ложится на тусклую, но всё ещё резкую картинку.
 *
 * Пять слоёв лесенкой вместо одного: единственный backdrop-filter даёт
 * равномерное пятно, а не градиент резкости. Раскладка слоёв — в globals.css.
 *
 * Серверный компонент, ноль JS — поэтому годится и внутри RSC (/library, /game).
 */
export function BlurBand({
  height,
  dir = 'up',
  tint = true,
  className = '',
  style,
}: {
  /** Высота полосы, любое CSS-значение: '30vh', 88 и т.п. */
  height: number | string
  /** 'up' — резкость нарастает кверху (размыто снизу, под текстом). */
  dir?: 'up' | 'down'
  /** Подложить заливку фоном страницы, чтобы полоса умирала в фон, а не обрывалась. */
  tint?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const edge = dir === 'up' ? 'to top' : 'to bottom'
  return (
    <div
      aria-hidden
      data-dir={dir}
      className={`blur-band ${className}`}
      style={{
        height,
        [dir === 'up' ? 'bottom' : 'top']: 0,
        ...style,
      }}
    >
      <span />
      <span />
      <span />
      <span />
      <span />
      {tint && (
        <span
          style={{
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
            // var(--bg), а не чёрный: иначе полоса сломается в светлой теме
            background: `linear-gradient(${edge}, var(--bg) 0%, color-mix(in srgb, var(--bg) 55%, transparent) 45%, transparent 100%)`,
          }}
        />
      )}
    </div>
  )
}
