import React, { useState, useEffect } from 'react'
import api from '../utils/api'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'

// ─── Export Helpers ────────────────────────────────────────────────────────────
const toTitle = (value) => String(value || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase())

const formatNepalDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
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

const formatExportCell = (key, value) => {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(' | ')
  if (/(timestamp|date|time|last_logon|created_at|updated_at)/i.test(key)) {
    return formatNepalDateTime(value)
  }
  return String(value)
}

const toExcelColumnName = (index) => {
  let columnIndex = index
  let name = ''
  while (columnIndex > 0) {
    const remainder = (columnIndex - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    columnIndex = Math.floor((columnIndex - 1) / 26)
  }
  return name
}

const exportToExcel = async (data, filename, reportName = 'Report') => {
  if (!data || !data.length) return alert('No data to export')

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Report')
  const headers = Object.keys(data[0])
  const labelMap = {
    sam_account_name: 'SAM Account',
    display_name: 'Display Name',
    user_email: 'User Email',
    risk_flags: 'Risk Flags',
    role_count: 'Roles Using Permission',
    user_count: 'Assigned Users',
  }

  const visibleHeaders = headers.map((h) => labelMap[h] || toTitle(h))
  const dataRows = data.map((row) => headers.map((key) => formatExportCell(key, row[key])))

  worksheet.columns = headers.map((header, index) => {
    const displayHeader = visibleHeaders[index]
    const maxContentLength = Math.max(
      displayHeader.length,
      ...dataRows.map((r) => String(r[index] || '').length),
    )
    return {
      key: header,
      width: Math.min(Math.max(maxContentLength + 4, 14), 42),
      style: {
        alignment: { vertical: 'top', horizontal: 'left', wrapText: true },
      },
    }
  })

  const lastCol = headers.length
  const firstColLetter = 'A'
  const lastColLetter = toExcelColumnName(lastCol)

  worksheet.mergeCells(`${firstColLetter}1:${lastColLetter}1`)
  worksheet.getCell('A1').value = reportName
  worksheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1F2937' } }
  worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' }
  worksheet.getRow(1).height = 26

  worksheet.mergeCells(`${firstColLetter}2:${lastColLetter}2`)
  worksheet.getCell('A2').value = `Generated (NPT): ${formatNepalDateTime(new Date().toISOString())}`
  worksheet.getCell('A2').font = { size: 11, color: { argb: 'FF4B5563' } }

  worksheet.mergeCells(`${firstColLetter}3:${lastColLetter}3`)
  worksheet.getCell('A3').value = `Total Records: ${data.length}`
  worksheet.getCell('A3').font = { size: 11, color: { argb: 'FF4B5563' } }

  const headerRowIndex = 5
  const headerRow = worksheet.getRow(headerRowIndex)
  headerRow.values = visibleHeaders
  headerRow.height = 24

  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    }
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
  })

  dataRows.forEach((rowValues, rowIndex) => {
    const row = worksheet.addRow(rowValues)
    row.height = 22
    const isAlternateRow = rowIndex % 2 === 0
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isAlternateRow ? 'FFF8FAFC' : 'FFFFFFFF' },
      }
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
    })
  })

  worksheet.autoFilter = {
    from: `${firstColLetter}${headerRowIndex}`,
    to: `${lastColLetter}${headerRowIndex}`,
  }
  worksheet.views = [{ state: 'frozen', ySplit: headerRowIndex }]

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
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
      id: 'ad-scanner',
      name: 'AD Scanner Report',
      description: 'Active Directory scan results and risk analysis',
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
        'permission-audit': '/reports/permission-audit',
        'security-summary': '/reports/security-summary',
        'system-usage': '/reports/system-usage',
        'compliance': '/reports/compliance',
        'ad-scanner': '/reports/ad-scanner',
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

  const handleExportCSV = async () => {
    if (!selectedReport || !reportData.length) return alert('Generate a report first')
    await exportToExcel(reportData, `${selectedReport.id}-report.xlsx`, selectedReport.name)
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
      <h1 className="text-3xl font-bold text-white mb-8">Reports</h1>

      {/* Filters + Report Types */}
      <div className="bg-[#1f1f1f] rounded-lg shadow-md mb-8">
        <div className="p-6 border-b border-[#3a3a3a]">
          <h2 className="text-xl font-semibold text-white mb-4">Report Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Start Date</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="w-full px-4 py-2 border border-[#3a3a3a] rounded-lg bg-[#323232] text-[#9c9c9c] focus:outline-none focus:ring-2 focus:ring-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">End Date</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="w-full px-4 py-2 border border-[#3a3a3a] rounded-lg bg-[#323232] text-[#9c9c9c] focus:outline-none focus:ring-2 focus:ring-white"
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
                  Export Excel
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
