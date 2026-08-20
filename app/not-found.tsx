import Link from 'next/link'
import { Ambient } from '@/components/Ambient'
import { LogoMark } from '@/components/Logo'

/**
 * 404 в языке продукта. Раньше notFound() из /game/[appid] проваливался
 * в стоковую страницу Next — единственный экран без нашей вёрстки.
 */
export default function NotFound() {
  return (
    <div className="relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden">
      <Ambient />
      <div className="relative max-w-md w-full text-center flex flex-col items-center gap-5 anim-reveal">
        <LogoMark size={48} />
        <h1 className="font-display text-display-md">Такой страницы нет</h1>
        <p className="text-dim leading-relaxed">
          Ссылка битая или игру убрали из каталога. Бывает — зато есть, во что поиграть.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/quiz"
            className="rounded-[14px] bg-ember text-on-ember font-semibold px-6 py-3 hover:brightness-110 transition"
          >
            Подобрать игру
          </Link>
          <Link href="/" className="rounded-[14px] glass glass-hover px-6 py-3 text-sm">
            На главную
          </Link>
        </div>
      </div>
    </div>
  )
}
