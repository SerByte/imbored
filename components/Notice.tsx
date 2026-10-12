import { Ambient } from '@/components/Ambient'

/**
 * Экран без результата: «портрета пока нет», «такой комнаты нет».
 *
 * Эти два экрана рисовались голой строкой посреди пустоты — одним абзацем
 * text-lg и тихой ссылкой, без заголовка и без объяснения. Здесь тот же язык,
 * что у 404 (app/not-found.tsx): открытая колонка по центру на мягком пятне
 * Ambient, заголовок крупно, абзац-объяснение и ряд действий. Не стеклянная
 * коробка: её сняли и с 404, и центрированная карточка читалась заглушкой.
 *
 * Без hooks — годится и в серверном компоненте (портрет), и в клиентском
 * (комната).
 */
export function Notice({
  title,
  body,
  children,
}: {
  title: string
  body: string
  /** действия: главное — btn-ember, второстепенное — btn-glass */
  children?: React.ReactNode
}) {
  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-5 px-5 pt-32 pb-16 text-center anim-reveal">
        <h1 className="font-display text-display-md">{title}</h1>
        <p className="max-w-md leading-relaxed text-dim">{body}</p>
        {children && <div className="mt-3 flex flex-wrap items-center justify-center gap-3">{children}</div>}
      </div>
    </div>
  )
}
