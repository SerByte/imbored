/** Тихий ambient-фон для утилитарных экранов — единый по всему приложению */
export function Ambient() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          'radial-gradient(55% 40% at 50% 0%, rgba(255,158,100,0.07), transparent 70%), radial-gradient(40% 35% at 80% 90%, rgba(100,140,255,0.05), transparent 70%)',
      }}
    />
  )
}
