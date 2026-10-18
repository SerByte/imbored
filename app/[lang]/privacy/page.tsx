import type { Metadata, ResolvingMetadata } from 'next'
import Link from '@/components/Link'
import { Ambient } from '@/components/Ambient'
import { Eyebrow, MetaLine } from '@/components/Labels'
import { toLocale } from '@/lib/i18n'
import { ownAddress } from '@/lib/site'
import { Icon } from '@/components/Icon'
import { COPY, type PolicyCopy } from './page.copy'

/**
 * title и description — на языке страницы, адрес и картинка — тем же
 * ownAddress, что у остальных страниц без своей карточки (lib/social.test.ts).
 * Язык — из params: страница статическая, по одной копии на язык.
 */
export async function generateMetadata(
  props: PageProps<'/[lang]/privacy'>,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { meta } = COPY[toLocale((await props.params).lang)]
  return ownAddress('/privacy', { title: meta.title, description: meta.description })(props, parent)
}

/**
 * ПОЛИТИКА, КОТОРУЮ МОЖНО ПРОЧИТАТЬ ГЛАЗАМИ, А НЕ ЮРИСТОМ.
 *
 * Эта страница была единственной в продукте без дизайна: восемь одинаковых
 * разделов, тысяча слов подряд и весь корпус, набранный в --dim. То есть
 * роль «вторичный текст» была назначена ОСНОВНОМУ содержимому страницы, а
 * акцентом служили три случайных <span className="text-ink"> внутри абзацев.
 * Иерархия была вывернута наизнанку: по умолчанию приглушено всё, выделено —
 * что попало.
 *
 * Важнее оформления то, зачем сюда приходят. Ссылка на политику стоит ровно
 * под кнопкой входа через Steam — то есть её открывают в момент сомнения, с
 * одним конкретным вопросом: «пароль-то они видят?», «а удалить можно?».
 * Прежняя страница отвечала на такой вопрос третьим предложением третьего
 * абзаца нужного раздела, который ещё надо было найти. Юридически полно и
 * практически бесполезно.
 *
 * Отсюда три решения, и все три — про структуру, а не про красоту.
 *
 * 1. ЧИТАЕМ / НЕ ЧИТАЕМ. Прежний текст честно перечислял, что сервис берёт,
 *    и НИ РАЗУ не собирал вместе то, чего он не берёт: про пароль сказано в
 *    первом разделе, про рекламные трекеры — в седьмом, про непередачу
 *    персональных данных вовне — в четвёртом. А убеждает именно вторая
 *    колонка. Теперь она существует как один объект и стоит выше всего
 *    текста. Списки сверены с кодом, а не написаны по памяти: сервис ходит
 *    в Steam ровно за GetOwnedGames, GetPlayerSummaries, ResolveVanityURL и
 *    GetWishlist (lib/steam.ts) — ни друзей, ни покупок, ни достижений там нет.
 *
 *    Маркер несёт смысл сам: залитая точка — взяли, полая — не берём.
 *    Присутствие против пустоты, без иконок и без цвета «тревога».
 *
 * 2. ОТВЕТ ПЕРВОЙ СТРОКОЙ. У каждого раздела теперь есть ответ и есть
 *    механика. Ответ набран основным цветом, механика — вторичным. Читающий
 *    по диагонали получает всю политику из восьми строк; читающий подробно
 *    не теряет ни одного прежнего слова — юридический текст сохранён
 *    целиком, к нему только приписан вывод.
 *
 *    Кегль у ответа и у механики ОДИН. Соблазн уменьшить подробности до
 *    text-sm был, и он же ровно то, чем плохи чужие политики: мелкий шрифт
 *    внизу страницы. Иерархия здесь держится на цвете и весе — на том, что
 *    не мешает читать.
 *
 * 3. НУМЕРАЦИЯ В ПОЛЯХ. Восемь разделов без номеров — восемь равных
 *    заголовков, между которыми глазу не за что зацепиться при прокрутке.
 *    Колонка номеров даёт странице позвоночник и делает разделы называемыми
 *    вслух («пункт 6 — про удаление»), что для документа важнее, чем для
 *    любого другого экрана продукта.
 *
 * Слова — в page.copy.tsx, по объекту на язык: здесь только вёрстка, одна на
 * оба. Английский читатель получает ту же иерархию, те же восемь номеров и
 * тот же «читаем / не читаем» над текстом.
 */

function Ledger({ copy }: { copy: PolicyCopy }) {
  return (
    <section
      aria-labelledby="ledger-title"
      className="panel-lift p-6 anim-rise"
      style={{ animationDelay: '60ms' }}
    >
      <h2 id="ledger-title" className="sr-only">
        {copy.ledgerTitle}
      </h2>
      <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
        <div className="flex flex-col gap-3">
          <Eyebrow as="h3">{copy.readsTitle}</Eyebrow>
          <ul className="flex flex-col gap-2.5 leading-snug">
            {copy.reads.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full bg-ember" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3 border-t border-edge pt-6 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-8">
          <Eyebrow as="h3" tone="faint">{copy.skipsTitle}</Eyebrow>
          <ul className="flex flex-col gap-2.5 leading-snug text-dim">
            {copy.skips.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-[7px] size-2 shrink-0 rounded-full border border-faint"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function Section({
  n,
  title,
  answer,
  children,
}: {
  n: string
  title: string
  answer: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section className="grid grid-cols-[1.75rem_1fr] items-baseline gap-x-3 gap-y-2 sm:grid-cols-[2.5rem_1fr]">
      {/* Номер — указатель, а не содержание: экранный диктор читает заголовок. */}
      <MetaLine tone="faint" aria-hidden className="tabular-nums">
        {n}
      </MetaLine>
      <h2 className="font-display text-display-xs">{title}</h2>
      <p className="col-start-2 font-medium leading-relaxed">{answer}</p>
      {children && (
        <div className="col-start-2 flex flex-col gap-2 leading-relaxed text-dim">{children}</div>
      )}
    </section>
  )
}

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

export default async function PrivacyPage({ params }: PageProps<'/[lang]/privacy'>) {
  const copy = COPY[toLocale((await params).lang)]
  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-10 px-5 pt-28 pb-16">
        <header className="flex flex-col gap-3 anim-reveal">
          <Eyebrow tone="faint">{copy.eyebrow}</Eyebrow>
          <h1 className="font-display text-display-md">{copy.h1}</h1>
          <p className="leading-relaxed">{copy.lead}</p>
          <MetaLine tone="faint">
            {copy.updatedLead}
            {copy.updated}
          </MetaLine>
        </header>

        <Ledger copy={copy} />

        <div className="flex flex-col gap-8">
          {copy.sections.map((s) => (
            <Section key={s.n} n={s.n} title={s.title} answer={s.answer}>
              {s.body}
            </Section>
          ))}
        </div>

        <div className="text-center">
          <Link href="/" className="tap link-more">
            <Icon name="arrow" size={16} className="rotate-180" />
            {copy.home}
          </Link>
        </div>
      </div>
    </div>
  )
}
