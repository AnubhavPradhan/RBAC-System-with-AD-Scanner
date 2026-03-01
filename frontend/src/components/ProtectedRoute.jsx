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
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Access Denied</h1>
          <p className="text-gray-600">You don't have permission to access this page.</p>
          <p className="text-sm text-gray-500 mt-2">Required permission: {requiredPermission}</p>
        </div>
      </div>
    )
  }

  return children
}

export default ProtectedRoute
