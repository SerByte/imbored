import { GameArt } from '@/components/GameArt'
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
        <h3 className="font-semibold">Берём «{leader.name}»?</h3>
        <p className="text-sm text-dim">
          <span className="tabular-nums text-ember-text">{leader.forCount}</span> из{' '}
          <span className="tabular-nums text-ember-text">{leader.memberCount}</span> за.
          Не все, но карт больше нет ни у кого — а кто за что голосовал, не видно никому.
        </p>
        <button
          type="button"
          onClick={onTake}
          disabled={taking}
          className="btn-ember px-6 py-3 self-center sm:self-start"
        >
          {taking ? 'Берём…' : 'Берём'}
        </button>
        {miss && (
          <p role="status" className="text-sm text-danger">
            {miss === 'stale'
              ? 'Голоса сдвинулись — предложение пересчитано.'
              : 'Не дошло — проверь связь и нажми ещё раз.'}
          </p>
        )}
      </div>
    </section>
  )
}
