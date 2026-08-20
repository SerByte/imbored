/**
 * Здесь жил Unbounded — единственное дисплейное начертание приложения.
 *
 * Он переехал в корневой layout и стал Sofia Sans Condensed: голос продукта
 * не может принадлежать одной странице из восьми (см. докблок --font-display
 * в globals.css). Сегментный layout остаётся ради обёртки flex-цепочки.
 *
 * flex-1 flex flex-col повторяет обёртку из app/template.tsx: без них между
 * <main> и страницей появляется звено, которое рвёт flex-цепочку.
 */
export default function WhatsNewLayout({ children }: LayoutProps<'/whatsnew'>) {
  return <div className="flex-1 flex flex-col">{children}</div>
}
