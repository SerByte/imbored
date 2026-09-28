import Link from 'next/link'
import { Ambient } from '@/components/Ambient'
import { LogoMark } from '@/components/Logo'
import { ownAddress } from '@/lib/site'
import { Icon } from '@/components/Icon'

/*
 * Своё описание: без него /support наследовал описание главной, и поиск
 * получал из карты сайта две страницы с одинаковым сниппетом.
 */
export const generateMetadata = ownAddress('/support', {
  title: 'Поддержать',
  description:
    'imbored бесплатен и без рекламы в выдаче: рекомендации не продаются. Здесь можно поддержать проект, если он попадает в твои вечера.',
})

/*
 * БЛОКА imbored+ ЗДЕСЬ БОЛЬШЕ НЕТ.
 *
 * Первым из него ушёл перк «Большие пати — комнаты больше чем на 4 человека».
 * Лимита участников в коде нет вообще: ни в joinRoom, ни в роуте /join, ни в
 * схеме. То есть перк продавал снятие ограничения, которого не существует, —
 * на странице, где ниже написано «доверие не продаётся». Вместе с ним
 * ушла цена: называть сумму за то, чего нет и что не начато, — обещание,
 * которое некому выполнить.
 *
 * Оставшиеся три перка при сверке с кодом оказались той же ошибкой:
 *
 *   «Безлимит ИИ-объяснений» — лимит, в который можно упереться, это защита
 *   от перебора (RECOMMEND_LIMIT в app/api/recommend/route.ts: двадцать
 *   подборов за десять минут), а суточный бюджет модели (lib/llmcap) общий
 *   на весь сервис. Личного потолка, который снимался бы за деньги, нет.
 *
 *   «Итоги года раньше всех» — итоги года открыты всем и бесплатно, по ссылке
 *   на портрет (/portrait/[steamid]/year). «Раньше всех» не бывает у того,
 *   что никогда не было закрыто.
 *
 *   «Свои вайб-пресеты» — пресеты общие и зашиты в lib/presets.ts, собрать
 *   свой негде. Это не перк, а невзятая задача с ценником.
 *
 * Блок с подписью «когда-нибудь» и пустым списком спорил бы с заголовком
 * «бесплатен. И останется таким», поэтому ушёл целиком. Платное вернётся
 * сюда только вместе с тем, что оно делает, — не раньше. Сторож —
 * app/support/page.test.ts.
 */

/**
 * Адрес доната — только настоящий внешний, иначе его нет.
 *
 * NEXT_PUBLIC_DONATE_URL вписывают руками в панели Vercel, и «boosty.to/imbored»
 * без схемы там выглядит нормальной ссылкой. В href она стала бы
 * относительной: кнопка «Поддержать проект» вела бы на
 * /support/boosty.to/imbored, в 404 собственного сайта — то есть в пустоту,
 * на единственном шаге, где человек уже решил помочь. Такой адрес страница
 * считает незаданным и честно говорит, что реквизитов нет.
 */
function donateHref(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

export default function SupportPage() {
  const donateUrl = donateHref(process.env.NEXT_PUBLIC_DONATE_URL)

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto w-full max-w-xl px-5 pt-28 pb-16 flex flex-col gap-8">
        <div className="text-center flex flex-col items-center gap-4 anim-reveal">
          <LogoMark size={48} happy />
          <h1 className="font-display text-display-md">
            imbored бесплатен. И останется таким.
          </h1>
          <p className="text-dim leading-relaxed max-w-md">
            Подбор, пати, совместимость, портрет и итоги года — бесплатны навсегда, без рекламы в
            выдаче и без проданных рекомендаций. Если сервис попадает в твои вечера — можно
            поддержать.
          </p>
        </div>

        {/*
          Два честных состояния одной панели, и заголовок у каждого свой.

          Раньше здесь стояло «появится после запуска imbored.cc» — и висело
          на запущенном imbored.cc, споря само с собой на странице, которая
          просит доверия. Потом строку заменили на «Реквизитов пока нет», но
          над ней остался заголовок «Поддержать рублём»: страница обещала
          способ и следующей же строкой говорила, что его нет. Сюда приходят
          из подвала по ссылке «Поддержать проект», то есть уже решив помочь,
          — и получали отказ вместо ответа.

          Без адреса панель отвечает на тот вопрос, с которым пришли: как
          помочь, если денег сервис не берёт. Ответ набран основным цветом,
          подробности — вторичным, как на /privacy. Никакой кнопки-силуэта
          на месте доната: нажать нечего — значит, и выглядеть нажимаемым
          нечему.

          Задашь NEXT_PUBLIC_DONATE_URL — встанет «Поддержать рублём» с
          настоящей кнопкой, а эта ветка исчезнет сама.
        */}
        {donateUrl ? (
          <div className="panel-lift p-6 flex flex-col gap-3 anim-rise">
            <h2 className="font-display text-display-xs">Поддержать рублём</h2>
            <p className="font-medium leading-relaxed">Донат — это спасибо, а не подписка.</p>
            <p className="text-dim leading-relaxed">
              За него ничего не открывается: платного в сервисе нет.
            </p>
            <a
              href={donateUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ember is-block py-3 text-center"
            >
              Поддержать проект
            </a>
          </div>
        ) : (
          <div className="panel-lift p-6 flex flex-col gap-3 anim-rise">
            <h2 className="font-display text-display-xs">Как поддержать</h2>
            <p className="font-medium leading-relaxed">
              Денег сервис пока не принимает: реквизитов нет, и живёт он без них.
            </p>
            <p className="text-dim leading-relaxed">
              Лучшее «спасибо» сейчас — рассказать о нём тому, кому он пригодится. А если подбор
              промахнулся или что-то сломалось, напиши на{' '}
              <a href="mailto:hello@imbored.cc" className="tap text-ember-text hover:underline">
                hello@imbored.cc
              </a>
              .
            </p>
          </div>
        )}

        <p className="text-xs text-faint text-center">
          Принцип-табу: мы никогда не продаём места в выдаче. Рекомендация — это доверие,
          а доверие не продаётся.
        </p>

        <div className="text-center">
          <Link href="/quiz" className="tap link-more">
            <Icon name="arrow" size={16} className="rotate-180" />
            К подбору игры
          </Link>
        </div>
      </div>
    </div>
  )
}
