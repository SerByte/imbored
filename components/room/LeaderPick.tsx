import { GameArt } from '@/components/GameArt'
import { useLocale } from '@/components/LocaleProvider'
import { StatusLine } from '@/components/StatusLine'
import { tr } from '@/lib/i18n'
import type { LeaderOffer } from '@/lib/roomlikes'

/**
 * «Берём «X»? 3 из 4 за» — выход из тупика «все отсвайпали и ни разу не
 * совпали».
 *
 * Название здесь есть, в отличие от «Вы почти совпали» (NearMissList): там
 * игра ещё идёт, и название — спойлер развязки, а сюда попадают, только когда
 * карт не осталось ни у кого (pickLeader в lib/roomlikes). Имён нет и тут:
 * кто за, кто против, не видно никому, даже хосту, — только счёт.
 *
 * Нажать может любой участник: правило выбрало игру само, кнопка его только
 * подтверждает (см. app/api/room/[id]/leader).
 *
 * Язык — из контекста (useLocale): рисует блок только клиентский экран
 * ожидания (RoomWaiting), и пропом язык ехал бы через него ради одной строки.
 */
export function LeaderPick({
  leader,
  taking,
  miss,
  onTake,
}: {
  leader: LeaderOffer
  taking: boolean
  /** 'stale' — голоса сдвинулись, пока нажимали; 'failed' — сеть или сервер */
  miss: 'stale' | 'failed' | null
  onTake: () => void
}) {
  const locale = useLocale()
  return (
    <section className="relative panel-lift p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-4 anim-rise">
      <GameArt
        appid={leader.appid}
        name={leader.name}
        headerImage={leader.headerImage}
        art={leader.art}
        sizes="(min-width: 640px) 184px, 100vw"
        className="w-full sm:w-[184px] shrink-0 aspect-[460/215] object-cover rounded-(--radius-card) border border-edge"
      />
      <div className="flex flex-col gap-2 text-center sm:text-left">
        <h3 className="font-semibold">
          {locale === 'en' ? `Go with “${leader.name}”?` : <>Берём «{leader.name}»?</>}
        </h3>
        {locale === 'en' ? (
          <p className="text-sm text-dim">
            <span className="tabular-nums text-ember-text">{leader.forCount}</span> of{' '}
            <span className="tabular-nums text-ember-text">{leader.memberCount}</span> said yes.
            Not everyone, but nobody has cards left — and no one can see who voted for what.
          </p>
        ) : (
          <p className="text-sm text-dim">
            <span className="tabular-nums text-ember-text">{leader.forCount}</span> из{' '}
            <span className="tabular-nums text-ember-text">{leader.memberCount}</span> за.
            Не все, но карт больше нет ни у кого — а кто за что голосовал, не видно никому.
          </p>
        )}
        {/* aria-disabled, а не disabled: на отказе кнопка остаётся, и строка
            под ней зовёт «нажми ещё раз» — фокус обязан быть на ней, а не в
            body. Повтор гасит onTake (takeLeader — по takingLeader) */}
        <button
          type="button"
          onClick={onTake}
          aria-disabled={taking}
          className="btn-ember px-6 py-3 self-center sm:self-start"
        >
          {taking
            ? tr(locale, { ru: 'Берём…', en: 'Going with it…' })
            : tr(locale, { ru: 'Берём', en: 'Go with it' })}
        </button>
        {/* Строка стоит всегда, пустой: takeLeader сбрасывает прежний отказ,
            и новый приходит изменением текста — такое скринридер объявит */}
        <StatusLine
          text={
            miss === 'stale'
              ? tr(locale, {
                  ru: 'Голоса сдвинулись — предложение пересчитано.',
                  en: 'The votes shifted — the top pick was updated.',
                })
              : miss === 'failed'
                ? tr(locale, {
                    ru: 'Не дошло — проверь связь и нажми ещё раз.',
                    en: "Didn't go through — check your connection and tap again.",
                  })
                : null
          }
          className="text-sm text-danger"
        />
      </div>
    </section>
  )
}
