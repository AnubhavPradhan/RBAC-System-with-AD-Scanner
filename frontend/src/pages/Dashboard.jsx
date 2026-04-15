import React, { useState, useEffect } from 'react'
import { Users, ShieldCheck, UserCheck, Wifi, WifiOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import api from '../utils/api'

const STAT_META = [
  {
    label: 'Total Users',
    Icon: Users,
    valueColor: 'text-[#63a8ff]',
    iconColor: 'text-[#63a8ff]',
    iconBg: 'bg-[#17315a]'
  },
  {
    label: 'Active Users',
    Icon: Users,
    valueColor: 'text-[#40e1b2]',
    iconColor: 'text-[#40e1b2]',
    iconBg: 'bg-[#133c43]'
  },
  {
    label: 'Active Roles',
    Icon: ShieldCheck,
    valueColor: 'text-[#a88bff]',
    iconColor: 'text-[#a88bff]',
    iconBg: 'bg-[#28244d]'
  },
  {
    label: 'Admin Users',
    Icon: UserCheck,
    valueColor: 'text-[#ff962e]',
    iconColor: 'text-[#ff962e]',
    iconBg: 'bg-[#3a2b24]'
  },
]

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PIE_COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']
const SURFACE_STYLE = {
  backgroundColor: 'var(--app-surface-color)',
  borderColor: 'var(--app-border-color)'
}

const Dashboard = () => {
  const { currentUser, hasPermission } = useAuth()
  const canManageAdScanner = hasPermission('manage_ad_scanner')
  const [stats, setStats] = useState(
    STAT_META.map(m => ({ ...m, value: '0' }))
  )
  const [recentActivity, setRecentActivity] = useState([])
  const [weeklyData, setWeeklyData] = useState(DAYS.map(d => ({ day: d, Logins: 0, Actions: 0 })))
  const [roleData, setRoleData] = useState([])
  const [adStatus, setAdStatus] = useState({ loading: true, configured: false, connected: false, message: '' })

  const normalizeActivitySource = (text) => {
    if (typeof text !== 'string') return text
    const useLdaps = adStatus?.port === 636 || /ldaps/i.test(adStatus?.message || '')
    if (!useLdaps) return text
    return text.replace(/\(ldap\)/gi, '(LDAPS)')
  }

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data } = await api.get('/reports/summary')
        setStats([
          { ...STAT_META[0], value: String(data.totalUsers) },
          { ...STAT_META[1], value: String(data.activeUsers) },
          { ...STAT_META[2], value: String(data.totalRoles) },
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

    const fetchAdStatus = async () => {
      try {
        const { data } = await api.get('/ad-scanner/status')
        setAdStatus({
          loading: false,
          configured: !!data.configured,
          connected: !!data.connected,
          message: data.message || '',
          server: data.server || '',
          port: data.port || null,
        })
      } catch (_) {
        // Do not show cross-page connection errors outside AD Scanner.
        setAdStatus({
          loading: false,
          configured: false,
          connected: false,
          message: 'AD status unavailable',
        })
      }
    }

    fetchStats()
    fetchActivity()
    fetchRoleDistribution()
    if (canManageAdScanner) {
      fetchAdStatus()
    } else {
      setAdStatus({ loading: false, configured: false, connected: false, message: '' })
    }
  }, [canManageAdScanner])

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
      <h1 className="text-3xl font-bold text-white mb-8">Dashboard</h1>

      {canManageAdScanner && (
        <div className="rounded-2xl border shadow-md p-4 mb-6 flex items-center justify-between" style={SURFACE_STYLE}>
          <div>
            <p className="text-sm text-white">Windows Server AD Connection</p>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <p className="text-base font-semibold text-blue-50">
                {adStatus.loading ? 'Checking status...' : adStatus.connected ? 'Connected' : 'Offline'}
              </p>
              {!adStatus.loading && (
                <p className="text-sm text-blue-300">{adStatus.message}</p>
              )}
            </div>
          </div>
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${adStatus.connected ? 'bg-green-900/40' : 'bg-red-900/40'}`}>
            {adStatus.connected ? (
              <Wifi className="w-5 h-5 text-green-400" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-400" />
            )}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => (
          <div key={index} className="rounded-2xl border shadow-md p-6 flex items-start justify-between" style={SURFACE_STYLE}>
            <div>
              <p className="text-blue-200 text-sm font-medium mb-2">{stat.label}</p>
              <p className={`text-5xl leading-none font-bold ${stat.valueColor}`}>{stat.value}</p>
            </div>
            <div className={`${stat.iconBg} w-16 h-16 rounded-2xl flex-shrink-0 flex items-center justify-center`}>
              <stat.Icon className={`w-7 h-7 ${stat.iconColor}`} />
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6 mb-8">
        {/* Weekly Activity Line Chart */}
        <div className="rounded-2xl border shadow-md p-6" style={SURFACE_STYLE}>
          <h2 className="text-lg font-bold text-blue-50 mb-4">Weekly Activity</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={weeklyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#243968" />
              <XAxis dataKey="day" tick={{ fontSize: 13, fill: '#9db0da' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#9db0da' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #2b3f70', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', backgroundColor: '#0f1f46', color: '#dbe7ff' }} />
              <Line type="monotone" dataKey="Actions" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="Logins"  stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: '#10b981' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Role Distribution Pie Chart */}
        <div className="rounded-2xl border shadow-md p-6" style={SURFACE_STYLE}>
          <h2 className="text-lg font-bold text-blue-50 mb-4">Role Distribution</h2>
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
                <Tooltip
                  formatter={(val, name) => [
                    <span style={{ color: '#ecf3ff' }}>{`${val} users`}</span>,
                    <span style={{ color: '#ecf3ff' }}>{String(name)}</span>
                  ]}
                  labelStyle={{ color: '#ecf3ff' }}
                  itemStyle={{ color: '#ecf3ff' }}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #2b3f70', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', backgroundColor: '#0f1f46', color: '#ecf3ff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-blue-200 text-center py-20">No role data available</p>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-2xl border shadow-md p-6" style={SURFACE_STYLE}>
        <h2 className="text-xl font-bold text-white mb-4">Recent Activity</h2>
        <div className="space-y-4">
          {recentActivity.length > 0 ? (
            recentActivity.map((activity, index) => (
              <div key={index} className="flex items-center justify-between border-b border-blue-900/50 pb-3 last:border-0">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-900/60 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                    {activity.user.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white font-medium">{activity.user}</p>
                    <p className="text-white text-sm">{normalizeActivitySource(activity.action)}</p>
                  </div>
                </div>
                <span className="text-white text-sm">{activity.time}</span>
              </div>
            ))
          ) : (
            <p className="text-white text-center py-8">No recent activity yet</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard
