import React, { useState, useEffect } from 'react'
import { Users, ShieldCheck, Lock, Activity } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import api from '../utils/api'

const STAT_META = [
  { label: 'Total Users',    Icon: Users,        color: 'bg-blue-500'   },
  { label: 'Active Roles',   Icon: ShieldCheck,  color: 'bg-green-500'  },
  { label: 'Permissions',    Icon: Lock,         color: 'bg-purple-500' },
  { label: 'Admin Users',    Icon: Activity,     color: 'bg-orange-500' },
]

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PIE_COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

const Dashboard = () => {
  const [stats, setStats] = useState(
    STAT_META.map(m => ({ ...m, value: '0' }))
  )
  const [recentActivity, setRecentActivity] = useState([])
  const [weeklyData, setWeeklyData] = useState(DAYS.map(d => ({ day: d, Logins: 0, Actions: 0 })))
  const [roleData, setRoleData] = useState([])

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data } = await api.get('/reports/summary')
        setStats([
          { ...STAT_META[0], value: String(data.totalUsers) },
          { ...STAT_META[1], value: String(data.totalRoles) },
          { ...STAT_META[2], value: String(data.totalPermissions) },
          { ...STAT_META[3], value: String(data.totalUsers - (data.totalUsers - 1)) },
        ])
      } catch (err) {
        console.error('Failed to fetch stats:', err)
      }
    }

    const fetchActivity = async () => {
      try {
        const { data } = await api.get('/audit-logs?action=All')

        // Recent activity list (last 5)
        setRecentActivity(
          data.slice(0, 5).map(log => ({
            user: log.user_email,
            action: `${log.action} – ${log.details}`,
            time: log.timestamp
          }))
        )

        // Weekly activity — group by JS day (0=Sun…6=Sat), remap to Mon-Sun
        const counts = { Logins: Array(7).fill(0), Actions: Array(7).fill(0) }
        data.forEach(log => {
          const jsDay = new Date(log.timestamp).getDay() // 0=Sun
          const idx = jsDay === 0 ? 6 : jsDay - 1       // remap to Mon=0…Sun=6
          counts.Actions[idx]++
          if (log.action === 'Login') counts.Logins[idx]++
        })
        setWeeklyData(DAYS.map((day, i) => ({ day, Logins: counts.Logins[i], Actions: counts.Actions[i] })))
      } catch (err) {
        console.error('Failed to fetch activity:', err)
      }
    }

    const fetchRoleDistribution = async () => {
      try {
        const { data } = await api.get('/reports/role-assignment')
        const total = data.reduce((s, r) => s + r.user_count, 0) || 1
        setRoleData(
          data
            .filter(r => r.user_count > 0)
            .map(r => ({
              name: r.role,
              value: r.user_count,
              pct: Math.round((r.user_count / total) * 100)
            }))
        )
      } catch (err) {
        console.error('Failed to fetch role distribution:', err)
      }
    }

    fetchStats()
    fetchActivity()
    fetchRoleDistribution()
  }, [])

  const renderPieLabel = ({ cx, cy, midAngle, outerRadius, index }) => {
    const RADIAN = Math.PI / 180
    const r = outerRadius + 28
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    const entry = roleData[index]
    return (
      <text x={x} y={y} fill={PIE_COLORS[index % PIE_COLORS.length]}
        textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={13} fontWeight={500}>
        {entry.name}: {entry.pct}%
      </text>
    )
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-800 mb-8">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => (
          <div key={index} className="bg-white rounded-2xl shadow-md p-6 flex items-center gap-4">
            <div className={`${stat.color} w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center`}>
              <stat.Icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-gray-500 text-sm font-medium mb-1">{stat.label}</p>
              <p className="text-3xl font-bold text-gray-800">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6 mb-8">
        {/* Weekly Activity Line Chart */}
        <div className="bg-white rounded-2xl shadow-md p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Weekly Activity</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={weeklyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#e5e7eb" />
              <XAxis dataKey="day" tick={{ fontSize: 13, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
              <Line type="monotone" dataKey="Actions" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="Logins"  stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: '#10b981' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Role Distribution Pie Chart */}
        <div className="bg-white rounded-2xl shadow-md p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Role Distribution</h2>
          {roleData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={roleData}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  dataKey="value"
                  labelLine={false}
                  label={renderPieLabel}
                >
                  {roleData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(val, name) => [`${val} users`, name]} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-400 text-center py-20">No role data available</p>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-2xl shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Recent Activity</h2>
        <div className="space-y-4">
          {recentActivity.length > 0 ? (
            recentActivity.map((activity, index) => (
              <div key={index} className="flex items-center justify-between border-b border-gray-100 pb-3 last:border-0">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-semibold text-sm">
                    {activity.user.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-gray-800 font-medium">{activity.user}</p>
                    <p className="text-gray-500 text-sm">{activity.action}</p>
                  </div>
                </div>
                <span className="text-gray-400 text-sm">{activity.time}</span>
              </div>
            ))
          ) : (
            <p className="text-gray-500 text-center py-8">No recent activity yet</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard
