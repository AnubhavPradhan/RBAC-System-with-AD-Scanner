import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Filter } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../utils/api'

const OBJECT_FILTERS = ['All', 'user', 'group', 'ou', 'computer']
const ACTION_FILTERS = ['All', 'added', 'edited', 'deleted']

const Topbar = () => {
  const navigate = useNavigate()
  const { currentUser, logout } = useAuth()
  const isAdmin = currentUser?.role === 'Admin'

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [objectFilter, setObjectFilter] = useState('All')
  const [actionFilter, setActionFilter] = useState('All')
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const panelRef = useRef(null)
  const openRef = useRef(false)

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    const onDocClick = (event) => {
      if (!panelRef.current) return
      if (!panelRef.current.contains(event.target)) {
        setOpen(false)
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    if (!isAdmin) return

    const token = localStorage.getItem('rbac-token')
    if (!token) return

    let mounted = true

    const loadRecent = async () => {
      try {
        const { data } = await api.get('/ad-scanner/notifications/recent?limit=30')
        if (!mounted) return
        setItems(Array.isArray(data.items) ? data.items : [])
      } catch (err) {
        console.error('Failed to load AD notifications:', err)
      }
    }

    loadRecent()

    const es = new EventSource(`/api/ad-scanner/notifications/stream?token=${encodeURIComponent(token)}`)

    es.addEventListener('ad-notification', (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (!mounted) return

        setItems((prev) => {
          const key = `${payload.timestamp}-${payload.object_type}-${payload.name}-${payload.action}`
          const exists = prev.some((n) => `${n.timestamp}-${n.object_type}-${n.name}-${n.action}` === key)
          if (exists) return prev
          return [payload, ...prev].slice(0, 60)
        })

        if (!openRef.current) {
          setUnreadCount((count) => count + 1)
        }
      } catch (err) {
        console.error('Notification stream parse error:', err)
      }
    })

    es.onerror = () => {}

    return () => {
      mounted = false
      es.close()
    }
  }, [isAdmin])

  useEffect(() => {
    if (open) {
      setUnreadCount(0)
    }
  }, [open])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const objectOk = objectFilter === 'All' || item.object_type === objectFilter
      const actionOk = actionFilter === 'All' || item.action === actionFilter
      return objectOk && actionOk
    })
  }, [items, objectFilter, actionFilter])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[#2a2f42]" style={{ backgroundColor: 'var(--app-sidebar-color)' }}>
      <div className="w-full px-6 py-4 flex items-center justify-between">
        <div className="text-2xl font-bold text-[#e8efff]">RBAC & AD Scanner</div>

        <div className="flex items-center gap-3" ref={panelRef}>
          {isAdmin && (
            <div className="relative">
              <button
                onClick={() => setOpen((v) => !v)}
                className="relative p-2.5 rounded-xl border border-[#2a2f42] bg-[#16171d] text-white hover:text-white hover:border-[#3d4b70] transition-colors"
                title="AD Notifications"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {open && (
                <div className="absolute right-0 mt-2 w-[430px] max-w-[90vw] rounded-2xl border border-[#2a2f42] bg-[#16171d] shadow-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#2a2f42] flex items-center justify-between">
                    <p className="text-sm font-semibold text-[#e8efff]">AD Notifications</p>
                  </div>

                  <div className="px-4 py-3 border-b border-[#2a2f42] flex items-center gap-2">
                    <Filter className="w-4 h-4 text-[#9aa9c7]" />
                    <select
                      value={objectFilter}
                      onChange={(e) => setObjectFilter(e.target.value)}
                      className="bg-[#23283a] border border-[#2f3b58] rounded-lg px-2 py-1 text-xs text-[#d7e5ff]"
                    >
                      {OBJECT_FILTERS.map((option) => (
                        <option key={option} value={option}>
                          {option === 'All' ? 'All Objects' : option}
                        </option>
                      ))}
                    </select>
                    <select
                      value={actionFilter}
                      onChange={(e) => setActionFilter(e.target.value)}
                      className="bg-[#23283a] border border-[#2f3b58] rounded-lg px-2 py-1 text-xs text-[#d7e5ff]"
                    >
                      {ACTION_FILTERS.map((option) => (
                        <option key={option} value={option}>
                          {option === 'All' ? 'All Actions' : option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="max-h-96 overflow-y-auto">
                    {filteredItems.length === 0 ? (
                      <div className="px-4 py-5 text-sm text-[#9aa9c7]">No matching notifications.</div>
                    ) : (
                      filteredItems.map((item, idx) => (
                        <div key={`${item.timestamp}-${item.name}-${idx}`} className="px-4 py-3 border-b border-[#2a2f42] last:border-b-0">
                          <p className="text-sm text-[#dfe9ff]">
                            <span className="font-semibold capitalize">{item.object_type}</span>{' '}
                            <span className="font-semibold">{item.name}</span>{' '}
                            was <span className="font-semibold">{item.action}</span>
                          </p>
                          <p className="text-xs text-[#8ea2c8] mt-1">
                            Source: {item.source} · By: {item.changed_by}
                          </p>
                          <p className="text-[11px] text-[#7c8ca8] mt-1">
                            {item.timestamp ? new Date(item.timestamp).toLocaleString() : '-'}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center space-x-3 min-w-0">
            <div className="min-w-0 text-right">
              <p className="text-sm font-semibold text-[#e8efff] truncate">{currentUser?.name || 'User'}</p>
              <p className="text-xs text-[#91a1bd] truncate">{currentUser?.role || '-'}</p>
            </div>
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 transition-colors"
                title="Account menu"
              >
                {currentUser?.name?.charAt(0)?.toUpperCase() || 'U'}
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-40 rounded-xl border border-[#2f3b58] bg-[#151926] shadow-2xl overflow-hidden z-50">
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-[#e8efff] hover:bg-[#1d2435] transition-colors"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Topbar
