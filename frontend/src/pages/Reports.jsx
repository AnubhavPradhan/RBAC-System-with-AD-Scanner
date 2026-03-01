import React, { useState, useEffect } from 'react'
import api from '../utils/api'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Export Helpers ────────────────────────────────────────────────────────────
const exportToCSV = (data, filename) => {
  if (!data || !data.length) return alert('No data to export')
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

const exportToJSON = (data, filename) => {
  if (!data || !data.length) return alert('No data to export')
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const Reports = () => {
  const [selectedReport, setSelectedReport] = useState(null)
  const [reportData, setReportData] = useState([])
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState({ start: '', end: '' })

  const reportTypes = [
    {
      id: 'user-activity',
      name: 'User Activity Report',
      description: 'Detailed user login and activity logs',
    },
    {
      id: 'permission-audit',
      name: 'Permission Audit',
      description: 'Changes to permissions and access rights',
    },
    {
      id: 'role-assignment',
      name: 'Role Assignment Report',
      description: 'Role changes and assignments over time',
    },
    {
      id: 'security-summary',
      name: 'Security Summary',
      description: 'Security events and access violations',
    },
    {
      id: 'compliance',
      name: 'Compliance Report',
      description: 'Regulatory compliance and access control',
    },
    {
      id: 'system-usage',
      name: 'System Usage',
      description: 'Overall system usage statistics',
    },
  ]

  const handleGenerateReport = async (report) => {
    setSelectedReport(report)
    setLoading(true)
    setReportData([])
    try {
      const params = {}
      if (dateRange.start) params.dateFrom = dateRange.start
      if (dateRange.end) params.dateTo = dateRange.end

      const endpointMap = {
        'user-activity': '/reports/user-activity',
        'role-assignment': '/reports/role-assignment',
        'permission-audit': '/reports/permission-audit',
        'security-summary': '/reports/security-summary',
        'system-usage': '/reports/system-usage',
        'compliance': '/reports/role-assignment', // fallback
      }

      const endpoint = endpointMap[report.id] || '/reports/user-activity'
      const { data } = await api.get(endpoint, { params })
      setReportData(data)

      // Log report generation to audit logs
      await api.post('/audit-logs', {
        action: 'Report Generated',
        resource: 'Reports',
        details: `Generated "${report.name}" (${data.length} records)`,
        severity: 'Info',
      })
    } catch (err) {
      alert('Failed to generate report')
    } finally {
      setLoading(false)
    }
  }

  const handleExportCSV = () => {
    if (!selectedReport || !reportData.length) return alert('Generate a report first')
    exportToCSV(reportData, `${selectedReport.id}-report.csv`)
  }

  const handleExportJSON = () => {
    if (!selectedReport || !reportData.length) return alert('Generate a report first')
    exportToJSON(reportData, `${selectedReport.id}-report.json`)
  }

  const handleExportPDF = () => {
    if (!selectedReport || !reportData.length) return alert('Generate a report first')
    const doc = new jsPDF({ orientation: 'landscape' })
    const headers = Object.keys(reportData[0])
    const rows = reportData.map(row => headers.map(h => row[h] ?? ''))

    doc.setFontSize(16)
    doc.setTextColor(31, 41, 55)
    doc.text(selectedReport.name, 14, 18)

    doc.setFontSize(9)
    doc.setTextColor(120, 120, 120)
    doc.text(`Generated: ${new Date().toLocaleString()}  |  ${reportData.length} records`, 14, 26)

    autoTable(doc, {
      head: [headers.map(h => h.replace(/_/g, ' ').toUpperCase())],
      body: rows,
      startY: 32,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    })

    doc.save(`${selectedReport.id}-report.pdf`)
  }

  const handleServerExportCSV = async (type) => {
    try {
      const response = await api.get(`/reports/export/csv?type=${type}`, {
        responseType: 'blob'
      })
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url; a.download = `${type}-report.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed')
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-800 mb-8">Reports</h1>

      {/* Filters + Report Types */}
      <div className="bg-white rounded-lg shadow-md mb-8">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Report Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={() => selectedReport && handleGenerateReport(selectedReport)}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Apply Filters
              </button>
              <button
                onClick={() => setDateRange({ start: '', end: '' })}
                className="flex-1 bg-red-500 text-white py-2 px-4 rounded-lg hover:bg-red-600 transition-colors font-medium"
              >
                Clear Dates
              </button>
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {reportTypes.map((report) => (
            <div
              key={report.id}
              className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1 min-w-0 mr-6">
                <h3 className="text-base font-semibold text-gray-800">{report.name}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{report.description}</p>
              </div>
              <button
                onClick={() => handleGenerateReport(report)}
                disabled={loading}
                className="shrink-0 bg-gray-800 text-white py-2 px-5 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                {loading && selectedReport?.id === report.id ? 'Loading...' : 'Generate'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Report Results */}
      {selectedReport && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              {selectedReport.name}
              {reportData.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({reportData.length} records)
                </span>
              )}
            </h2>
            {reportData.length > 0 && (
              <div className="space-x-2">
                <button
                  onClick={handleExportPDF}
                  className="bg-red-500 text-white py-2 px-4 rounded-lg hover:bg-red-600 transition-colors text-sm"
                >
                  Export PDF
                </button>
                <button
                  onClick={handleExportCSV}
                  className="bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 transition-colors text-sm"
                >
                  Export CSV
                </button>
                <button
                  onClick={handleExportJSON}
                  className="bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors text-sm"
                >
                  Export JSON
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-500">Generating report...</div>
          ) : reportData.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No data found for this report</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b">
                    {Object.keys(reportData[0]).map(key => (
                      <th key={key} className="text-left py-3 px-4 text-gray-600 font-semibold capitalize">
                        {key.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportData.slice(0, 50).map((row, index) => (
                    <tr key={index} className="border-b hover:bg-gray-50">
                      {Object.values(row).map((val, i) => (
                        <td key={i} className="py-3 px-4 text-sm text-gray-700">
                          {String(val ?? '-')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {reportData.length > 50 && (
                <p className="text-center text-sm text-gray-500 mt-4">
                  Showing first 50 of {reportData.length} records. Export to see all.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Reports
