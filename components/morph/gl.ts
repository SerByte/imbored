/**
 * Проба WebGL для мест, где показывается MorphSlider.
 *
 * Живёт отдельным модулем не ради экономии строк, а ради кэша: обещание
 * «пробный контекст создаётся ровно раз на вкладку» держится на модульной
 * переменной, и вторая копия функции превратила бы его в неправду — каждый
 * потребитель создавал бы свой канвас.
 *
 * Не в lib/ намеренно: там нет ни одного обращения к document, а тесты
 * проекта гоняются в окружении node, где такую пробу не проверить.
 */

/** Ответ на всю вкладку один: пробный контекст создаётся ровно раз */
let webglProbe: boolean | null = null

/** Есть ли вообще WebGL: без контекста слайдер покажет пустоту, а не картинки */
export function webglAvailable(): boolean {
  if (webglProbe === null) {
    try {
      const canvas = document.createElement('canvas')
      webglProbe = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
    } catch {
      webglProbe = false
    }
  }
  return webglProbe
}
