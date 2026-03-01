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
    const storedUser = localStorage.getItem('rbac-current-user')
    if (token && storedUser) {
      setCurrentUser(JSON.parse(storedUser))
    }
    setLoading(false)
  }, [])

  const login = async (emailOrUsername, password) => {
    try {
      const { data } = await api.post('/auth/login', { email: emailOrUsername, password })
      localStorage.setItem('rbac-token', data.token)
      localStorage.setItem('rbac-current-user', JSON.stringify(data.user))
      setCurrentUser(data.user)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.response?.data?.error || 'Login failed' }
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
      return { success: false, error: err.response?.data?.error || 'Signup failed' }
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
    return currentUser.permissions?.includes(permissionName) || false
  }

  const value = { currentUser, login, signup, logout, hasPermission, loading }

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  )
}
