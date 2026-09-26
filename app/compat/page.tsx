import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Ambient } from '@/components/Ambient'
import { ShareLinkField } from '@/components/ShareLink'
import { verdict } from '@/lib/compat'
import { nameOf } from '@/lib/compatpage'
import { COMPAT_VIEW_TTL_SEC, listCompatViews } from '@/lib/db'
import { bounceTo, steamLoginFor } from '@/lib/destination'
import { freshness } from '@/lib/freshness'
import { appBaseUrl, currentSession, getDb, isDemoId, isWriter, nowSec } from '@/lib/server'
import { Eyebrow } from '@/components/Labels'
import { Icon } from '@/components/Icon'
import { withRef } from '@/lib/track'

export const metadata = {
  title: 'Совместимость',
  description: 'Процент совпадения игровых вкусов по реальным библиотекам и часам — и во что вам зайти вместе.',
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
export default async function CompatHubPage() {
  const session = await currentSession()
  if (!session) redirect(bounceTo('/compat'))
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
  // кадром, а не мигнуть пустым в ожидании гидратации.
  const url = withRef(`${appBaseUrl()}/compat/${steamid}`, 'compat')

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-28 pb-16">
        <div className="flex flex-col gap-3 anim-rise">
          <Eyebrow>Совместимость</Eyebrow>
          <h1 className="font-display text-display-md">Твоя ссылка на сравнение</h1>
          <p className="text-dim leading-relaxed">
            Кинь её любому — сервис сравнит ваши библиотеки и наигранное время по-настоящему, а не
            по анкете: процент совпадения вкусов, общие игры и во что вам зайти вместе.
          </p>
        </div>

        <div className="anim-rise" style={{ animationDelay: '80ms' }}>
          <ShareLinkField
            url={url}
            label="Твоя ссылка на сравнение совместимости"
            title="Совместимость вкусов — imbored"
            text="Сравним библиотеки Steam по-настоящему, а не по анкете"
          />
        </div>

        {views.length > 0 && (
          <section
            aria-labelledby="compat-views"
            className="flex flex-col gap-3 anim-rise"
            style={{ animationDelay: '120ms' }}
          >
            <Eyebrow>
              <span id="compat-views">Сравнили с тобой</span>
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
                      <span className="block truncate font-bold">{nameOf(v.steamid, v.name)}</span>
                      <span className="block truncate text-xs text-dim">
                        {verdict(v.percent)} · {freshness(v.at, now)}
                      </span>
                    </span>
                    <Icon name="arrow" size={16} className="shrink-0 text-dim" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!canSee && !isDemoId(steamid) && (
          <p className="text-sm text-dim anim-rise">
            Кто с тобой сравнился — видно после{' '}
            <a href={steamLoginFor('/compat')} className="tap tap-tight text-ember-text hover:underline">
              входа через Steam
            </a>
            : ссылка на профиль не доказывает, что он твой.
          </p>
        )}

        <div className="flex flex-col gap-3 anim-rise" style={{ animationDelay: '160ms' }}>
          <Eyebrow tone="faint">Так она развернётся в чате</Eyebrow>
          {/*
            Настоящий файл карточки, а не картинка-заглушка: тот же адрес
            заберёт краулер мессенджера. Пропорция задана атрибутами, чтобы
            место под неё было занято до загрузки и страница не дёргалась.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/compat/${steamid}/opengraph-image`}
            width={1200}
            height={630}
            alt="Превью карточки: приглашение сравнить библиотеки"
            className="w-full rounded-(--radius-panel) border border-edge"
          />
          {/* Обещание дословно правдиво: процент у открывшего — сразу, у тебя —
              здесь, в «Сравнили с тобой», если он вошёл через Steam */}
          <p className="text-sm text-faint">
            Он откроет ссылку, войдёт через Steam — и процент увидите оба: он сразу, ты — здесь.
          </p>
        </div>

        <div>
          <Link href="/quiz" className="tap link-more">
            <Icon name="arrow" size={16} className="rotate-180" />
            К подбору игры
          </Link>
        </div>
      </div>
    </div>
  )
}
