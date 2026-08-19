/**
 * Кино-фон главной: три колонки артов известных игр медленно дрейфуют
 * под тёмным скримом. Арт — главный цвет бренда; UI остаётся тихим.
 */

import { legacyArtUrl } from '@/lib/art'

const COLLAGE_APPIDS = [
  [1245620, 1091500, 292030, 1086940, 632470, 753640],
  [1145360, 548430, 367520, 504230, 588650, 427520],
  [570, 730, 413150, 105600, 892970, 646570],
]

// Список зафиксирован и состоит из давних игр, у которых плоский путь ещё живой,
// поэтому здесь хватает шаблона без резолва — но хост общий, из lib/art.
export function CinemaCollage() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      <div
        className="absolute -inset-x-16 -inset-y-24 grid grid-cols-1 md:grid-cols-3 gap-4 opacity-40"
        style={{ transform: 'rotate(-6deg) scale(1.18)' }}
      >
        {/*
          На телефоне остаётся одна колонка, и это про трафик, а не про вёрстку.

          Восемнадцать обложек — 945 КБ. Ленивыми из них было пятнадцать, и
          на десктопе это работает: нижние кадры лежат за экраном. На узком
          же экране колонка целиком помещается в видимую область, а дрейф
          дополнительно прогоняет через неё каждую плитку — то есть ленивая
          загрузка отменяется сама собой и приезжают все восемнадцать.

          Две скрытые колонки уходят в display:none, и их ЛЕНИВЫЕ картинки не
          грузятся никогда: в кадр они не попадают по определению. Поэтому у
          них не остаётся ни одной eager — иначе display:none загрузку бы не
          отменил.
        */}
        {COLLAGE_APPIDS.map((column, i) => (
          <div
            key={i}
            className={`${i % 2 === 0 ? 'anim-drift-up' : 'anim-drift-down'}${i > 0 ? ' hidden md:block' : ''}`}
          >
            <div className="flex flex-col gap-4">
              {[...column, ...column].map((appid, j) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${appid}-${j}`}
                  src={legacyArtUrl(appid, 'header')}
                  alt=""
                  // Раньше здесь стояло j < 6, то есть eager на 18 обложек:
                  // три колонки по шесть. Все они лежат под скримом, который в
                  // центре непрозрачен на 94%, и при этом соревновались за
                  // полосу с тем, ради чего человек пришёл. Сверху колонки
                  // видно ровно один кадр — он и остаётся eager.
                  //
                  // Только в первой колонке: остальные две скрыты на телефоне,
                  // и eager внутри display:none — это загрузка ради ничего.
                  loading={i === 0 && j === 0 ? 'eager' : 'lazy'}
                  // Фон не должен опережать содержание ни при каких условиях.
                  fetchPriority="low"
                  decoding="async"
                  className="w-full rounded-[14px] object-cover aspect-[460/215]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* скрим: контент читается, арт дышит по краям */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(70% 65% at 50% 45%, rgba(11,12,16,0.94) 30%, rgba(11,12,16,0.72) 60%, rgba(11,12,16,0.45) 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(11,12,16,0.85), transparent 30%, transparent 70%, #0b0c10 100%)',
        }}
      />
    </div>
  )
}
