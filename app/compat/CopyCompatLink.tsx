'use client'

import { useState } from 'react'

/**
 * className и label — необязательные, со старыми значениями по умолчанию.
 *
 * На хабе это единственная кнопка и она главная, а на странице результата стоит
 * рядом с «Собрать пати вместе»: две ember-заливки подряд означали бы, что
 * действия равнозначны, хотя это не так.
 */
export function CopyCompatLink({
  steamid,
  className = 'rounded-[14px] bg-ember text-on-ember font-semibold py-3 hover:brightness-110 transition cursor-pointer',
  label = 'Скопировать мою ссылку',
}: {
  steamid: string
  className?: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/compat/${steamid}` : ''

  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className={className}
    >
      {copied ? 'Скопировано ✓' : label}
    </button>
  )
}
