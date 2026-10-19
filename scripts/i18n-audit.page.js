/*
 * Код, который scripts/i18n-audit.ts исполняет внутри страницы.
 *
 * Отдельным файлом и обычным JS: скрипт читает его как текст и отдаёт в
 * page.evaluate строкой. Функцией из .ts его передать нельзя — tsx (esbuild с
 * keepNames) оборачивает именованные функции в __name(...), а в браузере
 * этого помощника нет.
 *
 * Возвращает { found, overflowPage, culprits, links, lang } — форму Harvest
 * из scripts/i18n-audit.ts.
 */
(() => {
  const CYR = /[А-Яа-яЁё]/
  const out = []

  // Ближайший lang вверх по дереву, кроме самого <html>: lang="ru" на куске —
  // это честно помеченный чужой текст (название, ник, русские данные)
  const markedOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const l = n.getAttribute('lang')
      if (l) return l.toLowerCase().startsWith('ru') && n !== document.documentElement
    }
    return false
  }

  const describe = (el) => {
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''
    return el.tagName.toLowerCase() + id + cls
  }

  // Текст — по текстовым узлам, а не innerText целиком: так у каждой находки
  // есть элемент, а у элемента — lang
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent || '').trim()
    if (!t || !CYR.test(t)) continue
    const el = n.parentElement
    if (!el) continue
    const tag = el.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue
    const cs = getComputedStyle(el)
    const hidden = cs.display === 'none' || cs.visibility === 'hidden'
    // sr-only и живые области скрыты глазу, но слышны скринридеру — тоже текст
    if (hidden && !el.closest('[aria-live],.sr-only')) continue
    out.push({ text: t.slice(0, 160), marked: markedOf(el), where: describe(el) })
  }

  // Атрибуты, которые читают вслух или показывают
  const ATTRS = ['aria-label', 'title', 'alt', 'placeholder', 'aria-description']
  for (const el of Array.from(document.querySelectorAll('[aria-label],[title],[alt],[placeholder],[aria-description]'))) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a)
      if (v && CYR.test(v)) out.push({ text: a + '="' + v.slice(0, 140) + '"', marked: markedOf(el), where: describe(el) })
    }
  }

  // Голова: вкладка и то, что покажет мессенджер
  if (CYR.test(document.title)) out.push({ text: '<title>' + document.title, marked: false, where: 'head' })
  for (const m of Array.from(document.querySelectorAll('meta[name="description"],meta[property^="og:"],meta[name^="twitter:"]'))) {
    const v = m.getAttribute('content') || ''
    if (CYR.test(v)) {
      out.push({ text: (m.getAttribute('name') || m.getAttribute('property')) + '="' + v.slice(0, 140) + '"', marked: false, where: 'head' })
    }
  }

  // Вылезшее за правый край: сама страница и до пяти виновников
  const vw = window.innerWidth
  const overflowPage = document.documentElement.scrollWidth > vw + 1
  const culprits = []
  if (overflowPage) {
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
        culprits.push(describe(el) + ' right=' + Math.round(r.right) + ' «' + (el.textContent || '').trim().slice(0, 40) + '»')
        if (culprits.length >= 5) break
      }
    }
  }

  // Ссылки с hreflang — переключатель языка: он и обязан вести на другой язык
  const links = Array.from(document.querySelectorAll('a[href]:not([hreflang])')).map((a) => a.getAttribute('href') || '')
  return { found: out, overflowPage, culprits, links, lang: document.documentElement.lang }
})()
