import React, { useState, useEffect } from 'react'

const Settings = () => {
  const [activeTab, setActiveTab] = useState('general')
  
  const [generalSettings, setGeneralSettings] = useState(() => {
    const saved = localStorage.getItem('rbac-general-settings')
    return saved ? JSON.parse(saved) : {
      siteName: 'RBAC Dashboard',
      timezone: 'UTC',
      language: 'English',
      dateFormat: 'MM/DD/YYYY'
    }
  })

  const [securitySettings, setSecuritySettings] = useState(() => {
    const saved = localStorage.getItem('rbac-security-settings')
    return saved ? JSON.parse(saved) : {
      sessionTimeout: '30',
      passwordExpiry: '90',
      twoFactorAuth: true,
      loginAttempts: '3',
      enforceStrongPassword: true
    }
  })

  const [notificationSettings, setNotificationSettings] = useState(() => {
    const saved = localStorage.getItem('rbac-notification-settings')
    return saved ? JSON.parse(saved) : {
      emailNotifications: true,
      securityAlerts: true,
      weeklyReport: false,
      userActivityAlerts: true
    }
  })

  const [backupSettings, setBackupSettings] = useState(() => {
    const saved = localStorage.getItem('rbac-backup-settings')
    return saved ? JSON.parse(saved) : {
      autoBackup: true,
      backupFrequency: 'daily',
      retentionDays: '30'
    }
  })

  // Auto-save to localStorage whenever settings change
  useEffect(() => {
    localStorage.setItem('rbac-general-settings', JSON.stringify(generalSettings))
  }, [generalSettings])

  useEffect(() => {
    localStorage.setItem('rbac-security-settings', JSON.stringify(securitySettings))
  }, [securitySettings])

  useEffect(() => {
    localStorage.setItem('rbac-notification-settings', JSON.stringify(notificationSettings))
  }, [notificationSettings])

  useEffect(() => {
    localStorage.setItem('rbac-backup-settings', JSON.stringify(backupSettings))
  }, [backupSettings])

  const handleGeneralChange = (key, value) => {
    setGeneralSettings({ ...generalSettings, [key]: value })
  }

  const handleSecurityChange = (key, value) => {
    setSecuritySettings({ ...securitySettings, [key]: value })
  }

  const handleNotificationChange = (key, value) => {
    setNotificationSettings({ ...notificationSettings, [key]: value })
  }

  const handleBackupChange = (key, value) => {
    setBackupSettings({ ...backupSettings, [key]: value })
  }

  const handleSaveSettings = () => {
    // Save all settings to localStorage
    localStorage.setItem('rbac-general-settings', JSON.stringify(generalSettings))
    localStorage.setItem('rbac-security-settings', JSON.stringify(securitySettings))
    localStorage.setItem('rbac-notification-settings', JSON.stringify(notificationSettings))
    localStorage.setItem('rbac-backup-settings', JSON.stringify(backupSettings))
    alert('Settings saved successfully!')
  }

  const tabs = [
    { id: 'general', name: 'General' },
    { id: 'security', name: 'Security' },
    { id: 'notifications', name: 'Notifications' },
    { id: 'backup', name: 'Backup' }
  ]

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-800 mb-8">Settings</h1>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-md mb-8">
        <div className="flex border-b overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center px-6 py-4 font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.name}
            </button>
          ))}
        </div>
      </div>

      {/* General Settings */}
      {activeTab === 'general' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">General Settings</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Site Name</label>
              <input
                type="text"
                value={generalSettings.siteName}
                onChange={(e) => handleGeneralChange('siteName', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
              <select
                value={generalSettings.timezone}
                onChange={(e) => handleGeneralChange('timezone', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>UTC</option>
                <option>EST</option>
                <option>PST</option>
                <option>CST</option>
                <option>MST</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Language</label>
              <select
                value={generalSettings.language}
                onChange={(e) => handleGeneralChange('language', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>English</option>
                <option>Spanish</option>
                <option>French</option>
                <option>German</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date Format</label>
              <select
                value={generalSettings.dateFormat}
                onChange={(e) => handleGeneralChange('dateFormat', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>MM/DD/YYYY</option>
                <option>DD/MM/YYYY</option>
                <option>YYYY-MM-DD</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Security Settings */}
      {activeTab === 'security' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Security Settings</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Session Timeout (minutes)
              </label>
              <input
                type="number"
                value={securitySettings.sessionTimeout}
                onChange={(e) => handleSecurityChange('sessionTimeout', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password Expiry (days)
              </label>
              <input
                type="number"
                value={securitySettings.passwordExpiry}
                onChange={(e) => handleSecurityChange('passwordExpiry', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Login Attempts
              </label>
              <input
                type="number"
                value={securitySettings.loginAttempts}
                onChange={(e) => handleSecurityChange('loginAttempts', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center justify-between py-3 border-b">
              <div>
                <p className="font-medium text-gray-800">Two-Factor Authentication</p>
                <p className="text-sm text-gray-600">Require 2FA for all users</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={securitySettings.twoFactorAuth}
                  onChange={(e) => handleSecurityChange('twoFactorAuth', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-gray-800">Enforce Strong Password</p>
                <p className="text-sm text-gray-600">Require complex passwords</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={securitySettings.enforceStrongPassword}
                  onChange={(e) => handleSecurityChange('enforceStrongPassword', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Notification Settings */}
      {activeTab === 'notifications' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Notification Settings</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b">
              <div>
                <p className="font-medium text-gray-800">Email Notifications</p>
                <p className="text-sm text-gray-600">Receive email notifications for important events</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationSettings.emailNotifications}
                  onChange={(e) => handleNotificationChange('emailNotifications', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between py-3 border-b">
              <div>
                <p className="font-medium text-gray-800">Security Alerts</p>
                <p className="text-sm text-gray-600">Get notified about security events</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationSettings.securityAlerts}
                  onChange={(e) => handleNotificationChange('securityAlerts', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between py-3 border-b">
              <div>
                <p className="font-medium text-gray-800">Weekly Report</p>
                <p className="text-sm text-gray-600">Receive weekly activity summary</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationSettings.weeklyReport}
                  onChange={(e) => handleNotificationChange('weeklyReport', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-gray-800">User Activity Alerts</p>
                <p className="text-sm text-gray-600">Notifications for unusual user activity</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationSettings.userActivityAlerts}
                  onChange={(e) => handleNotificationChange('userActivityAlerts', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Backup Settings */}
      {activeTab === 'backup' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Backup Settings</h2>
          <div className="space-y-6">
            <div className="flex items-center justify-between py-3 border-b">
              <div>
                <p className="font-medium text-gray-800">Automatic Backup</p>
                <p className="text-sm text-gray-600">Enable automatic data backups</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={backupSettings.autoBackup}
                  onChange={(e) => handleBackupChange('autoBackup', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Backup Frequency</label>
              <select
                value={backupSettings.backupFrequency}
                onChange={(e) => handleBackupChange('backupFrequency', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Retention Period (days)
              </label>
              <input
                type="number"
                value={backupSettings.retentionDays}
                onChange={(e) => handleBackupChange('retentionDays', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-4">Last Backup: December 29, 2025 at 08:00 AM</p>
              <button className="bg-green-500 text-white py-2 px-6 rounded-lg hover:bg-green-600 transition-colors">
                Backup Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="mt-8 flex justify-end">
        <button
          onClick={handleSaveSettings}
          className="bg-blue-500 text-white py-3 px-8 rounded-lg hover:bg-blue-600 transition-colors font-semibold"
        >
          Save Settings
        </button>
      </div>
    </div>
  )
}

export default Settings
