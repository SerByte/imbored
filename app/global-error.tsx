'use client'

/**
 * Последний рубеж: app/error.tsx рендерится ВНУТРИ корневого layout, поэтому
 * исключение в самом layout (а он на уровне модуля зовёт appBaseUrl(), который
 * теперь умеет бросать) его границу не задевает и уходит на стоковый белый
 * экран Next.
 *
 * Отсюда два следствия, из-за которых файл выглядит непохожим на остальные:
 * global-error обязан отрисовать <html> и <body> сам, и он не может опираться
 * ни на что из сломанного layout — ни на шрифты, ни на токены темы. Поэтому
 * здесь инлайновые стили и захардкоженные цвета, а не классы Tailwind: если
 * упало ровно то, что подключает globals.css, классов на странице не будет.
 *
 * Цвета — значения --bg и --ink тёмной темы, чтобы шов с остальным сайтом не
 * бросался в глаза у тех, кто на ней сидит.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0c10',
          color: '#f2f3f5',
          fontFamily: 'system-ui, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 12px' }}>
            Что-то сломалось
          </h1>
          <p style={{ opacity: 0.7, fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 24px' }}>
            Сломалось глубже обычного — не только страница, но и оболочка вокруг неё. Обычно
            помогает перезагрузка.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#ff9e64',
              color: '#0b0c10',
              border: 0,
              borderRadius: '14px',
              padding: '12px 32px',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Попробовать снова
          </button>
          {error.digest && (
            <div
              style={{
                marginTop: '20px',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                opacity: 0.45,
              }}
            >
              код: {error.digest}
            </div>
          )}
        </div>
      </body>
    </html>
  )
}
