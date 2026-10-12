/**
 * Разовая записка после входа по ссылке на профиль.
 *
 * Такой вход — только просмотр (isWriter в lib/server): подбор работает, а
 * оценки, запуски и комнаты не сохраняются. Раньше об этом узнавали, только
 * наткнувшись на спрятанную кнопку. Теперь карточка входа, проведя человека
 * по ссылке, оставляет флажок, а записка (components/ReadOnlyNote) один раз
 * говорит, что это за режим и как получить остальное.
 *
 * sessionStorage: записка нужна в этой вкладке и сразу, а не на следующий
 * визит. Флажок стирается при показе — второй раз не всплывёт. Событие —
 * потому что карточка ведёт дальше клиентским переходом, и записка в
 * корневом лэйауте к этому моменту давно смонтирована.
 *
 * Показ — в два шага: сперва флажок смотрят, не забирая (peekReadOnlyNote),
 * и везут тело записки чанком; забирают (takeReadOnlyNote), только когда
 * тело приехало. Почему — в components/ReadOnlyNote.
 */
const KEY = 'imbored.readonly-note'
export const READONLY_NOTE_EVENT = 'imbored:readonly-note'

export function announceReadOnly(): void {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    // без хранилища записка просто не всплывёт — страница важнее
  }
  try {
    window.dispatchEvent(new Event(READONLY_NOTE_EVENT))
  } catch {
    // см. выше
  }
}

/**
 * Стоит ли флажок — не забирая его. Записку ещё нужно привезти, и чанк, не
 * дошедший по дороге, не должен съесть одноразовое сообщение.
 */
export function peekReadOnlyNote(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Забрать флажок: true — записку пора показать, и больше её не покажут */
export function takeReadOnlyNote(): boolean {
  if (!peekReadOnlyNote()) return false
  try {
    sessionStorage.removeItem(KEY)
    return true
  } catch {
    return false
  }
}
