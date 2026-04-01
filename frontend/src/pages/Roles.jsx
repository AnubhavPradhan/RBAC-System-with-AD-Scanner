import React, { useState, useEffect } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import api from '../utils/api'

const Roles = () => {
  const [showModal, setShowModal] = useState(false)
  const [editingRole, setEditingRole] = useState(null)
  const [roles, setRoles] = useState([])
  const [availablePermissions, setAvailablePermissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [roleToDelete, setRoleToDelete] = useState(null)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissions: []
  })

  useEffect(() => {
    fetchRoles()
    fetchPermissions()
  }, [])

  const fetchRoles = async () => {
    try {
      const { data } = await api.get('/roles')
      setRoles(data)
    } catch (err) {
      console.error('Failed to fetch roles:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchPermissions = async () => {
    try {
      const { data } = await api.get('/permissions')
      setAvailablePermissions(data.map(p => p.name))
    } catch (err) {
      console.error('Failed to fetch permissions:', err)
    }
  }

  const handlePermissionToggle = (permission) => {
    if (formData.permissions.includes(permission)) {
      setFormData({ ...formData, permissions: formData.permissions.filter(p => p !== permission) })
    } else {
      setFormData({ ...formData, permissions: [...formData.permissions, permission] })
    }
  }

  const handleSubmitRole = async (e) => {
    e.preventDefault()
    try {
      if (editingRole) {
        const { data } = await api.put(`/roles/${editingRole.id}`, formData)
        setRoles(roles.map(r => r.id === editingRole.id ? data : r))
      } else {
        const { data } = await api.post('/roles', formData)
        setRoles([...roles, data])
      }
      setFormData({ name: '', description: '', permissions: [] })
      setEditingRole(null)
      setShowModal(false)
    } catch (err) {
      alert(err.response?.data?.error || 'Operation failed')
    }
  }

  const handleEditRole = (role) => {
    setEditingRole(role)
    setFormData({
      name: role.name,
      description: role.description,
      permissions: [...(role.permissions || [])]
    })
    setShowModal(true)
  }

  const handleAddNew = () => {
    setEditingRole(null)
    setFormData({ name: '', description: '', permissions: [] })
    setShowModal(true)
  }

  const handleDeleteRole = (role) => {
    setRoleToDelete(role)
    setShowDeleteConfirm(true)
  }

  const confirmDeleteRole = async () => {
    if (!roleToDelete) return
    try {
      await api.delete(`/roles/${roleToDelete.id}`)
      setRoles(roles.filter(r => r.id !== roleToDelete.id))
      setShowDeleteConfirm(false)
      setRoleToDelete(null)
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed')
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-white">Roles Management</h1>
        <button
          onClick={handleAddNew}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Add Role
        </button>
      </div>

      {/* Roles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {roles.map((role) => (
          <div key={role.id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-800 mb-1">{role.name}</h3>
                <p className="text-gray-500 text-sm">{role.description}</p>
              </div>
              <div className="flex space-x-2">
                <button 
                  onClick={() => handleEditRole(role)}
                  className="text-gray-500 hover:text-blue-600 transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteRole(role)}
                  className="text-red-500 hover:text-red-700 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Permissions:</h4>
              <div className="flex flex-wrap gap-2">
                {role.permissions.map((permission, index) => (
                  <span
                    key={index}
                    className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full"
                  >
                    {permission}
                  </span>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                <span className="font-semibold">{role.users}</span> users assigned
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Add Role Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">
              {editingRole ? 'Edit Role' : 'Add New Role'}
            </h2>
            <form onSubmit={handleSubmitRole}>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2">Role Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-white"
                  rows="3"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-gray-700 text-sm font-bold mb-2">Permissions</label>
                <div className="space-y-2">
                  {availablePermissions.map((permission) => (
                    <label key={permission} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.permissions.includes(permission)}
                        onChange={() => handlePermissionToggle(permission)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-white"
                      />
                      <span className="ml-2 text-gray-700">{permission}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingRole(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingRole ? 'Update Role' : 'Add Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Role Confirmation Modal */}
      {showDeleteConfirm && roleToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-8 max-w-md w-full">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Delete Role?</h2>
              <p className="text-gray-600">
                Are you sure you want to delete <strong>"{roleToDelete.name}"</strong>?
              </p>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setRoleToDelete(null)
                }}
                className="px-6 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteRole}
                className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Yes, Delete Role
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Roles
