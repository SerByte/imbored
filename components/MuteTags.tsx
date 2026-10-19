'use client'

import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { Icon } from '@/components/Icon'
import { useLocale } from '@/components/LocaleProvider'
import { tr } from '@/lib/i18n'
import { MUTES, muteLabel, muteStore, muteSummary, unkeyDeal, type MuteKey } from '@/lib/mutetags'

/**
 * «Не предлагать: хорроры, VR, ранний доступ…» — на квизе (lib/mutetags.ts).
 *
 * Здесь, а не на /play: квиз — дверь в каждую выдачу («Изменить настроение»
 * с /play, «Обычный подбор» с /daily, «Подобрать под настроение» с /explore —
 * туда же ведут и их экраны «Всё под «Не предлагать»»), а /play стоит у потолка
 * бюджета первой загрузки (bundle-budget.json), и ряд из девяти чипсов он бы
 * не вместил.
 *
 * Свёрнуто по умолчанию: квиз задаёт три вопроса про сегодняшний вечер, а
 * это — про человека вообще, и девять чипсов над ответами спорили бы с ними.
 * Свёрнутая строка сама говорит, что фильтр стоит: «Не предлагать: хорроры,
 * VR», — молча урезанная выдача читалась бы бедностью каталога.
 *
 * Нажатие пишет сразу, без «Сохранить»: чипс — сам себе ответ, как ось
 * «хочется» на /play. И гасит ключ выдачи на устройстве (unkeyDeal): «Назад»
 * не вернёт пятёрку, собранную до фильтра.
 *
 * Язык — из контекста страницы (useLocale): подписи чипсов и сводка — через
 * muteLabel / muteSummary, а MUTES даёт только ключи и порядок.
 */
export function MuteTags() {
  const locale = useLocale()
  const mutes = useSyncExternalStore(muteStore.subscribe, muteStore.get, muteStore.server)
  const [open, setOpen] = useState(false)
  const id = useId()

  // Год — с последнего захода сюда, а не с выбора: кто фильтр поставил и
  // ходит в подбор, не должен через год обнаружить хорроры молча вернувшимися
  useEffect(() => {
    const now = muteStore.get()
    if (now.length) muteStore.set(now.map((p) => p.key))
  }, [])

  function toggle(key: MuteKey) {
    const keys = mutes.map((p) => p.key)
    muteStore.set(keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key])
    unkeyDeal()
  }

  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="tap inline-flex max-w-full items-center gap-1.5 text-xs text-faint transition-colors hover:text-ink"
      >
        <span className="truncate">
          {mutes.length
            ? tr(locale, {
                ru: `Не предлагать: ${muteSummary(mutes)}`,
                en: `Don't suggest: ${muteSummary(mutes, locale)}`,
              })
            : tr(locale, { ru: 'Чего не предлагать', en: 'What not to suggest' })}
        </span>
        <Icon name={open ? 'up' : 'down'} size={14} />
      </button>
      {/* В разметке всегда, свёрнутое — через hidden: aria-controls кнопки
          обязан указывать на существующий элемент (тот же приём, что у
          components/landing/LinkHelp), а display: none не занимает во
          флекс-колонке квиза ни строки, ни зазора */}
      <div id={id} hidden={!open} className="flex flex-col items-center gap-3">
        {/* Имя группы — тот же вопрос, что на свёрнутой строке: фокус на
            чипсе без него читался бы голым «Хорроры, переключатель» */}
        <div
          role="group"
          aria-label={tr(locale, { ru: 'Не предлагать', en: "Don't suggest" })}
          className="flex flex-wrap justify-center gap-2"
        >
          {MUTES.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={mutes.includes(p)}
              onClick={() => toggle(p.key)}
              /* 44 px — стандарт продукта (докблок .tap). У ярлыков выше
                 их добирает иконка при py-3, у этих чипсов иконки нет —
                 замер дал 41, поэтому высота задана прямо. Зазор gap-2
                 настоящий, и .tap со своей вылезающей зоной здесь не нужен */
              className="pill min-h-11 py-3"
            >
              {muteLabel(p.key, locale)}
            </button>
          ))}
        </div>
        <p className="max-w-md text-xs leading-relaxed text-faint">
          {tr(locale, {
            ru: 'По тегам Steam: игра уходит из подбора, игры дня и «Полистать», если такой тег среди её главных. Помнит этот браузер, выход стирает.',
            en: 'By Steam tags: a game drops out of your picks, the game of the day and Browse if the tag is one of its main ones. Saved in this browser; signing out clears it.',
          })}
        </p>
      </div>
    </div>
  )
}
