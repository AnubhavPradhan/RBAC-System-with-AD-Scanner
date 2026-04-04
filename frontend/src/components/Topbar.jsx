import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, Filter, Shield } from 'lucide-react'
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

  const handleClearNotifications = () => {
    setItems([])
    setUnreadCount(0)
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[#2a2a2a]" style={{ backgroundColor: 'var(--app-sidebar-color)' }}>
      <div className="w-full px-6 py-3 flex items-center justify-between">
        <div className="text-2xl font-bold text-white flex items-center gap-2.5">
          <Shield className="w-7 h-7 text-white" />
          <span>RBAC & AD Scanner</span>
        </div>

        <div className="flex items-center gap-3" ref={panelRef}>
          {isAdmin && (
            <div className="relative">
              <button
                onClick={() => setOpen((v) => !v)}
                className="relative p-2 text-white/90 hover:text-white transition-colors"
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
                <div className="absolute right-0 mt-2 w-[430px] max-w-[90vw] rounded-2xl border border-[#2a2a2a] bg-[#1f1f1f] shadow-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#2a2a2a] flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">AD Notifications</p>
                    <button
                      onClick={handleClearNotifications}
                      disabled={items.length === 0}
                      className="text-xs font-medium text-gray-300 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Clear Notifications
                    </button>
                  </div>

                  <div className="px-4 py-3 border-b border-[#2a2a2a] flex items-center gap-2">
                    <Filter className="w-4 h-4 text-[#9aa9c7]" />
                    <select
                      value={objectFilter}
                      onChange={(e) => setObjectFilter(e.target.value)}
                      className="bg-[#323232] border border-[#3a3a3a] rounded-lg px-2 py-1 text-xs text-gray-200"
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
                      className="bg-[#323232] border border-[#3a3a3a] rounded-lg px-2 py-1 text-xs text-gray-200\"
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
                      <div className="px-4 py-5 text-sm text-gray-400">No matching notifications.</div>
                    ) : (
                      filteredItems.map((item, idx) => (
                        <div key={`${item.timestamp}-${item.name}-${idx}`} className="px-4 py-3 border-b border-[#2a2a2a] last:border-b-0">
                          <p className="text-sm text-gray-200">
                            <span className="font-semibold capitalize">{item.object_type}</span>{' '}
                            <span className="font-semibold">{item.name}</span>{' '}
                            was <span className="font-semibold">{item.action}</span>
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            Source: {item.source} · By: {item.changed_by}
                          </p>
                          <p className="text-[11px] text-gray-500 mt-1">
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

          <div className="relative min-w-0">
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2.5 rounded-xl px-2 py-1 hover:bg-white/5 transition-colors"
              title="Account menu"
            >
              <div className="w-10 h-10 rounded-full bg-[#d8d8c8] text-[#222] flex items-center justify-center font-semibold text-[17px] flex-shrink-0">
                {currentUser?.name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <div className="min-w-0 text-left leading-tight">
                <p className="text-[14px] font-semibold text-white truncate">{currentUser?.name || 'User'}</p>
                <p className="text-[12px] text-gray-400 truncate mt-0.5">{currentUser?.role || '-'}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-200 flex-shrink-0" />
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-52 rounded-xl border border-[#3a3a3a] bg-[#1f1f1f] shadow-2xl overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-[#2a2a2a]">
                  <p className="text-sm font-semibold text-white truncate">{currentUser?.name || 'User'}</p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{currentUser?.role || '-'}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2a2a2a] transition-colors"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

export default Topbar
