import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const Sidebar = () => {
  const location = useLocation()
  const { hasPermission } = useAuth()

  const menuItems = [
    { path: '/dashboard', name: 'Dashboard', icon: '/icons/Dashboard.svg', permission: null },
    { path: '/users', name: 'Users', icon: '/icons/Users.svg', permission: 'manage_users' },
    { path: '/roles', name: 'Roles', icon: '/icons/Roles.png', permission: 'manage_roles' },
    { path: '/ad-scanner', name: 'AD Scanner', icon: '/icons/ad-scanner-logo.svg', permission: 'manage_ad_scanner' },
    { path: '/reports', name: 'Reports', icon: '/icons/Reports.png', permission: 'view_reports' },
    { path: '/audit-logs', name: 'Audit Logs', icon: '/icons/AuditLogs.png', permission: 'view_audit_logs' },
    { path: '/settings', name: 'Settings', icon: '/icons/Settings.svg', permission: 'manage_settings' },
  ]

  // Filter menu items based on user permissions
  const visibleMenuItems = menuItems.filter(item => 
    !item.permission || hasPermission(item.permission)
  )

  return (
    <aside
      className="fixed top-[76px] left-0 w-64 h-[calc(100vh-76px)] text-white border-r border-[#2a2a2a] overflow-y-auto"
      style={{ backgroundColor: 'var(--app-sidebar-color)' }}
    >
      <div className="p-4">
        <nav>
          <ul className="space-y-1">
            {visibleMenuItems.map((item) => {
              const isActive = location.pathname === item.path

              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg border transition-all duration-200 ${
                      isActive
                        ? 'bg-[#323232] border-[#4b4b4b] text-white shadow-md'
                        : 'border-transparent text-gray-400 hover:bg-[#2a2a2a] hover:text-gray-200'
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
    </aside>
  )
}

export default Sidebar
