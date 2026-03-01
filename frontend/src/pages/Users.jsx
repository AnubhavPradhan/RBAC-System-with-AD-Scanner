import React, { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../utils/api'

const Users = () => {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'Admin'
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterRole, setFilterRole] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState(['Viewer'])
  const [loading, setLoading] = useState(true)

  const [formData, setFormData] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
    role: 'Viewer',
    status: 'Active'
  })

  useEffect(() => {
    fetchUsers()
    fetchRoles()
  }, [])

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/users')
      setUsers(data)
    } catch (err) {
      console.error('Failed to fetch users:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchRoles = async () => {
    try {
      const { data } = await api.get('/roles')
      setRoles(data.map(r => r.name))
    } catch (err) {
      console.error('Failed to fetch roles:', err)
    }
  }

  // Filter and search users
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchesSearch = user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           user.email.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesRole = filterRole === 'All' || user.role === filterRole
      const matchesStatus = filterStatus === 'All' || user.status === filterStatus
      return matchesSearch && matchesRole && matchesStatus
    })
  }, [users, searchQuery, filterRole, filterStatus])

  const handleSubmitUser = async (e) => {
    e.preventDefault()
    try {
      if (editingUser) {
        const { data } = await api.put(`/users/${editingUser.id}`, formData)
        setUsers(users.map(u => u.id === editingUser.id ? data : u))
      } else {
        const { data } = await api.post('/users', formData)
        setUsers([...users, data])
      }
      setFormData({ name: '', username: '', email: '', password: '', role: 'Viewer', status: 'Active' })
      setEditingUser(null)
      setShowModal(false)
    } catch (err) {
      alert(err.response?.data?.error || 'Operation failed')
    }
  }

  const handleEditUser = (user) => {
    setEditingUser(user)
    setFormData({
      name: user.name,
      username: user.username || '',
      email: user.email,
      password: '',
      role: user.role,
      status: user.status
    })
    setShowModal(true)
  }

  const handleAddNew = () => {
    setEditingUser(null)
    setFormData({ name: '', username: '', email: '', password: '', role: 'Viewer', status: 'Active' })
    setShowModal(true)
  }

  const handleDeleteUser = async (id) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return
    try {
      await api.delete(`/users/${id}`)
      setUsers(users.filter(u => u.id !== id))
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed')
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Users Management</h1>
          <p className="text-gray-600 mt-1">Manage user accounts and access controls</p>
        </div>
        <button
          onClick={handleAddNew}
          className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg"
        >
          + Add User
        </button>
      </div>

      {/* Search and Filter Bar */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                placeholder="Search users by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="All">All Roles</option>
              {roles.map(role => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="All">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
        {(searchQuery || filterRole !== 'All' || filterStatus !== 'All') && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-gray-600">
              Showing {filteredUsers.length} of {users.length} users
            </span>
            <button
              onClick={() => {
                setSearchQuery('')
                setFilterRole('All')
                setFilterStatus('All')
              }}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-6xl mb-4">👤</div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">No users found</h3>
            <p className="text-gray-500 mb-6">
              {searchQuery || filterRole !== 'All' || filterStatus !== 'All'
                ? 'Try adjusting your search or filters'
                : 'Get started by creating your first user'
              }
            </p>
            {(!searchQuery && filterRole === 'All' && filterStatus === 'All') && (
              <button
                onClick={handleAddNew}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create User
              </button>
            )}
          </div>
        ) : (

          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold mr-3">
                      {user.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="text-sm font-medium text-gray-900">{user.name}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.email}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    user.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {user.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                  <button 
                    onClick={() => handleEditUser(user)}
                    className="text-blue-600 hover:text-blue-900"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteUser(user.id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add User Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">
              {editingUser ? 'Edit User' : 'Add New User'}
            </h2>
            <form onSubmit={handleSubmitUser}>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2">Username</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter username"
                />
              </div>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Password {editingUser && <span className="text-gray-400 font-normal">(leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={editingUser ? 'Leave blank to keep current' : 'Enter password'}
                  {...(!editingUser && { required: true })}
                />
              </div>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2">Role</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {roles.map(role => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </div>
              <div className="mb-6">
                <label className="block text-gray-700 text-sm font-bold mb-2">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingUser(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {editingUser ? 'Update User' : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Users
