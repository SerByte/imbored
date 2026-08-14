'use client'

import { useState } from 'react'

export function CopyCompatLink({ steamid }: { steamid: string }) {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/compat/${steamid}` : ''

  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="rounded-[14px] bg-ember text-on-ember font-semibold py-3 hover:brightness-110 transition cursor-pointer"
    >
      {copied ? 'Скопировано ✓' : 'Скопировать мою ссылку'}
    </button>
  )
}
