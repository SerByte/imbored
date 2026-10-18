import { use } from 'react'
import Link from '@/components/Link'
import { Ambient } from '@/components/Ambient'
import { LogoMark } from '@/components/Logo'
import { toLocale, type Locale } from '@/lib/i18n'
import { ownAddress } from '@/lib/site'
import { Icon } from '@/components/Icon'

/*
 * Адрес страницы — canonical, og:url и корневая карточка. Свои заголовок и
 * описание на языке страницы — в ./layout.tsx: ownAddress принимает их одним
 * объектом без языка.
 */
export const generateMetadata = ownAddress('/support')

/**
 * Текст страницы на обоих языках.
 *
 * Принцип внизу — та же фраза, что в сцене денег на главной (глоссарий:
 * «We don't sell spots in our picks. A recommendation is trust, and trust
 * isn't for sale.»); на неё ссылается и components/TagChips.tsx как на
 * обещание продукта. Неразрывные пробелы — как в русском: строка на телефоне
 * не начинается с тире и не кончается предлогом (по-английски — артиклем «A»).
 */
const COPY = {
  ru: {
    title: 'imbored бесплатен. И\u00a0останется таким.',
    lede: 'Подбор, пати, совместимость, портрет и итоги года — бесплатны навсегда, без рекламы в выдаче и без проданных рекомендаций. Если сервис попадает в твои вечера — можно поддержать.',
    donateTitle: 'Поддержать рублём',
    donateLead: 'Донат — это спасибо, а не подписка.',
    donateNote: 'За него ничего не открывается: платного в сервисе нет.',
    donateButton: 'Поддержать проект',
    howTitle: 'Как поддержать',
    howLead: 'Денег сервис пока не принимает: реквизитов нет, и живёт он без них.',
    howWrite:
      'Лучшее «спасибо» сейчас — рассказать о нём тому, кому он пригодится. А если подбор промахнулся или что-то сломалось, напиши на',
    rule: 'Принцип-табу: мы никогда не продаём места в\u00a0выдаче. Рекомендация\u00a0— это доверие, а\u00a0доверие не продаётся.',
    back: 'К подбору игры',
  },
  en: {
    title: 'imbored is free. And it’ll stay that\u00a0way.',
    lede: 'Picks, parties, compatibility, the portrait and the year in review are free forever — no ads in the picks and no paid recommendations. If imbored has become part of your evenings, you can support it.',
    donateTitle: 'Support with a donation',
    donateLead: 'A donation is a thank-you, not a subscription.',
    donateNote: 'It doesn’t unlock anything: nothing here is paid.',
    donateButton: 'Support the project',
    howTitle: 'How to support us',
    howLead: 'We don’t take money yet: there’s no way to pay, and the service runs without it.',
    howWrite:
      'The best thank-you right now is telling someone who’d find it useful. And if a pick missed or something broke, write to',
    rule: 'Our hard rule: we don’t sell spots in our picks. A\u00a0recommendation is trust, and trust isn’t for\u00a0sale.',
    back: 'Find a game',
  },
} satisfies Record<Locale, Record<string, string>>

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

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

/**
 * Язык — из params через use(), а не await: страница остаётся синхронной, и
 * её тест рендерит её вызовом без params — тогда она русская, как была.
 */
export default function SupportPage({ params }: Partial<PageProps<'/[lang]/support'>> = {}) {
  const t = COPY[params ? toLocale(use(params).lang) : 'ru']
  const donateUrl = donateHref(process.env.NEXT_PUBLIC_DONATE_URL)

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto w-full max-w-xl px-5 pt-28 pb-16 flex flex-col gap-8">
        <div className="text-center flex flex-col items-center gap-4 anim-reveal">
          <LogoMark size={48} happy />
          <h1 className="font-display text-display-md">{t.title}</h1>
          <p className="text-dim leading-relaxed max-w-md">{t.lede}</p>
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
            <h2 className="font-display text-display-xs">{t.donateTitle}</h2>
            <p className="font-medium leading-relaxed">{t.donateLead}</p>
            <p className="text-dim leading-relaxed">{t.donateNote}</p>
            <a
              href={donateUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ember is-block py-3 text-center"
            >
              {t.donateButton}
            </a>
          </div>
        ) : (
          <div className="panel-lift p-6 flex flex-col gap-3 anim-rise">
            <h2 className="font-display text-display-xs">{t.howTitle}</h2>
            <p className="font-medium leading-relaxed">{t.howLead}</p>
            <p className="text-dim leading-relaxed">
              {t.howWrite}{' '}
              <a href="mailto:hello@imbored.cc" className="tap text-ember-text hover:underline">
                hello@imbored.cc
              </a>
              .
            </p>
          </div>
        )}

        <p className="text-xs text-faint text-center">{t.rule}</p>

        <div className="text-center">
          <Link href="/quiz" className="tap link-more">
            <Icon name="arrow" size={16} className="rotate-180" />
            {t.back}
          </Link>
        </div>
      </div>
    </div>
  )
}
