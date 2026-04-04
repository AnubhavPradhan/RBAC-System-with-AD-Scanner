import React, { createContext, useContext, useState, useEffect } from 'react'
import api from '../utils/api'

const AuthContext = createContext(null)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('rbac-token')
    if (!token) {
      setLoading(false)
      return
    }
    // Fetch fresh user+permissions from server on every startup
    api.get('/auth/me')
      .then(({ data }) => {
        const stored = localStorage.getItem('rbac-current-user')
        const storedUser = stored ? JSON.parse(stored) : {}
        // Always prefer server-returned permissions; fall back to stored if server omits them
        const freshUser = {
          ...storedUser,
          ...data,
          permissions: (Array.isArray(data.permissions) ? data.permissions : null)
                       ?? storedUser.permissions
                       ?? []
        }
        localStorage.setItem('rbac-current-user', JSON.stringify(freshUser))
        setCurrentUser(freshUser)
      })
      .catch(() => {
        // Token expired or invalid — clear session
        localStorage.removeItem('rbac-token')
        localStorage.removeItem('rbac-current-user')
        setCurrentUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = async (emailOrUsername, password) => {
    try {
      const { data } = await api.post('/auth/login', { email: emailOrUsername, password })
      localStorage.setItem('rbac-token', data.token)
      localStorage.setItem('rbac-current-user', JSON.stringify(data.user))
      setCurrentUser(data.user)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.response?.data?.detail || err.response?.data?.error || 'Login failed' }
    }
  }

  const signup = async (userData) => {
    try {
      const { data } = await api.post('/auth/signup', userData)
      localStorage.setItem('rbac-token', data.token)
      localStorage.setItem('rbac-current-user', JSON.stringify(data.user))
      setCurrentUser(data.user)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.response?.data?.detail || err.response?.data?.error || 'Signup failed' }
    }
  }

  const logout = async () => {
    try { await api.post('/auth/logout') } catch (_) {}
    localStorage.removeItem('rbac-token')
    localStorage.removeItem('rbac-current-user')
    setCurrentUser(null)
  }

  const hasPermission = (permissionName) => {
    if (!currentUser) return false
    if (currentUser.role === 'Admin') return true
    const perms = currentUser.permissions
    if (!Array.isArray(perms)) return false
    return perms.includes(permissionName)
  }

  const value = { currentUser, login, signup, logout, hasPermission, loading }

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  )
}
