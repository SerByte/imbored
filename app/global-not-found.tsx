// Стили — сами: global-not-found рендерится мимо корневого layout
import './globals.css'
import type { Metadata } from 'next'

/**
 * 404 для адреса, которого нет ни в одном языке: /xyz-nope.
 *
 * Корневой layout живёт под [lang] (app/[lang]/layout.tsx), и для адреса вне
 * разделов собрать 404 из него нельзя — язык неизвестен. Next отдаёт этот
 * файл сам, мимо layout (docs: not-found.md, global-not-found). Поэтому здесь
 * всё своё: стили, тема и оба языка разом — по адресу не понять, чей он.
 *
 * Адреса под языком (/en/xyz-nope, /quiz/xyz-nope) сюда не попадают: их ловит
 * app/[lang]/[...missing] и рисует not-found своего языка со шапкой.
 *
 * Тема — тем же скриптом, что в корневом layout: светлая у тех, кто её
 * выбрал, иначе тёмная по умолчанию. Ссылки — обычные <a>: клиентского
 * роутера здесь нет, и переход на главную — полная загрузка с layout.
 */
export const metadata: Metadata = {
  title: 'Такой страницы нет · Page not found · imbored',
}

const THEME_SCRIPT = `try{if(localStorage.getItem('imbored-theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}`

export default function GlobalNotFound() {
  return (
    <html lang="ru" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full font-sans overflow-x-hidden">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <main
          id="main"
          className="mx-auto flex min-h-svh w-full max-w-2xl flex-col items-center justify-center gap-10 px-5 py-16 text-center"
        >
          <p aria-hidden className="nf-code">
            404
          </p>
          <div className="flex flex-col items-center gap-3">
            <h1 className="font-display text-display-md">Такой страницы нет</h1>
            <p className="max-w-md leading-relaxed text-dim">Ссылка битая или страницу убрали. Бывает.</p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- клиентского роутера здесь нет */}
            <a href="/" className="btn-ember px-6 py-3">
              На главную
            </a>
          </div>
          <div lang="en" className="flex flex-col items-center gap-3">
            <h2 className="font-display text-display-sm">Page not found</h2>
            <p className="max-w-md leading-relaxed text-dim">The link is broken or the page is gone. It happens.</p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- клиентского роутера здесь нет */}
            <a href="/en" className="btn-glass">
              Go to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
