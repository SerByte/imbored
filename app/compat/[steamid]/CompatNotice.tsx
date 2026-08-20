import { Ambient } from '@/components/Ambient'

/**
 * Общая карточка для всех экранов без результата.
 *
 * Раньше стеклянную карточку получал только экран «войди через Steam», а
 * «это твоя ссылка», «игрок не подключал библиотеку» и «не получилось
 * посчитать» рисовались голым абзацем посреди пустоты — в том же файле, на
 * десять строк ниже. Одна оболочка на все состояния делает такое расхождение
 * невозможным, а не просто исправляет его один раз.
 *
 * Серверный компонент: своей интерактивности у него нет, а кнопки приезжают
 * через children — в том числе клиентские.
 */
export function CompatNotice({
  title,
  body,
  children,
}: {
  title: string
  body: string
  children?: React.ReactNode
}) {
  return (
    <div className="relative flex-1 flex items-center justify-center overflow-hidden px-5 py-24">
      <Ambient />
      <div className="anim-rise glass relative flex w-full max-w-md flex-col gap-4 rounded-[20px] p-8 text-center">
        <h1 className="font-display text-display-sm">{title}</h1>
        <p className="text-sm leading-relaxed text-dim">{body}</p>
        {children}
      </div>
    </div>
  )
}
