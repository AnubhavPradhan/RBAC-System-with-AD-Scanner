// Initialize default roles and permissions in localStorage
export const initializeDefaultData = () => {
  // Check if data already exists
  const existingRoles = localStorage.getItem('rbac-roles')
  const existingPermissions = localStorage.getItem('rbac-permissions')
  const existingUsers = localStorage.getItem('rbac-users')
  
  // Only initialize if data doesn't exist
  if (!existingRoles) {
    const defaultRoles = [
      {
        id: '1',
        name: 'Admin',
        description: 'Full system access with all permissions',
        permissions: [
          'manage_users',
          'manage_roles',
          'manage_permissions',
          'view_analytics',
          'view_reports',
          'view_audit_logs'
        ],
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        name: 'Editor',
        description: 'Can manage users and view analytics',
        permissions: [
          'manage_users',
          'view_analytics',
          'view_reports'
        ],
        createdAt: new Date().toISOString()
      },
      {
        id: '3',
        name: 'Viewer',
        description: 'Read-only access to analytics and reports',
        permissions: [
          'view_analytics',
          'view_reports'
        ],
        createdAt: new Date().toISOString()
      }
    ]
    localStorage.setItem('rbac-roles', JSON.stringify(defaultRoles))
  }
  
  if (!existingPermissions) {
    const defaultPermissions = [
      {
        id: '1',
        name: 'manage_users',
        description: 'Create, edit, and delete users',
        module: 'Users',
        status: 'Active',
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        name: 'manage_roles',
        description: 'Create, edit, and delete roles',
        module: 'Roles',
        status: 'Active',
        createdAt: new Date().toISOString()
      },
      {
        id: '3',
        name: 'manage_permissions',
        description: 'Create, edit, and delete permissions',
        module: 'Permissions',
        status: 'Active',
        createdAt: new Date().toISOString()
      },
      {
        id: '4',
        name: 'view_analytics',
        description: 'View analytics dashboard',
        module: 'Analytics',
        status: 'Active',
        createdAt: new Date().toISOString()
      },
      {
        id: '5',
        name: 'view_reports',
        description: 'View and download reports',
        module: 'Reports',
        status: 'Active',
        createdAt: new Date().toISOString()
      },
      {
        id: '6',
        name: 'view_audit_logs',
        description: 'View system audit logs',
        module: 'Audit Logs',
        status: 'Active',
        createdAt: new Date().toISOString()
      }
    ]
    localStorage.setItem('rbac-permissions', JSON.stringify(defaultPermissions))
  }

  // Default admin user for demo
  if (!existingUsers) {
    const defaultAdmin = [
      {
        id: '1',
        name: 'Admin',
        username: 'admin1',
        email: 'admin@gmail.com',
        password: 'admin0123', // In production this must be hashed
        role: 'Admin',
        status: 'Active',
        createdAt: new Date().toISOString()
      }
    ]
    localStorage.setItem('rbac-users', JSON.stringify(defaultAdmin))
  }
}
