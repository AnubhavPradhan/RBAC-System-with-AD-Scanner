import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ProtectedRoute = ({ children, requiredPermission }) => {
  const { currentUser, hasPermission } = useAuth()

  // Not logged in
  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  // Check if specific permission is required
  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <span className="text-6xl mb-4 block">🚫</span>
          <h1 className="text-5xl font-bold text-gray-800 mb-3">Access Denied</h1>
          <p className="text-2xl text-gray-600">You don't have permission to access this page.</p>
        </div>
      </div>
    )
  }

  return children
}

export default ProtectedRoute
