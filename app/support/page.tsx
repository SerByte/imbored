import Link from 'next/link'
import { Ambient } from '@/components/Ambient'
import { LogoMark } from '@/components/Logo'

export const metadata = { title: 'Поддержать' }

/**
 * Отсюда убран перк «Большие пати — комнаты больше чем на 4 человека».
 * Лимита участников в коде нет вообще: ни в joinRoom, ни в роуте /join, ни в
 * схеме. То есть перк продавал снятие ограничения, которого не существует, —
 * на странице, где двумя блоками ниже написано «рекомендация не продаётся».
 *
 * Цена оттуда же убрана: называть сумму за то, чего нет и что не начато,
 * — обещание, которое некому выполнить. Вернуть можно будет тогда, когда
 * появится что ограничивать.
 */
const PERKS = [
  { title: 'Безлимит ИИ-объяснений', desc: 'Перегенерация подборок и pros/cons без ограничений' },
  { title: 'Wrapped раньше всех', desc: 'Итоги года — первым, с эксклюзивной карточкой' },
  { title: 'Свои вайб-пресеты', desc: 'Собери собственные «после работы» и «пятницы»' },
]

export default function SupportPage() {
  const donateUrl = process.env.NEXT_PUBLIC_DONATE_URL

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto w-full max-w-xl px-5 pt-28 pb-16 flex flex-col gap-8">
        <div className="text-center flex flex-col items-center gap-4 anim-reveal">
          <LogoMark size={48} happy />
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            imbored бесплатен. И останется таким.
          </h1>
          <p className="text-dim leading-relaxed max-w-md">
            Подбор, пати, совместимость и портрет — бесплатны навсегда, без рекламы в выдаче и без
            проданных рекомендаций. Если сервис попадает в твои вечера — можно поддержать.
          </p>
        </div>

        <div className="glass rounded-[20px] p-6 flex flex-col gap-3 anim-rise">
          <h2 className="font-bold">Поддержать рублём</h2>
          <p className="text-sm text-dim">
            Донат — это спасибо, а не подписка. Ничего не блокируется.
          </p>
          {donateUrl ? (
            <a
              href={donateUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-[14px] bg-ember text-on-ember font-semibold py-3 text-center hover:brightness-110 transition"
            >
              Поддержать проект
            </a>
          ) : (
            /*
              Строка, а не бокс, и не про «запуск».
              
              Стояло «Ссылка на донат появится после запуска imbored.cc» — на
              запущенном imbored.cc. Проверено на живом сайте: NEXT_PUBLIC_DONATE_URL
              на проде не задан, и эту фразу читает каждый, кто заходит на
              /support. Страница сообщала посетителю, что сайта ещё нет, с самого
              сайта.
              
              Форма тоже врала: rounded-[14px] glass py-3 во всю ширину — это
              ровно силуэт кнопки под настоящей кнопкой доната. Нажать нечего, а
              выглядит нажимаемым. Теперь это подпись под абзацем, чем и является.
              
              Задашь NEXT_PUBLIC_DONATE_URL — здесь встанет настоящая кнопка, и
              вся эта ветка исчезнет сама.
            */
            <p className="text-sm text-faint">
              Ссылка появится здесь — пока сервис держится на энтузиазме.
            </p>
          )}
        </div>

        <div className="glass rounded-[20px] p-6 flex flex-col gap-4 anim-rise" style={{ animationDelay: '80ms' }}>
          <div className="flex items-baseline justify-between">
            <h2 className="font-bold">
              imbored<span className="text-ember-text">+</span>
            </h2>
            <span className="text-xs text-dim font-mono">когда-нибудь</span>
          </div>
          <p className="text-sm text-dim -mt-2">
            Для тех, кто хочет больше удовольствия — база остаётся бесплатной.
          </p>
          <ul className="flex flex-col gap-2.5">
            {PERKS.map((p) => (
              <li key={p.title} className="flex gap-3 text-sm">
                <span className="text-ember-text mt-0.5">+</span>
                <div>
                  <span className="font-semibold">{p.title}</span>
                  <span className="text-dim"> — {p.desc}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-faint text-center">
          Принцип-табу: мы никогда не продаём места в выдаче. Рекомендация — это доверие,
          а доверие не продаётся.
        </p>

        <div className="text-center">
          <Link href="/quiz" className="text-sm text-dim hover:text-ink transition-colors">
            ← К подбору игры
          </Link>
        </div>
      </div>
    </div>
  )
}
