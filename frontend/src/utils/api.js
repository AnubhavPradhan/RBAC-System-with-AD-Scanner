import axios from 'axios'
import { showAppPopup } from './popup'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rbac-token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Redirect to login on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('rbac-token')
      localStorage.removeItem('rbac-current-user')
      window.location.href = '/login'
    }
    if (error.response?.status === 403) {
      const detail = String(error.response?.data?.detail || error.response?.data?.error || '')
      if (detail.toLowerCase().includes('time-based policy')) {
        localStorage.removeItem('rbac-token')
        localStorage.removeItem('rbac-current-user')
        showAppPopup('Access denied: your account is outside the allowed Nepal time window.', true)
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api
