import React, { useState, useEffect } from 'react'
import api from '../utils/api'

const Analytics = () => {
  const [analyticsData, setAnalyticsData] = useState({
    userGrowth: [],
    roleDistribution: [],
    permissionUsage: [],
    activityTrends: []
  })

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes, rolesRes, summaryRes] = await Promise.all([
          api.get('/users'),
          api.get('/roles'),
          api.get('/reports/summary'),
        ])

        const users = usersRes.data
        const roles = rolesRes.data
        const summary = summaryRes.data

        // Role distribution - include ALL roles, even with 0 users
        const roleCount = {}
        users.forEach(user => {
          roleCount[user.role] = (roleCount[user.role] || 0) + 1
        })
        const roleData = roles.map(r => {
          const count = roleCount[r.name] || 0
          return {
            role: r.name,
            count,
            percentage: users.length > 0 ? ((count / users.length) * 100).toFixed(1) : 0
          }
        })

        setAnalyticsData({
          roleDistribution: roleData,
          userGrowth: [],
          permissionUsage: roles.map(r => ({
            role: r.name,
            permissions: (r.permissions || []).length
          })),
          activityTrends: []
        })
      } catch (err) {
        console.error('Failed to fetch analytics:', err)
      }
    }
    fetchData()
  }, [])

  const metrics = [
    { label: 'Avg. Login Time', value: '2.4s', change: '-15%', trend: 'down', color: 'text-green-600' },
    { label: 'Permission Requests', value: '342', change: '+23%', trend: 'up', color: 'text-blue-600' },
    { label: 'Active Sessions', value: '89', change: '+8%', trend: 'up', color: 'text-purple-600' },
    { label: 'Security Alerts', value: '3', change: '-45%', trend: 'down', color: 'text-red-600' },
  ]

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-800 mb-8">Analytics</h1>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {metrics.map((metric, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-6">
            <p className="text-gray-500 text-sm mb-2">{metric.label}</p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold text-gray-800">{metric.value}</p>
              <span className={`${metric.color} text-sm font-semibold flex items-center`}>
                {metric.trend === 'down' ? '↓' : '↑'} {metric.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* User Activity Chart */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">User Activity (Last 7 Days)</h2>
          <div className="space-y-4">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => {
              const value = Math.floor(Math.random() * 100) + 50
              const maxValue = 150
              const percentage = (value / maxValue) * 100
              return (
                <div key={day}>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm text-gray-600">{day}</span>
                    <span className="text-sm font-semibold text-gray-800">{value}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Role Distribution */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Role Distribution</h2>
          <div className="space-y-4">
            {analyticsData.roleDistribution.length > 0 ? (
              analyticsData.roleDistribution.map((item, index) => (
                <div key={index}>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm text-gray-600">{item.role}</span>
                    <span className="text-sm font-semibold text-gray-800">
                      {item.count} ({item.percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        index === 0 ? 'bg-purple-500' : 
                        index === 1 ? 'bg-green-500' : 'bg-orange-500'
                      }`}
                      style={{ width: `${item.percentage}%` }}
                    ></div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-center py-8">No data available</p>
            )}
          </div>
        </div>
      </div>

      {/* Top Permissions */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Most Used Permissions</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">Permission</th>
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">Usage Count</th>
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">Trend</th>
                <th className="text-left py-3 px-4 text-gray-600 font-semibold">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Read Users', count: 1543, trend: '+12%', lastUsed: '2 min ago' },
                { name: 'Edit Content', count: 987, trend: '+8%', lastUsed: '5 min ago' },
                { name: 'Delete Items', count: 654, trend: '-3%', lastUsed: '15 min ago' },
                { name: 'Create Roles', count: 432, trend: '+15%', lastUsed: '1 hour ago' },
                { name: 'Manage Settings', count: 289, trend: '+5%', lastUsed: '2 hours ago' },
              ].map((perm, index) => (
                <tr key={index} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4">{perm.name}</td>
                  <td className="py-3 px-4 font-semibold">{perm.count}</td>
                  <td className="py-3 px-4">
                    <span className={perm.trend.startsWith('+') ? 'text-green-600' : 'text-red-600'}>
                      {perm.trend}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-500">{perm.lastUsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default Analytics
