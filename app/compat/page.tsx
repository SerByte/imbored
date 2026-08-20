import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Ambient } from '@/components/Ambient'
import { ShareLinkField } from '@/components/ShareLink'
import { appBaseUrl, currentSteamId } from '@/lib/server'

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
  const steamid = await currentSteamId()
  if (!steamid) redirect('/')

  // Адрес собирается на сервере: поле обязано приехать заполненным с первым
  // кадром, а не мигнуть пустым в ожидании гидратации.
  const url = `${appBaseUrl()}/compat/${steamid}`

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-28 pb-16">
        <div className="flex flex-col gap-3 anim-rise">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ember-text">
            Совместимость
          </p>
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

        <div className="flex flex-col gap-3 anim-rise" style={{ animationDelay: '160ms' }}>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-faint">
            Так она развернётся в чате
          </p>
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
            className="w-full rounded-[20px] border border-edge"
          />
          <p className="text-sm text-faint">
            Он откроет ссылку, подключит свою библиотеку — и процент увидите оба.
          </p>
        </div>

        <div>
          <Link href="/quiz" className="tap text-sm text-dim hover:text-ink transition-colors">
            ← К подбору игры
          </Link>
        </div>
      </div>
    </div>
  )
}
