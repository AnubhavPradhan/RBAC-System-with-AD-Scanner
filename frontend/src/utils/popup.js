const POPUP_EVENT = 'rbac:popup'
const PENDING_KEY = 'rbac-popup-message'

export const showAppPopup = (message, persist = false) => {
  if (!message) return
  if (persist) {
    localStorage.setItem(PENDING_KEY, message)
  }
  window.dispatchEvent(new CustomEvent(POPUP_EVENT, { detail: { message } }))
}

export const consumePendingPopup = () => {
  const message = localStorage.getItem(PENDING_KEY)
  if (message) {
    localStorage.removeItem(PENDING_KEY)
  }
  return message
}

export { POPUP_EVENT }
