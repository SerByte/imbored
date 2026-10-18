import type { Metadata } from 'next'
import Link from '@/components/Link'
import { redirect } from 'next/navigation'
import { Ambient } from '@/components/Ambient'
import { ShareLinkField } from '@/components/ShareLink'
import { verdict } from '@/lib/compat'
import { nameOf } from '@/lib/compatpage'
import { COMPAT_VIEW_TTL_SEC, listCompatViews } from '@/lib/db'
import { bounceTo, steamLoginFor } from '@/lib/destination'
import { freshness } from '@/lib/freshness'
import { lp, toLocale, tr } from '@/lib/i18n'
import { appBaseUrl, currentSession, getDb, isDemoId, isWriter, nowSec } from '@/lib/server'
import { Eyebrow } from '@/components/Labels'
import { Icon } from '@/components/Icon'
import { withRef } from '@/lib/track'
import { COMPAT_SHARE } from './sharecopy'

/** Вкладка и описание — на языке адреса; набор полей прежний: страница личная, её не индексируют */
export async function generateMetadata(props: PageProps<'/[lang]/compat'>): Promise<Metadata> {
  const locale = toLocale((await props.params).lang)
  return {
    title: tr(locale, { ru: 'Совместимость', en: 'Compatibility' }),
    description: tr(locale, {
      ru: 'Процент совпадения игровых вкусов по реальным библиотекам и часам — и во что вам зайти вместе.',
      en: 'Your taste match, based on real libraries and playtime — and what to play together.',
    }),
  }
}

export const dynamic = 'force-dynamic'

/**
 * Страница про ссылку, на которой ссылки не было видно.
 *
 * Раньше здесь стояла центрированная стеклянная карточка с абзацем и одной
 * кнопкой «Скопировать мою ссылку» — то есть предмет, ради передачи которого
 * сюда и приходят, был невидим. Нельзя было ни убедиться, что отправляешь
 * своё, ни выделить адрес руками, если буфер закрыт настройками браузера, ни
 * понять, что вообще увидит адресат.
 *
 * Теперь страница построена как передача из рук в руки: сам адрес, действие
 * над ним и то, во что он развернётся в чате. Превью — не украшение: карточку
 * рисует opengraph-image.tsx этого же маршрута, то есть здесь показан ровно
 * тот файл, который заберёт мессенджер, а не его имитация.
 *
 * Стеклянной карточки по центру экрана больше нет намеренно: в неё же одеты
 * 404 и экран ошибки, и три совершенно разных экрана выглядели одним.
 */
export default async function CompatHubPage(props: PageProps<'/[lang]/compat'>) {
  const locale = toLocale((await props.params).lang)
  const session = await currentSession()
  // Лендинг — на языке страницы: гость с /en/compat попадает на /en?next=…
  if (!session) redirect(lp(locale, bounceTo('/compat')))
  const { steamid } = session
  /*
   * «Сравнили с тобой» — только подтверждённому входу не из демо. Ссылка на
   * профиль не доказывает, что профиль твой: без этого условия вставивший
   * чужую ссылку увидел бы, кто сравнивался с её владельцем.
   */
  const canSee = isWriter(session) && !isDemoId(steamid)
  const now = nowSec()
  const views = canSee ? await listCompatViews(await getDb(), steamid, now - COMPAT_VIEW_TTL_SEC) : []

  // Адрес собирается на сервере: поле обязано приехать заполненным с первым
  // кадром, а не мигнуть пустым в ожидании гидратации. На языке страницы:
  // друг, которому кинули ссылку с /en/compat, открывает английскую.
  const url = withRef(`${appBaseUrl()}${lp(locale, `/compat/${steamid}`)}`, 'compat')
  const share = COMPAT_SHARE[locale]

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-28 pb-16">
        <div className="flex flex-col gap-3 anim-rise">
          <Eyebrow>{tr(locale, { ru: 'Совместимость', en: 'Compatibility' })}</Eyebrow>
          <h1 className="font-display text-display-md">
            {tr(locale, { ru: 'Твоя ссылка на сравнение', en: 'Your compatibility link' })}
          </h1>
          {/* Неразрывность — только у русского «по-настоящему»: дефис рвал
              слово на краю строки. В английской фразе такого слова нет */}
          {locale === 'en' ? (
            <p className="text-dim leading-relaxed">
              Send it to anyone — we&apos;ll compare your libraries and playtime for real, not with a quiz:
              your taste match, the games you have in common and what to play together.
            </p>
          ) : (
            <p className="text-dim leading-relaxed">
              Кинь её любому — сервис сравнит ваши библиотеки и наигранное время{' '}
              <span className="whitespace-nowrap">по-настоящему</span>, а не по анкете: процент
              совпадения вкусов, общие игры и во что вам зайти вместе.
            </p>
          )}
        </div>

        <div className="anim-rise" style={{ animationDelay: '80ms' }}>
          <ShareLinkField
            what="compat"
            url={url}
            label={tr(locale, { ru: 'Твоя ссылка на сравнение совместимости', en: 'Your compatibility link' })}
            title={share.title}
            text={share.text}
          />
        </div>

        {views.length > 0 && (
          <section
            aria-labelledby="compat-views"
            className="flex flex-col gap-3 anim-rise"
            style={{ animationDelay: '120ms' }}
          >
            <Eyebrow>
              <span id="compat-views">{tr(locale, { ru: 'Сравнили с тобой', en: 'Compared with you' })}</span>
            </Eyebrow>
            <ul className="flex flex-col gap-2">
              {views.map((v) => (
                <li key={v.steamid}>
                  {/* Открыть сравнение в ответ — тот же процент: он симметричен */}
                  <Link
                    href={`/compat/${v.steamid}`}
                    prefetch={false}
                    className="panel-lift tap flex items-center gap-4 px-4 py-3"
                  >
                    <span className="font-display text-display-xs shrink-0 tabular-nums text-ember-text">{v.percent}%</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{nameOf(v.steamid, v.name, locale)}</span>
                      <span className="block truncate text-xs text-dim">
                        {verdict(v.percent, locale)} · {freshness(v.at, now, locale)}
                      </span>
                    </span>
                    <Icon name="arrow" size={16} className="shrink-0 text-dim" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Вход возвращает сюда же и на том же языке: steamLoginFor берёт его
            из пути (/en/compat → lang=en). Ссылка в английской фразе стоит
            на своём месте, поэтому фраза — своей разметкой, а не склейкой */}
        {!canSee &&
          !isDemoId(steamid) &&
          (locale === 'en' ? (
            <p className="text-sm text-dim anim-rise">
              You&apos;ll see who compared with you once you{' '}
              <a href={steamLoginFor(lp(locale, '/compat'))} className="tap tap-tight text-ember-text hover:underline">
                sign in with Steam
              </a>
              : a profile link doesn&apos;t prove the profile is yours.
            </p>
          ) : (
            <p className="text-sm text-dim anim-rise">
              Кто с тобой сравнился — видно после{' '}
              <a href={steamLoginFor('/compat')} className="tap tap-tight text-ember-text hover:underline">
                входа через Steam
              </a>
              : ссылка на профиль не доказывает, что он твой.
            </p>
          ))}

        <div className="flex flex-col gap-3 anim-rise" style={{ animationDelay: '160ms' }}>
          <Eyebrow tone="faint">{tr(locale, { ru: 'Так она развернётся в чате', en: 'How it looks in a chat' })}</Eyebrow>
          {/*
            Настоящий файл карточки, а не картинка-заглушка: тот же адрес
            заберёт краулер мессенджера. Пропорция задана атрибутами, чтобы
            место под неё было занято до загрузки и страница не дёргалась.
            Адрес — на языке страницы: английская ссылка разворачивается
            английской карточкой, и показать надо её.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lp(locale, `/compat/${steamid}/opengraph-image`)}
            width={1200}
            height={630}
            alt={tr(locale, {
              ru: 'Превью карточки: приглашение сравнить библиотеки',
              en: 'Card preview: an invitation to compare libraries',
            })}
            className="w-full rounded-(--radius-panel) border border-edge"
          />
          {/* Обещание дословно правдиво: процент у открывшего — сразу, у тебя —
              здесь, в «Сравнили с тобой», если он вошёл через Steam. Демо и
              вход по ссылке этого списка не видят — им обещана только первая
              половина */}
          <p className="text-sm text-faint">
            {canSee
              ? tr(locale, {
                  ru: 'Он откроет ссылку, войдёт через Steam — и процент увидите оба: он сразу, ты — здесь.',
                  en: 'They open the link and sign in with Steam — then you both see the percentage: they see it right away, you see it here.',
                })
              : tr(locale, {
                  ru: 'Он откроет ссылку, войдёт через Steam — и сразу увидит ваш процент.',
                  en: 'They open the link, sign in with Steam and see your percentage right away.',
                })}
          </p>
        </div>

        <div>
          <Link href="/quiz" className="tap link-more">
            <Icon name="arrow" size={16} className="rotate-180" />
            {tr(locale, { ru: 'К подбору игры', en: 'Find a game' })}
          </Link>
        </div>
      </div>
    </div>
  )
}
