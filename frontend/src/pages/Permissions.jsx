import React, { useState, useEffect, useMemo } from 'react'
import { Pencil } from 'lucide-react'
import api from '../utils/api'

const formatPermissionLabel = (name = '') =>
  name
    .split('_')
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === 'ad' ? 'AD' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')

const Permissions = () => {
  const [showModal, setShowModal] = useState(false)
  const [editingPermission, setEditingPermission] = useState(null)
  const [permissions, setPermissions] = useState([])

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'Content Management',
    status: 'Active',
    usedBy: []
  })

  const categories = ['Content Management', 'User Management', 'Analytics', 'System', 'General']

  useEffect(() => {
    fetchPermissions()
  }, [])

  useEffect(() => {
    if (!showModal) return

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setShowModal(false)
      setEditingPermission(null)
      setFormData({ name: '', description: '', category: 'Content Management', status: 'Active', usedBy: [] })
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showModal])

  const fetchPermissions = async () => {
    try {
      const { data } = await api.get('/permissions')
      setPermissions(data)
    } catch (err) {
      console.error('Failed to fetch permissions:', err)
    }
  }

  // Keep a stable list reference for existing selection logic
  const filteredPermissions = useMemo(() => {
    return permissions
  }, [permissions])

  const handleSubmitPermission = async (e) => {
    e.preventDefault()
    try {
      if (editingPermission) {
        const { data } = await api.put(`/permissions/${editingPermission.id}`, formData)
        setPermissions(permissions.map(p => p.id === editingPermission.id ? data : p))
      } else {
        const { data } = await api.post('/permissions', formData)
        setPermissions([...permissions, data])
      }
      setFormData({ name: '', description: '', category: 'Content Management', status: 'Active', usedBy: [] })
      setEditingPermission(null)
      setShowModal(false)
    } catch (err) {
      alert(err.response?.data?.error || 'Operation failed')
    }
  }

  const handleEditPermission = (permission) => {
    setEditingPermission(permission)
    setFormData({
      name: permission.name,
      description: permission.description,
      category: permission.category,
      status: permission.status,
      usedBy: permission.usedBy || []
    })
    setShowModal(true)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Permissions</h1>
        </div>
      </div>

      {/* Permissions List */}
      {filteredPermissions.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No permissions found</h3>
          <p className="text-gray-500 mb-6">No permissions available.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="divide-y divide-gray-200">
            {filteredPermissions.map((permission) => (
                <div key={permission.id} className="p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start">
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-800">{formatPermissionLabel(permission.name)}</h3>
                      </div>
                      <p className="text-gray-600 text-sm mb-3">{permission.description}</p>
                      
                      {/* Used By Section */}
                      {permission.usedBy && permission.usedBy.length > 0 && (
                        <div className="flex items-center space-x-2 text-sm">
                          <span className="text-gray-500 font-medium">Used by:</span>
                          <div className="flex flex-wrap gap-1">
                            {permission.usedBy.map((role, idx) => (
                              <span key={idx} className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs font-medium">
                                {role}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-4 mr-3">
                      <button 
                        onClick={() => handleEditPermission(permission)}
                        className="text-gray-500 hover:text-blue-600 transition-colors"
                        title="Edit permission"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit Permission Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">
              Edit Permission
            </h2>
            
            <form onSubmit={handleSubmitPermission}>
              <div className="mb-5">
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Permission Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                  placeholder="e.g., Create Posts, Delete Users"
                  required
                />
                <p className="text-gray-500 text-xs mt-1">Give your permission a clear, descriptive name</p>
              </div>

              <div className="mb-5">
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Description *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                  rows="3"
                  placeholder="Explain what this permission allows users to do..."
                  required
                />
                <p className="text-gray-500 text-xs mt-1">Provide a detailed explanation to help others understand this permission</p>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingPermission(null)
                    setFormData({ name: '', description: '', category: 'Content Management', status: 'Active', usedBy: [] })
                  }}
                  className="px-6 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-md hover:shadow-lg"
                >
                  Update Permission
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}

export default Permissions
