/**
 * Кино-фон главной: три колонки артов известных игр медленно дрейфуют
 * под тёмным скримом. Арт — главный цвет бренда; UI остаётся тихим.
 */

const COLLAGE_APPIDS = [
  [1245620, 1091500, 292030, 1086940, 632470, 753640],
  [1145360, 548430, 367520, 504230, 588650, 427520],
  [570, 730, 413150, 105600, 892970, 646570],
]

function headerUrl(appid: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
}

export function CinemaCollage() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      <div
        className="absolute -inset-x-16 -inset-y-24 grid grid-cols-3 gap-4 opacity-40"
        style={{ transform: 'rotate(-6deg) scale(1.18)' }}
      >
        {COLLAGE_APPIDS.map((column, i) => (
          <div key={i} className={i % 2 === 0 ? 'anim-drift-up' : 'anim-drift-down'}>
            <div className="flex flex-col gap-4">
              {[...column, ...column].map((appid, j) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${appid}-${j}`}
                  src={headerUrl(appid)}
                  alt=""
                  loading={j < 6 ? 'eager' : 'lazy'}
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
