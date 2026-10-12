'use client'

import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { Icon } from '@/components/Icon'
import { MUTES, muteStore, muteSummary, unkeyDeal, type MuteKey } from '@/lib/mutetags'

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
 */
export function MuteTags() {
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
        <span className="truncate">{mutes.length ? `Не предлагать: ${muteSummary(mutes)}` : 'Чего не предлагать'}</span>
        <Icon name={open ? 'up' : 'down'} size={14} />
      </button>
      {open && (
        <div id={id} className="flex flex-col items-center gap-3">
          {/* Имя группы — тот же вопрос, что на свёрнутой строке: фокус на
              чипсе без него читался бы голым «Хорроры, переключатель» */}
          <div role="group" aria-label="Не предлагать" className="flex flex-wrap justify-center gap-2">
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
                {p.label}
              </button>
            ))}
          </div>
          <p className="max-w-md text-xs leading-relaxed text-faint">
            По тегам Steam: игра уходит из подбора, игры дня и «Полистать», если такой тег среди её
            главных. Помнит этот браузер, выход стирает.
          </p>
        </div>
      )}
    </div>
  )
}
