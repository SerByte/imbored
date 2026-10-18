import { useLocale } from '@/components/LocaleProvider'
import { track } from '@/lib/track'

/**
 * «ГДЕ ВЗЯТЬ?» — ПОДСКАЗКА У ПОЛЯ ССЫЛКИ НА ПРОФИЛЬ.
 *
 * Поле просит «ссылку, ник или код друга», и ни одна строка на главной не
 * говорила, откуда их взять. Ссылку на свой профиль человек обычно не знает
 * наизусть, а ник в поле он понимает как имя, которое видит в Steam, — и
 * получает badinput: по отображаемому имени Steam не ищет (ERROR_TEXT в
 * ConnectCard). Подсказка отвечает до ошибки, а не после неё.
 *
 * Закрыта по умолчанию, и кнопка стоит В СТРОКЕ ПОЛЯ, а не строкой под ним —
 * как «Забыли?» у поля пароля. Это не вкус, а бюджет высоты: у гостевой
 * карточки на телефоне до потолка CONNECT_CARD_MIN_H три пикселя (241 из
 * 244), и любая новая строка сдвинула бы первый экран в момент подмены
 * фолбэка. Раскрытая панель карточку растит — но уже по нажатию, когда
 * человек сам попросил. Раскладка строки — .join-field в globals.css.
 *
 * Шаги описывают чужой интерфейс, который меняется без предупреждения, —
 * поэтому они здесь одни на обе ветки карточки (ProfileForm у гостя и у
 * вошедшего), как шаги приватности в PrivacyHelp.
 *
 * Хуков, кроме языка страницы (useLocale), нет: раскрыта ли панель, держит
 * ProfileForm, а здесь разметка и решение, что делает нажатие
 * (toggleLinkHelp), — и то и другое проверяется в тесте без браузера.
 *
 * Английские шаги называют пункты клиента Steam так, как их пишет сам
 * клиент по-английски: «Profile», «Copy Page URL», «Add a Friend».
 */

/** Панель подсказки: на неё указывает aria-controls кнопки */
export const LINK_HELP_ID = 'profile-link-help'

/**
 * Кнопка «Где взять?» в строке поля.
 *
 * Глазом — «Где взять?», а имя — «Где взять ссылку?»: целиком фраза на
 * телефоне отняла бы у плейсхолдера больше, чем у него есть. Там, где тесно
 * даже так (узкий или низкий экран — счёт у .join-field в globals.css), слово
 * .join-help-word прячется, и от кнопки виден один «?». Имя от этого не
 * меняется, и «Где взять» в нём остаётся для голосового ввода.
 *
 * По-английски имя по той же причине начинается словами с кнопки: «Where’s
 * that link?», а не «Where do I find my link?». Голосовой ввод ищет кнопку по
 * тому, что видно глазом (WCAG 2.5.3), и на «click Where’s that» второе имя
 * не находилось.
 *
 * min-w-10 — чтобы одинокий «?» оставался целью для пальца, а не полоской в
 * семь пикселей; на тач-экране .tap добирает зону до 44 — но только наружу, к
 * краю пилюли (.tap-flush-start): слева вплотную поле, и штатные 6 px зоны
 * легли бы на его последние пиксели, куда ставят каретку в конец вставленной
 * ссылки. Правый отступ поля ужат до 4 — зона съела бы его целиком.
 */
export function LinkHelpToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const en = useLocale() === 'en'
  return (
    <button
      type="button"
      aria-label={en ? 'Where’s that link?' : 'Где взять ссылку?'}
      aria-expanded={open}
      aria-controls={LINK_HELP_ID}
      onClick={onToggle}
      className="tap tap-flush-start min-w-10 shrink-0 self-stretch rounded-[11px] px-1.5 text-xs font-semibold text-dim transition-colors hover:text-ink aria-expanded:text-ink"
    >
      <span className="join-help-word">{en ? 'Where’s that' : 'Где взять'}</span>?
    </button>
  )
}

/**
 * Свой профиль — без знания своего ника: steamcommunity.com/my Steam сам
 * переадресует на профиль того, кто вошёл в этом браузере, и в строке адреса
 * остаётся ровно та ссылка, что нужна полю. Тот же приём, что у ссылки на
 * настройки приватности в PrivacyHelp.
 */
const MY_PROFILE_URL = 'https://steamcommunity.com/my'

/**
 * Панель с шагами. В разметке всегда, закрытая — через hidden: aria-controls
 * обязан указывать на существующий элемент, а display: none не занимает во
 * флекс-колонке карточки ни строки, ни зазора gap.
 *
 * Шаги клиента Steam — для компьютера: правого клика и меню страницы на
 * телефоне нет. А главную открывают вечером как раз с телефона, поэтому у
 * него своя строка — через браузер. Код для друзей годится везде.
 */
export function LinkHelp({ open }: { open: boolean }) {
  if (useLocale() === 'en') {
    return (
      <div id={LINK_HELP_ID} hidden={!open} className="anim-rise text-sm leading-relaxed text-dim">
        <ol className="list-decimal list-inside space-y-1">
          <li>
            In Steam on your computer: your name at the top → <span className="text-ink">“Profile”</span>
          </li>
          <li>
            Right-click the page → <span className="text-ink">“Copy Page URL”</span> — and paste it here
          </li>
        </ol>
        <p className="mt-2">
          On a phone: open{' '}
          <a
            href={MY_PROFILE_URL}
            target="_blank"
            rel="noreferrer"
            className="tap tap-tight text-ember-text hover:underline"
          >
            steamcommunity.com/my
          </a>{' '}
          — Steam will show your profile — and copy the address from the browser bar.
        </p>
        <p className="mt-2">Or use your friend code — it’s in Steam: “Friends” → “Add a Friend”.</p>
        <p className="mt-1">A custom URL is the part after /id/ in the link: Steam doesn’t search by profile name.</p>
      </div>
    )
  }
  return (
    <div id={LINK_HELP_ID} hidden={!open} className="anim-rise text-sm leading-relaxed text-dim">
      <ol className="list-decimal list-inside space-y-1">
        <li>
          В Steam на компьютере: твой ник вверху → <span className="text-ink">«Профиль»</span>
        </li>
        <li>
          Правый клик по странице → <span className="text-ink">«Скопировать адрес страницы»</span> — и
          вставь сюда
        </li>
      </ol>
      <p className="mt-2">
        С телефона: открой{' '}
        <a
          href={MY_PROFILE_URL}
          target="_blank"
          rel="noreferrer"
          className="tap tap-tight text-ember-text hover:underline"
        >
          steamcommunity.com/my
        </a>{' '}
        — Steam покажет твой профиль — и скопируй адрес из строки браузера.
      </p>
      <p className="mt-2">
        Или код для друзей — он написан в Steam: «Друзья» → «Добавить друга».
      </p>
      <p className="mt-1">Ник — тот, что в ссылке после /id/: по имени в профиле Steam не ищет.</p>
    </div>
  )
}

/** Раскрытие уже посчитано в этом документе */
let counted = false

/**
 * Нажатие на «Где взять?»: отдаёт новое состояние панели и считает, если это
 * раскрытие.
 *
 * Только раскрытие, не закрытие: закрыть — значит дочитать, а вопрос воронки —
 * скольким понадобилась подсказка. И раз за документ, а не на каждое нажатие:
 * открыть, закрыть и открыть снова — это один человек, которому не хватило
 * подсказки. Поле «Сменить библиотеку» у вошедшего монтируется заново при
 * каждом раскрытии, поэтому метка живёт в модуле, а не в состоянии формы.
 *
 * Решение здесь, а не в обработчике формы, — чтобы тест проверял его вызовом,
 * а не регэкспом по исходнику.
 */
export function toggleLinkHelp(open: boolean): boolean {
  if (!open && !counted) {
    counted = true
    track('link_help_open')
  }
  return !open
}
