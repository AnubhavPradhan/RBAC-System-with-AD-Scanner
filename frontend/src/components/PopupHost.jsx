import React, { useEffect, useState } from 'react'
import { POPUP_EVENT, consumePendingPopup } from '../utils/popup'

const PopupHost = () => {
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onPopup = (event) => {
      const text = String(event?.detail?.message || '').trim()
      if (text) setMessage(text)
    }

    window.addEventListener(POPUP_EVENT, onPopup)
    const pending = consumePendingPopup()
    if (pending) setMessage(pending)

    return () => window.removeEventListener(POPUP_EVENT, onPopup)
  }, [])

  if (!message) return null

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-2xl" style={{ backgroundColor: 'var(--app-surface-color)', borderColor: 'var(--app-border-color)' }}>
        <h3 className="text-xl font-semibold text-white mb-3">Access Notice</h3>
        <p className="text-[#d8deea] leading-relaxed mb-6">{message}</p>
        <div className="flex justify-end">
          <button
            onClick={() => setMessage('')}
            className="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

export default PopupHost
