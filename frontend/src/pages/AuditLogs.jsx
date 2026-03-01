import React, { useState, useEffect } from 'react'
import api from '../utils/api'

// ─── CSV Export Helper ─────────────────────────────────────────────────────────
const exportToCSV = (data, filename) => {
  if (!data.length) return alert('No data to export')
  const headers = Object.keys(data[0])
  const rows = data.map(row =>
    headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── JSON Export Helper ───────────────────────────────────────────────────────
const exportToJSON = (data, filename) => {
  if (!data.length) return alert('No data to export')
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const AuditLogs = () => {
  const [logs, setLogs] = useState([])
  const [filteredLogs, setFilteredLogs] = useState([])
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [filters, setFilters] = useState({
    action: 'All',
    user: '',
    dateFrom: '',
    dateTo: ''
  })

  useEffect(() => {
    fetchLogs()
  }, [])

  const fetchLogs = async () => {
    try {
      const { data } = await api.get('/audit-logs')
      setLogs(data)
      setFilteredLogs(data)
    } catch (err) {
      console.error('Failed to fetch audit logs:', err)
    }
  }

  useEffect(() => {
    let filtered = [...logs]
    if (filters.action !== 'All') {
      filtered = filtered.filter(log => log.action === filters.action)
    }
    if (filters.user) {
      filtered = filtered.filter(log =>
        (log.user_email || '').toLowerCase().includes(filters.user.toLowerCase())
      )
    }
    if (filters.dateFrom) {
      filtered = filtered.filter(log => log.timestamp >= filters.dateFrom)
    }
    if (filters.dateTo) {
      filtered = filtered.filter(log => log.timestamp <= filters.dateTo + ' 23:59:59')
    }
    setFilteredLogs(filtered)
  }, [filters, logs])

  const handleFilterChange = (key, value) => {
    setFilters({ ...filters, [key]: value })
  }

  const handleClearLogs = () => setShowClearConfirm(true)

  const confirmClearLogs = async () => {
    try {
      await api.delete('/audit-logs')
      setLogs([])
      setFilteredLogs([])
      setShowClearConfirm(false)
    } catch (err) {
      alert('Failed to clear logs')
    }
  }

  const handleExportCSV = () => {
    const exportData = filteredLogs.map(l => ({
      ID: l.id,
      Timestamp: l.timestamp,
      User: l.user_email,
      Action: l.action,
      Resource: l.resource,
      Details: l.details,
      Severity: l.severity
    }))
    exportToCSV(exportData, 'audit-logs.csv')
  }

  const handleExportJSON = () => {
    exportToJSON(filteredLogs, 'audit-logs.json')
  }

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'Critical': return 'bg-red-100 text-red-700'
      case 'Warning': return 'bg-yellow-100 text-yellow-700'
      case 'Info': return 'bg-blue-100 text-blue-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const stats = [
    { label: 'Total Events', value: logs.length, /*icon: '📝', color: 'bg-blue-500'*/ },
    { label: 'Critical Events', value: logs.filter(l => l.severity === 'Critical').length, /*icon: '🚨', color: 'bg-red-500'*/ },
    { label: 'Warnings', value: logs.filter(l => l.severity === 'Warning').length, /*icon: '⚠️', color: 'bg-yellow-500'*/ },
    { label: 'Active Users', value: new Set(logs.map(l => l.user)).size, /*icon: '👥', color: 'bg-green-500'*/ },
  ]

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-800 mb-8">Audit Logs</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-800">{stat.value}</p>
              </div>
              <div className={`${stat.color} text-white p-4 rounded-lg text-2xl`}>
                {stat.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Activity Log Section with Filters */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        {/* Header with Title and Buttons */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-800">Filters</h2>
          <div className="space-x-2">
            <button
              onClick={handleExportCSV}
              className="bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 transition-colors"
            >
              Export CSV
            </button>
            <button
              onClick={handleExportJSON}
              className="bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors"
            >
              Export JSON
            </button>
            <button 
              onClick={handleClearLogs}
              className="bg-red-500 text-white py-2 px-4 rounded-lg hover:bg-red-600 transition-colors"
            >
              Clear All Logs
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Action</label>
              <select
                value={filters.action}
                onChange={(e) => handleFilterChange('action', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>All</option>
                <option>Login</option>
                <option>Logout</option>
                <option>Create</option>
                <option>Update</option>
                <option>Delete</option>
                <option>Failed Login</option>
                <option>Access Denied</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">User</label>
              <input
                type="text"
                value={filters.user}
                onChange={(e) => handleFilterChange('user', e.target.value)}
                placeholder="Search by user email..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Logs Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">Timestamp</th>
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">User</th>
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">Action</th>
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">Resource</th>
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">Details</th>
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">Severity</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm text-gray-600">{log.timestamp}</td>
                  <td className="py-3 px-4 font-medium">{log.user_email}</td>
                  <td className="py-3 px-4">
                    <span className="bg-gray-100 text-gray-700 py-1 px-3 rounded-full text-sm">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-600">{log.resource}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{log.details}</td>
                  <td className="py-3 px-4">
                    <span className={`py-1 px-3 rounded-full text-sm ${getSeverityColor(log.severity)}`}>
                      {log.severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Confirmation</h2>
            <p className="text-gray-700 mb-6">
              Are you sure you want to clear all audit logs? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={confirmClearLogs}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
              >
                OK
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AuditLogs
