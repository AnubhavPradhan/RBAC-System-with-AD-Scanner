import React from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const Sidebar = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { hasPermission, currentUser, logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const menuItems = [
    { path: '/dashboard', name: 'Dashboard', icon: '/icons/Dashboard.svg', permission: null },
    { path: '/users', name: 'Users', icon: '/icons/Users.svg', permission: 'manage_users' },
    { path: '/roles', name: 'Roles', icon: '/icons/Roles.png', permission: 'manage_roles' },
    { path: '/permissions', name: 'Permissions', icon: '/icons/Permissions.png', permission: 'manage_permissions' },
    { path: '/ad-scanner', name: 'AD Scanner', icon: '/icons/Active-directory.png', permission: 'manage_ad_scanner' },
    { path: '/reports', name: 'Reports', icon: '/icons/Reports.png', permission: 'view_reports' },
    { path: '/audit-logs', name: 'Audit Logs', icon: '/icons/AuditLogs.png', permission: 'view_audit_logs' },
    { path: '/settings', name: 'Settings', icon: '/icons/Settings.svg', permission: null },
  ]

  // Filter menu items based on user permissions
  const visibleMenuItems = menuItems.filter(item => 
    !item.permission || hasPermission(item.permission)
  )

  return (
    <aside className="w-64 text-white min-h-screen fixed top-0 left-0 flex flex-col" style={{ backgroundColor: 'var(--app-sidebar-color)' }}>
      <div className="p-6 flex-1 overflow-y-auto">
        <h1 className="text-xl font-bold mb-8">RBAC & AD Scanner</h1>
        <nav>
          <ul className="space-y-2">
            {visibleMenuItems.map((item) => {
              const isActive = location.pathname === item.path

              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center space-x-3 px-4 py-3 rounded-2xl border transition-all duration-200 ${
                      isActive
                        ? 'bg-[#162c5e] border-[#2a58b3] text-[#65a9ff] shadow-[0_10px_24px_rgba(0,0,0,0.28)]'
                        : 'border-transparent text-[#8f9bb2] hover:bg-[#252a3a] hover:border-[#2f3c5d] hover:text-[#9dc5ff]'
                    }`}
                  >
                    {item.icon.startsWith('/') ? (
                      <img
                        src={item.icon}
                        alt={item.name}
                        className={`w-5 h-5 transition-opacity ${isActive ? 'opacity-100' : 'opacity-80'}`}
                      />
                    ) : (
                      <span className="text-xl">{item.icon}</span>
                    )}
                    <span className="font-medium">{item.name}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
      {/* Account & Logout */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
              {currentUser?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{currentUser?.name}</p>
              <p className="text-xs text-gray-400 truncate">{currentUser?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="ml-3 px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-xs font-medium flex-shrink-0"
          >
            Logout
          </button>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
