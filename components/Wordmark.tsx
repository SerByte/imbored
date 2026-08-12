export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight select-none ${className}`}>
      <span className="text-ink">im</span>
      <span className="text-dim line-through decoration-ember/70 decoration-2">bored</span>
    </span>
  )
}
