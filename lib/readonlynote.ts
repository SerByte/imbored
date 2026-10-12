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
 *
 * ФЛАЖОК — СО ВРЕМЕНЕМ, А НЕ «1». Два шага значат, что флажок может
 * пережить свой документ: чанк тела не доехал (моргнула сеть, деплой сменил
 * хеш), и флажок ждёт следующей попытки. А sessionStorage вкладки переживает
 * многое — и уход на steamcommunity.com со входом через Steam, и
 * восстановленную назавтра вкладку. Сообщение «ты только что вошёл по
 * ссылке» через час — уже не новость, и флажок старше READONLY_NOTE_TTL_MS
 * считается снятым. Правду о том, вошёл ли человек с тех пор через Steam,
 * говорит не флажок, а признак записи: его сверяет тело записки
 * (noteVerdict в components/ReadOnlyNoteBox).
 */
const KEY = 'imbored.readonly-note'
export const READONLY_NOTE_EVENT = 'imbored:readonly-note'

/**
 * Сколько флажок ждёт показа. Обычно он забран через круг до сервера за
 * чанком; десять минут — запас на повтор после отказа чанка в том же заходе.
 */
export const READONLY_NOTE_TTL_MS = 10 * 60 * 1000

export function announceReadOnly(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()))
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
 *
 * Протухший, битый или из будущего (часы перевели назад) — не стоит, и
 * стирается здесь же: показывать его некому и незачем.
 */
export function peekReadOnlyNote(): boolean {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw === null) return false
    const age = Date.now() - Number(raw)
    if (age >= 0 && age <= READONLY_NOTE_TTL_MS) return true
    sessionStorage.removeItem(KEY)
    return false
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
