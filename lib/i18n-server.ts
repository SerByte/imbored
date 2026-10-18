import { lang } from 'next/root-params'
import { toLocale, type Locale } from './i18n'

/**
 * Язык страницы в серверном компоненте, generateMetadata и opengraph-image —
 * из сегмента app/[lang] через next/root-params (имя геттера — имя каталога).
 *
 * Без пропсов и без прокидывания: любой серверный компонент под корневым
 * layout спрашивает сам. Клиентским компонентам, Server Actions и route
 * handlers next/root-params недоступен — там useLocale() и
 * localeFromRequest() (docs/i18n.md).
 *
 * Неизвестный сегмент — русский. Дойти сюда с ним нельзя: корневой layout
 * отвечает на чужой язык 404 раньше, чем рендерит детей.
 *
 * Импорт next/root-params подменяет компилятор Next; вне сборки (vitest)
 * модуль бросает при загрузке. Поэтому сюда — только то, что тесты не
 * импортируют, а страницы с тестами берут язык из params.
 */
export async function getLocale(): Promise<Locale> {
  return toLocale(await lang())
}
