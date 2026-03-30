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
    <aside
      className="fixed top-[73px] left-0 w-64 h-[calc(100vh-73px)] text-white border-r border-[#2a2f42] overflow-y-auto"
      style={{ backgroundColor: 'var(--app-sidebar-color)' }}
    >
      <div className="p-6">
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
    </aside>
  )
}

export default Sidebar
