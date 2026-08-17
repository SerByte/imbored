/**
 * Три тихих голоса квиза. Синтез, без единого файла.
 *
 * По умолчанию ВЫКЛЮЧЕНО. Модуль подгружается динамически из обработчика
 * тумблера, поэтому не включивший звук не качает и байта этого кода.
 *
 * AudioContext создаётся ТОЛЬКО из жеста человека и никогда при загрузке
 * модуля: иначе браузер напишет в консоль «AudioContext was not allowed to
 * start», а контекст останется подвешенным. По той же причине здесь нет
 * прогрева «на всякий случай».
 *
 * Наведение не озвучено НАМЕРЕННО. Семь наведений за один квиз превратили бы
 * жест в механизм — тот же аргумент, по которому залп искр случается ровно
 * один раз за прохождение.
 *
 * Звук — не движение: prefers-reduced-motion его не выключает. Он и так молчит,
 * пока человек сам не попросит.
 */

export type Voice = 'select' | 'relight' | 'outro'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let onVisible: (() => void) | null = null

/** Корни трёх шагов складываются в каденцию, а не в три одинаковых бипа. */
const ROOT_HZ = [220, 261.6, 174.6] as const

/**
 * Зовётся ТОЛЬКО из обработчика жеста. Идемпотентна.
 *
 * resume на возвращении во вкладку обязателен: iOS усыпляет контекст при уходе
 * со вкладки, и звук потом умирает молча — это читается как баг, а не как
 * настройка.
 */
export function armAudio(): void {
  if (typeof window === 'undefined') return
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 1
    master.connect(ctx.destination)

    onVisible = () => {
      if (document.visibilityState === 'visible') void ctx?.resume()
    }
    document.addEventListener('visibilitychange', onVisible)
  }
  void ctx.resume()
}

export function disposeAudio(): void {
  if (onVisible) document.removeEventListener('visibilitychange', onVisible)
  onVisible = null
  void ctx?.close()
  ctx = null
  master = null
}

/** Все узлы создаются на выстрел и отсоединяются сами: постоянных нет. */
function envelope(node: AudioNode, peak: number, attack: number, hold: number, release: number) {
  if (!ctx || !master) return null
  const g = ctx.createGain()
  const t = ctx.currentTime
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + attack)
  g.gain.setValueAtTime(peak, t + attack + hold)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release)
  node.connect(g)
  g.connect(master)
  return g
}

export function play(voice: Voice, step: 0 | 1 | 2 = 0): void {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime

  if (voice === 'select') {
    // Щелчок выбора длиной ровно в такт подтверждения.
    const a = ctx.createOscillator()
    const b = ctx.createOscillator()
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2400
    lp.Q.value = 0.7
    for (const o of [a, b]) {
      o.type = 'triangle'
      o.frequency.setValueAtTime(880, t)
      o.frequency.exponentialRampToValueAtTime(660, t + 0.18)
      o.connect(lp)
    }
    b.detune.value = 7
    envelope(lp, 0.06, 0.006, 0.02, 0.16)
    a.start(t)
    b.start(t)
    a.stop(t + 0.2)
    b.stop(t + 0.2)
    a.onended = () => lp.disconnect()
    return
  }

  if (voice === 'relight') {
    // Развёртка фильтра — звуковой аналог перекраски комнаты.
    const root = ROOT_HZ[step]
    const lo = ctx.createOscillator()
    const hi = ctx.createOscillator()
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 1.2
    lp.frequency.setValueAtTime(300, t)
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.72)
    lo.type = 'sawtooth'
    hi.type = 'sawtooth'
    lo.frequency.value = root
    hi.frequency.value = root * 2
    lo.detune.value = -9
    hi.detune.value = 9
    lo.connect(lp)
    hi.connect(lp)
    envelope(lp, 0.035, 0.12, 0.3, 0.3)
    lo.start(t)
    hi.start(t)
    lo.stop(t + 0.74)
    hi.stop(t + 0.74)
    lo.onended = () => lp.disconnect()
    return
  }

  // Финал: низкий удар плюс короткий шум. Жёсткий stop, чтобы ничего не
  // пережило снос дерева при уходе на выдачу.
  const sub = ctx.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(70, t)
  sub.frequency.exponentialRampToValueAtTime(48, t + 0.4)
  envelope(sub, 0.04, 0.01, 0.08, 0.3)
  sub.start(t)
  sub.stop(t + 0.4)

  const len = Math.floor(ctx.sampleRate * 0.3)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const noise = ctx.createBufferSource()
  noise.buffer = buf
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1800
  bp.Q.value = 0.8
  noise.connect(bp)
  envelope(bp, 0.03, 0.005, 0.05, 0.24)
  noise.start(t)
  noise.stop(t + 0.3)
  noise.onended = () => bp.disconnect()
}
