import React, { useState, useEffect } from 'react'
import api from '../utils/api'

// ─── CSV Export Helper ─────────────────────────────────────────────────────────
const formatNepalDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

const exportToCSV = (data, filename, filters) => {
  if (!data.length) return alert('No data to export')

  const activeFilters = []
  if (filters.action && filters.action !== 'All') activeFilters.push(`Action=${filters.action}`)
  if (filters.user) activeFilters.push(`User contains "${filters.user}"`)
  if (filters.dateFrom) activeFilters.push(`From=${filters.dateFrom}`)
  if (filters.dateTo) activeFilters.push(`To=${filters.dateTo}`)

  const header = ['ID', 'Date (NPT)', 'Time (NPT)', 'User Email', 'Action', 'Resource', 'Severity', 'Details']
  const rows = data.map((log) => {
    const ts = formatNepalDateTime(log.Timestamp)
    const [datePart, timePart] = String(ts).split(', ')
    return [
      log.ID,
      datePart || '-',
      timePart || '-',
      log.User || '-',
      log.Action || '-',
      log.Resource || '-',
      log.Severity || '-',
      log.Details || '-',
    ]
  })

  const csvRows = [
    ['Report: Audit Logs'],
    [`Generated (NPT): ${formatNepalDateTime(new Date().toISOString())}`],
    [`Total Records: ${data.length}`],
    [`Filters: ${activeFilters.length ? activeFilters.join(' | ') : 'None'}`],
    [],
    header,
    ...rows,
  ]

  const csv = csvRows
    .map((cols) => cols.map((col) => `"${String(col ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
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
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
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

  useEffect(() => {
    if (!showClearConfirm) return

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setShowClearConfirm(false)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showClearConfirm])

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
    setCurrentPage(1)
  }, [filters, logs])

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedLogs = filteredLogs.slice(startIndex, endIndex)

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

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
    exportToCSV(exportData, 'audit-logs.csv', filters)
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
  ]

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Audit Logs</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Action</label>
              <select
                value={filters.action}
                onChange={(e) => handleFilterChange('action', e.target.value)}
                className="w-full px-4 py-2 border border-[#3a3a3a] rounded-lg bg-[#1f1f1f] text-[#9c9c9c] focus:outline-none focus:ring-2 focus:ring-white"
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
              <label className="block text-sm font-medium text-gray-300 mb-2">User</label>
              <input
                type="text"
                value={filters.user}
                onChange={(e) => handleFilterChange('user', e.target.value)}
                placeholder="Search by user email..."
                className="w-full px-4 py-2 border border-[#3a3a3a] rounded-lg bg-[#323232] text-[#9c9c9c] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">From Date</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                className="w-full px-4 py-2 border border-[#3a3a3a] rounded-lg bg-[#323232] text-[#9c9c9c] focus:outline-none focus:ring-2 focus:ring-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">To Date</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                className="w-full px-4 py-2 border border-[#3a3a3a] rounded-lg bg-[#323232] text-[#9c9c9c] focus:outline-none focus:ring-2 focus:ring-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Logs per page</label>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(parseInt(e.target.value, 10))
                  setCurrentPage(1)
                }}
                className="w-full px-4 py-2 border border-[#3a3a3a] rounded-lg bg-[#1f1f1f] text-[#9c9c9c] focus:outline-none focus:ring-2 focus:ring-white"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
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
              {paginatedLogs.map((log) => (
                <tr key={log.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm text-gray-600">{log.timestamp ? log.timestamp.split('.')[0] : ''}</td>
                  <td className="py-3 px-4 font-medium">{log.user_email}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{log.action}</td>
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

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {filteredLogs.length === 0 ? 0 : startIndex + 1} - {Math.min(endIndex, filteredLogs.length)} of {filteredLogs.length} logs
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg border border-[#3a3a3a] text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2a2a2a] transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">Page {currentPage} of {totalPages}</span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || filteredLogs.length === 0}
              className="px-3 py-1.5 rounded-lg border border-[#3a3a3a] text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2a2a2a] transition-colors"
            >
              Next
            </button>
          </div>
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
