import React, { useState, useEffect, useCallback } from 'react'
import { Shield, AlertTriangle, Users, UserX, RefreshCw, ChevronDown, ChevronUp, Search, Server, Wifi, WifiOff, Plug, Unplug, Eye, EyeOff, XCircle, CheckCircle, Info, AlertCircle, X, Plus, Pencil, Trash2, UserPlus, UserMinus, Monitor } from 'lucide-react'
import api from '../utils/api'

const RISK_COLORS = {
  Critical: 'bg-red-100 text-red-800 border-red-200',
  High: 'bg-orange-100 text-orange-800 border-orange-200',
  Medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Low: 'bg-green-100 text-green-800 border-green-200',
  Info: 'bg-blue-100 text-blue-800 border-blue-200',
}

const RISK_BG = {
  Critical: 'bg-red-500',
  High: 'bg-orange-500',
  Medium: 'bg-yellow-500',
  Low: 'bg-green-500',
}

const createDefaultAdUserForm = (domain = '') => ({
  first_name: '',
  last_name: '',
  initials: '',
  full_name: '',
  user_logon_name: '',
  sam_account_name: '',
  upn_suffix: domain,
  password: '',
  description: '',
  enabled: true,
  user_must_change_password_next_logon: false,
  user_cannot_change_password: false,
  password_never_expires: false,
  logon_to_all_computers: true,
  logon_workstations: [],
  ou_dn: '',
})

const ADScanner = () => {
  // ── Connection state ──
  const [connection, setConnection] = useState(null)          // { connected, config }
  const [connectionLoading, setConnectionLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [connForm, setConnForm] = useState({
    server: '',
    port: 389,
    use_ssl: false,
    use_start_tls: false,
    base_dn: '',
    bind_user: '',
    bind_password: '',
    domain: '',
  })

  // ── SSE Notification Stream ──
  useEffect(() => {
    if (!connection?.connected) return

    let eventSource = null

    // Optionally delay stream start for better UX
    const timer = setTimeout(() => {
      const token = localStorage.getItem('rbac-token')
      if (!token) return

      eventSource = new EventSource(`/api/ad-scanner/notifications/stream?token=${token}`)
      eventSource.onmessage = () => {
        // You can handle notifications here, e.g.:
        // showNotification('info', event.data)
      }
      eventSource.onerror = () => {
        // Keep failures isolated to AD Scanner only.
        if (eventSource) eventSource.close()
      }
    }, 1000) // 1s delay for UI render

    return () => {
      clearTimeout(timer)
      if (eventSource) eventSource.close()
    }
  }, [connection?.connected])

  // ── Notification / Confirm state ──
  const [notification, setNotification] = useState(null)   // { type: 'error'|'success'|'warning'|'info', message }
  const [confirmDialog, setConfirmDialog] = useState(null) // { message, onConfirm }
  const [showAdUserPassword, setShowAdUserPassword] = useState(false)

  const showNotification = useCallback((type, message) => {
    setNotification({ type, message })
  }, [])

  const showConfirm = useCallback((message) => {
    return new Promise(resolve => {
      setConfirmDialog({ message, onConfirm: resolve })
    })
  }, [])

  // ── Scanner state ──
  const [scanData, setScanData] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [filterRisk, setFilterRisk] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedUser, setExpandedUser] = useState(null)
  const [adGroups, setAdGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const [expandedGroup, setExpandedGroup] = useState(null)

  // ── OUs ──
  const [ous, setOus] = useState([])
  const [ousLoading, setOusLoading] = useState(false)
  const [ouSearch, setOuSearch] = useState('')

  // ── Computers ──
  const [computers, setComputers] = useState([])
  const [computersLoading, setComputersLoading] = useState(false)
  const [computerSearch, setComputerSearch] = useState('')
  const [computerFilter, setComputerFilter] = useState('All')

  // ── CRUD: User ──
  const [showUserModal, setShowUserModal] = useState(false)
  const [userModalMode, setUserModalMode] = useState('create')
  const [userForm, setUserForm] = useState(createDefaultAdUserForm())
  const [upnSuffixOptions, setUpnSuffixOptions] = useState([])
  const [editingUserSam, setEditingUserSam] = useState(null)
  const [showGroupAssignModal, setShowGroupAssignModal] = useState(false)
  const [groupAssignUser, setGroupAssignUser] = useState(null)
  const [groupAssignAction, setGroupAssignAction] = useState('add')
  const [selectedGroupDn, setSelectedGroupDn] = useState('')

  // ── CRUD: Group ──
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false)
  const [createGroupForm, setCreateGroupForm] = useState({ name: '', scope: 'Global', group_type: 'Security', description: '', ou_dn: '' })
  const [showEditGroupModal, setShowEditGroupModal] = useState(false)
  const [editGroupForm, setEditGroupForm] = useState({ name: '', scope: 'Global', group_type: 'Security', description: '' })
  const [editGroupCn, setEditGroupCn] = useState('')

  // ── CRUD: OU ──
  const [showOuModal, setShowOuModal] = useState(false)
  const [ouForm, setOuForm] = useState({ name: '', description: '', parent_dn: '' })
  const [showEditOuModal, setShowEditOuModal] = useState(false)
  const [editOuForm, setEditOuForm] = useState({ name: '', description: '' })
  const [editOuDn, setEditOuDn] = useState('')

  // ── CRUD: Computer ──
  const [showComputerModal, setShowComputerModal] = useState(false)
  const [computerForm, setComputerForm] = useState({ name: '', ou_dn: '', description: '' })
  const [showEditComputerModal, setShowEditComputerModal] = useState(false)
  const [editComputerForm, setEditComputerForm] = useState({ name: '', dns_hostname: '', os: '', os_version: '', description: '', enabled: true })
  const [editComputerCn, setEditComputerCn] = useState('')

  // ── Domain Controllers ──
  const [dcs, setDcs] = useState([])
  const [dcsLoading, setDcsLoading] = useState(false)

  // ── Password Reset ──
  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false)
  const [passwordResetUser, setPasswordResetUser] = useState(null)
  const [resetPasswordForm, setResetPasswordForm] = useState({ new_password: '', confirm_password: '' })
  const [showResetPassword, setShowResetPassword] = useState(false)
  const [showConfirmResetPassword, setShowConfirmResetPassword] = useState(false)
  const [resetPasswordError, setResetPasswordError] = useState('')

  const preWindowsDomainPrefix = `${(connection?.config?.domain || 'mylab').split('.')[0].toUpperCase()}\\`
  const resolvedUpnSuffixOptions = upnSuffixOptions.length > 0
    ? upnSuffixOptions
    : [connection?.config?.domain || 'mylab.local']

  const normalizeUpnSuffixes = useCallback((values = [], fallback = '') => {
    const unique = new Set()
    values.forEach((value) => {
      const cleaned = String(value || '').trim().toLowerCase()
      if (cleaned) unique.add(cleaned)
    })
    const fallbackCleaned = String(fallback || '').trim().toLowerCase()
    if (fallbackCleaned) unique.add(fallbackCleaned)
    if (unique.size === 0) unique.add('mylab.local')
    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  }, [])

  useEffect(() => {
    const hasOpenBox = Boolean(
      notification ||
      confirmDialog ||
      showUserModal ||
      showGroupAssignModal ||
      showCreateGroupModal ||
      showEditGroupModal ||
      showOuModal ||
      showEditOuModal ||
      showComputerModal ||
      showEditComputerModal ||
      showPasswordResetModal
    )
    if (!hasOpenBox) return

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()

      if (confirmDialog) {
        confirmDialog.onConfirm(false)
        setConfirmDialog(null)
        return
      }
      if (showPasswordResetModal) {
        setShowPasswordResetModal(false)
        return
      }
      if (showEditComputerModal) {
        setShowEditComputerModal(false)
        return
      }
      if (showComputerModal) {
        setShowComputerModal(false)
        return
      }
      if (showEditOuModal) {
        setShowEditOuModal(false)
        return
      }
      if (showOuModal) {
        setShowOuModal(false)
        return
      }
      if (showEditGroupModal) {
        setShowEditGroupModal(false)
        return
      }
      if (showCreateGroupModal) {
        setShowCreateGroupModal(false)
        return
      }
      if (showGroupAssignModal) {
        setShowGroupAssignModal(false)
        return
      }
      if (showUserModal) {
        setShowUserModal(false)
        return
      }
      if (notification) {
        setNotification(null)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    notification,
    confirmDialog,
    showUserModal,
    showGroupAssignModal,
    showCreateGroupModal,
    showEditGroupModal,
    showOuModal,
    showEditOuModal,
    showComputerModal,
    showEditComputerModal,
    showPasswordResetModal,
  ])

  const formatScanTimestamp = (value) => {
    if (!value) return '-'
    return String(value).replace(/\.\d+$/, '')
  }

  useEffect(() => {
    fetchConnectionStatus()
    fetchLatestScan()
  }, [])

  // ── Connection helpers ──
  const fetchConnectionStatus = async () => {
    try {
      const { data } = await api.get('/ad-scanner/connection')
      setConnection(data)
      const connectionDomain = data?.config?.domain || ''
      if (data.config) {
        setConnForm(prev => ({
          ...prev,
          server: data.config.server || '',
          port: data.config.port || 389,
          use_ssl: data.config.use_ssl || false,
          use_start_tls: false,
          base_dn: data.config.base_dn || '',
          bind_user: data.config.bind_user || '',
          domain: data.config.domain || '',
        }))
      }
      await fetchUpnSuffixes(connectionDomain)
    } catch (err) { console.error('Connection status check failed:', err) }
    finally { setConnectionLoading(false) }
  }

  const fetchUpnSuffixes = useCallback(async (fallbackDomain = '') => {
    try {
      const { data } = await api.get('/ad-scanner/upn-suffixes')
      const options = normalizeUpnSuffixes(
        data?.suffixes || [],
        data?.default_suffix || fallbackDomain || connection?.config?.domain || ''
      )
      setUpnSuffixOptions(options)
      return options
    } catch (err) {
      const options = normalizeUpnSuffixes([], fallbackDomain || connection?.config?.domain || '')
      setUpnSuffixOptions(options)
      return options
    }
  }, [connection?.config?.domain, normalizeUpnSuffixes])

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const payload = {
        ...connForm,
        port: connForm.use_ssl ? 636 : 389,
      }
      const { data } = await api.post('/ad-scanner/test-connection', payload)
      setTestResult(data)
    } catch (err) {
      setTestResult({ success: false, message: err.response?.data?.detail || err.message })
    }
    finally { setTesting(false) }
  }

  const handleConnect = async () => {
    setConnecting(true)
    setTestResult(null)
    try {
      const payload = {
        ...connForm,
        port: connForm.use_ssl ? 636 : 389,
      }
      const { data } = await api.post('/ad-scanner/connect', payload)
      if (data.success) {
        setConnection({ connected: true, config: payload })
        await fetchUpnSuffixes(payload.domain || '')
        setTestResult({ success: true, message: data.message })
      } else {
        setTestResult({ success: false, message: data.message })
      }
    } catch (err) {
      setTestResult({ success: false, message: err.response?.data?.detail || err.message })
    }
    finally { setConnecting(false) }
  }

  const handleDisconnect = async () => {
    const confirmed = await showConfirm('Disconnect from Active Directory?')
    if (!confirmed) return
    try {
      await api.post('/ad-scanner/disconnect')
      setConnection({ connected: false, config: null })
      setUpnSuffixOptions(['mylab.local'])
      setConnForm({ server: '', port: 389, use_ssl: false, use_start_tls: false, base_dn: '', bind_user: '', bind_password: '', domain: '' })
      setTestResult(null)
    } catch (err) { showNotification('error', 'Failed to disconnect') }
  }

  const isConnected = connection?.connected

  const fetchLatestScan = async () => {
    try {
      const { data } = await api.get('/ad-scanner/latest')
      if (data.scan) setScanData(data)
    } catch (err) { console.error('Failed to fetch latest scan:', err) }
  }

  const fetchAdGroups = async () => {
    setGroupsLoading(true)
    try {
      const { data } = await api.get('/ad-scanner/groups')
      setAdGroups(data.groups || [])
    } catch (err) { console.error('Failed to fetch AD groups:', err) }
    finally { setGroupsLoading(false) }
  }

  const fetchOus = async () => {
    setOusLoading(true)
    try {
      const { data } = await api.get('/ad-scanner/ous')
      setOus(data.ous || [])
    } catch (err) { console.error('Failed to fetch OUs:', err) }
    finally { setOusLoading(false) }
  }

  const fetchComputers = async () => {
    setComputersLoading(true)
    try {
      const { data } = await api.get('/ad-scanner/computers')
      setComputers(data.computers || [])
    } catch (err) { console.error('Failed to fetch computers:', err) }
    finally { setComputersLoading(false) }
  }

  const fetchDcs = async () => {
    setDcsLoading(true)
    try {
      const { data } = await api.get('/ad-scanner/domain-controllers')
      setDcs(data.dcs || [])
    } catch (err) { console.error('Failed to fetch DCs:', err) }
    finally { setDcsLoading(false) }
  }

  useEffect(() => {
    if (activeTab === 'groups') fetchAdGroups()
    if (activeTab === 'ous') fetchOus()
    if (activeTab === 'computers') fetchComputers()
    if (activeTab === 'dcs') fetchDcs()
  }, [activeTab]) // eslint-disable-line

  const handleRunScan = async () => {
    setScanning(true)
    try {
      await api.post('/ad-scanner/scan')
      await fetchLatestScan()
    } catch (err) { showNotification('error', 'Scan failed: ' + (err.response?.data?.detail || err.message)) }
    finally { setScanning(false) }
  }

  // ══════════════════════════════════════
  // CRUD Handlers
  // ══════════════════════════════════════

  // ── User CRUD ──
  const openCreateUser = () => {
    setUserModalMode('create')
    const defaultSuffix = resolvedUpnSuffixOptions[0] || connection?.config?.domain || ''
    setUserForm(createDefaultAdUserForm(defaultSuffix))
    setShowAdUserPassword(false)
    setShowUserModal(true)
    if (computers.length === 0 && !computersLoading) fetchComputers()
  }

  const openEditUser = async (user) => {
    if (isSystemAccount(user?.sam_account_name)) {
      showNotification('error', `System AD account '${user.sam_account_name}' cannot be edited`)
      return
    }
    setUserModalMode('edit')
    setEditingUserSam(user.sam_account_name)
    const initialSuffix = user.upn_suffix || connection?.config?.domain || ''
    setUpnSuffixOptions(prev => normalizeUpnSuffixes(prev, initialSuffix))
    setUserForm({
      first_name: user.display_name?.split(' ')[0] || '',
      last_name: user.display_name?.split(' ').slice(1).join(' ') || '',
      initials: '',
      full_name: user.display_name || '',
      user_logon_name: user.user_logon_name || user.email?.split('@')[0] || user.sam_account_name || '',
      sam_account_name: user.sam_account_name || '',
      upn_suffix: user.upn_suffix || connection?.config?.domain || '',
      password: '',
      description: user.description || '',
      enabled: user.enabled,
      user_must_change_password_next_logon: !!user.user_must_change_password_next_logon,
      user_cannot_change_password: !!user.user_cannot_change_password,
      password_never_expires: user.password_never_expires || false,
      logon_to_all_computers: user.logon_to_all_computers !== false,
      logon_workstations: Array.isArray(user.logon_workstations) ? user.logon_workstations : [],
      ou_dn: '',
    })
    setShowAdUserPassword(false)
    setShowUserModal(true)
    if (computers.length === 0 && !computersLoading) fetchComputers()

    try {
      const { data } = await api.get(`/ad-scanner/users/${user.sam_account_name}`)
      setUpnSuffixOptions(prev => normalizeUpnSuffixes(prev, data.upn_suffix || connection?.config?.domain || ''))
      setUserForm(prev => ({
        ...prev,
        first_name: data.first_name || prev.first_name,
        last_name: data.last_name || prev.last_name,
        initials: data.initials || prev.initials,
        full_name: data.full_name || prev.full_name,
        user_logon_name: data.user_logon_name || prev.user_logon_name,
        sam_account_name: data.pre_windows_logon_name || data.sam_account_name || prev.sam_account_name,
        upn_suffix: data.upn_suffix || prev.upn_suffix,
        description: data.description ?? prev.description,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : prev.enabled,
        user_must_change_password_next_logon: typeof data.user_must_change_password_next_logon === 'boolean' ? data.user_must_change_password_next_logon : prev.user_must_change_password_next_logon,
        user_cannot_change_password: typeof data.user_cannot_change_password === 'boolean' ? data.user_cannot_change_password : prev.user_cannot_change_password,
        password_never_expires: typeof data.password_never_expires === 'boolean' ? data.password_never_expires : prev.password_never_expires,
        logon_to_all_computers: typeof data.logon_to_all_computers === 'boolean' ? data.logon_to_all_computers : prev.logon_to_all_computers,
        logon_workstations: Array.isArray(data.logon_workstations) ? data.logon_workstations : prev.logon_workstations,
      }))
    } catch (err) {
      console.error('Failed to load AD user details:', err)
    }
  }

  const handleSaveUser = async (e) => {
    e.preventDefault()
    try {
      if (userModalMode === 'create') {
        const payload = {
          ...userForm,
          sam_account_name: userForm.sam_account_name || userForm.user_logon_name,
          pre_windows_logon_name: userForm.sam_account_name || userForm.user_logon_name,
        }
        await api.post('/ad-scanner/users', payload)
        showNotification('success', `User '${payload.sam_account_name}' created successfully`)
      } else {
        const payload = {
          first_name: userForm.first_name || undefined,
          last_name: userForm.last_name || undefined,
          initials: userForm.initials || undefined,
          display_name: userForm.full_name || undefined,
          email: userForm.email || undefined,
          user_logon_name: userForm.user_logon_name || undefined,
          pre_windows_logon_name: userForm.sam_account_name || undefined,
          upn_suffix: userForm.upn_suffix || undefined,
          description: userForm.description,
          enabled: userForm.enabled,
          user_must_change_password_next_logon: userForm.user_must_change_password_next_logon,
          user_cannot_change_password: userForm.user_cannot_change_password,
          password_never_expires: userForm.password_never_expires,
          logon_to_all_computers: userForm.logon_to_all_computers,
          logon_workstations: userForm.logon_workstations,
        }
        await api.put(`/ad-scanner/users/${editingUserSam}`, {
          ...payload,
        })
        showNotification('success', `User '${editingUserSam}' updated successfully`)
      }
      setShowUserModal(false)
      setUserForm(createDefaultAdUserForm(connection?.config?.domain || ''))
      await handleRunScan()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Operation failed')
    }
  }

  const handleDeleteUser = async (sam) => {
    if (isSystemAccount(sam)) {
      showNotification('error', `System AD account '${sam}' cannot be deleted`)
      return
    }
    const confirmed = await showConfirm(`Delete user '${sam}' from Active Directory? This cannot be undone.`)
    if (!confirmed) return
    try {
      await api.delete(`/ad-scanner/users/${sam}`)
      showNotification('success', `User '${sam}' deleted`)
      await handleRunScan()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Delete failed')
    }
  }

  const openPasswordReset = (user) => {
    if (isSystemAccount(user?.sam_account_name)) {
      showNotification('error', `Password reset is blocked for system AD account '${user.sam_account_name}'`)
      return
    }
    setPasswordResetUser(user)
    setResetPasswordForm({ new_password: '', confirm_password: '' })
    setShowResetPassword(false)
    setShowConfirmResetPassword(false)
    setResetPasswordError('')
    setShowPasswordResetModal(true)
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    setResetPasswordError('')

    if (!resetPasswordForm.new_password || !resetPasswordForm.confirm_password) {
      setResetPasswordError('Both password fields are required')
      return
    }

    if (resetPasswordForm.new_password !== resetPasswordForm.confirm_password) {
      setResetPasswordError('Passwords do not match')
      return
    }

    if (resetPasswordForm.new_password.length < 8) {
      setResetPasswordError('Password must be at least 8 characters long')
      return
    }

    if (!/[A-Z]/.test(resetPasswordForm.new_password) || !/[a-z]/.test(resetPasswordForm.new_password) || 
        !/[0-9]/.test(resetPasswordForm.new_password) || !/[^A-Za-z0-9]/.test(resetPasswordForm.new_password)) {
      setResetPasswordError('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
      return
    }

    try {
      await api.post(`/ad-scanner/users/${passwordResetUser.sam_account_name}/reset-password`, {
        sam_account_name: passwordResetUser.sam_account_name,
        new_password: resetPasswordForm.new_password
      })
      showNotification('success', `Password reset successfully for user '${passwordResetUser.sam_account_name}'`)
      setShowPasswordResetModal(false)
      setPasswordResetUser(null)
      setResetPasswordForm({ new_password: '', confirm_password: '' })
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Password reset failed')
    }
  }

  const openGroupAssign = (user, action) => {
    setGroupAssignUser(user)
    setGroupAssignAction(action)
    setSelectedGroupDn('')
    if (adGroups.length === 0) fetchAdGroups()
    setShowGroupAssignModal(true)
  }

  const handleGroupAssign = async () => {
    if (!selectedGroupDn || !groupAssignUser) return
    try {
      const endpoint = groupAssignAction === 'add' ? 'add-to-group' : 'remove-from-group'
      await api.post(`/ad-scanner/users/${groupAssignUser.sam_account_name}/${endpoint}`, { group_dn: selectedGroupDn })
      showNotification('success', `User ${groupAssignAction === 'add' ? 'added to' : 'removed from'} group`)
      setShowGroupAssignModal(false)
      await handleRunScan()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Failed')
    }
  }

  // ── Group CRUD ──
  const handleCreateGroup = async (e) => {
    e.preventDefault()
    try {
      await api.post('/ad-scanner/groups/create', createGroupForm)
      showNotification('success', `Group '${createGroupForm.name}' created`)
      setShowCreateGroupModal(false)
      setCreateGroupForm({ name: '', scope: 'Global', group_type: 'Security', description: '', ou_dn: '' })
      await fetchAdGroups()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Create failed')
    }
  }

  const handleUpdateGroup = async (e) => {
    e.preventDefault()
    try {
      await api.put(`/ad-scanner/groups/${editGroupCn}`, editGroupForm)
      showNotification('success', `Group '${editGroupForm.name || editGroupCn}' updated`)
      setShowEditGroupModal(false)
      await fetchAdGroups()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Update failed')
    }
  }

  const handleDeleteGroup = async (cn) => {
    const confirmed = await showConfirm(`Delete group '${cn}'? This cannot be undone.`)
    if (!confirmed) return
    try {
      await api.delete(`/ad-scanner/groups/${cn}`)
      showNotification('success', `Group '${cn}' deleted`)
      await fetchAdGroups()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Delete failed')
    }
  }

  // ── OU CRUD ──
  const handleCreateOu = async (e) => {
    e.preventDefault()
    try {
      await api.post('/ad-scanner/ous/create', ouForm)
      showNotification('success', `OU '${ouForm.name}' created`)
      setShowOuModal(false)
      setOuForm({ name: '', description: '', parent_dn: '' })
      await fetchOus()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Create failed')
    }
  }

  const handleUpdateOu = async (e) => {
    e.preventDefault()
    try {
      await api.put(`/ad-scanner/ous/update?dn=${encodeURIComponent(editOuDn)}&description=${encodeURIComponent(editOuForm.description)}&name=${encodeURIComponent(editOuForm.name || '')}`)
      showNotification('success', 'OU updated')
      setShowEditOuModal(false)
      await fetchOus()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Update failed')
    }
  }

  const handleDeleteOu = async (dn, name) => {
    const confirmed = await showConfirm(`Delete OU '${name}'? It must be empty.`)
    if (!confirmed) return
    try {
      await api.delete(`/ad-scanner/ous/delete?dn=${encodeURIComponent(dn)}`)
      showNotification('success', `OU '${name}' deleted`)
      await fetchOus()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Delete failed')
    }
  }

  // ── Computer CRUD ──
  const handleCreateComputer = async (e) => {
    e.preventDefault()
    try {
      await api.post('/ad-scanner/computers/create', computerForm)
      showNotification('success', `Computer '${computerForm.name}' created`)
      setShowComputerModal(false)
      setComputerForm({ name: '', ou_dn: '', description: '' })
      await fetchComputers()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Create failed')
    }
  }

  const handleUpdateComputer = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        description: editComputerForm.description,
        enabled: editComputerForm.enabled,
      }
      await api.put(`/ad-scanner/computers/${editComputerCn}`, payload)
      showNotification('success', `Computer '${editComputerCn}' updated`)
      setShowEditComputerModal(false)
      await fetchComputers()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Update failed')
    }
  }

  const handleDeleteComputer = async (cn) => {
    const confirmed = await showConfirm(`Delete computer '${cn}'? This cannot be undone.`)
    if (!confirmed) return
    try {
      await api.delete(`/ad-scanner/computers/${cn}`)
      showNotification('success', `Computer '${cn}' deleted`)
      await fetchComputers()
    } catch (err) {
      showNotification('error', err.response?.data?.detail || 'Delete failed')
    }
  }

  const scan = scanData?.scan
  const users = scanData?.users || []
  const riskBreakdown = scanData?.risk_breakdown || []
  const riskLevels = scanData?.risk_levels || {}
  const currentConnectionSource = !isConnected
    ? String(scan?.scan_source || 'LDAP').toUpperCase()
    : (connection?.config?.use_ssl || Number(connection?.config?.port) === 636)
      ? 'LDAPS'
      : (connection?.config?.use_start_tls ? 'STARTTLS' : 'LDAP')

  const SYSTEM_ACCOUNTS = ['guest', 'krbtgt']
  const isSystemAccount = (sam) => SYSTEM_ACCOUNTS.includes(String(sam || '').toLowerCase())
  const filteredUsers = users.filter(u => {
    const matchesRisk = filterRisk === 'All' || u.risk_level === filterRisk
    const matchesSearch = !searchQuery ||
      u.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.sam_account_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesRisk && matchesSearch
  }).sort((a, b) => {
    const aSystem = SYSTEM_ACCOUNTS.includes(a.sam_account_name?.toLowerCase())
    const bSystem = SYSTEM_ACCOUNTS.includes(b.sam_account_name?.toLowerCase())
    if (aSystem && !bSystem) return 1
    if (!aSystem && bSystem) return -1
    return 0
  })

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'AD Users' },
    { id: 'groups', label: 'AD Groups' },
    { id: 'ous', label: 'Org Units' },
    { id: 'computers', label: 'Computers' },
    { id: 'dcs', label: 'Domain Controllers' },
    { id: 'risks', label: 'Risk Analysis' },
  ]

  // ── Loading state ──
  if (connectionLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    )
  }

  // ── Notification config ──
  const notificationConfig = {
    error:   { icon: XCircle,       bg: 'bg-[#1f1f1f]',  border: 'border-red-500/60',    icon_color: 'text-red-500',    title: 'Error' },
    success: { icon: CheckCircle,   bg: 'bg-[#1f1f1f]',  border: 'border-green-500/60',  icon_color: 'text-green-500',  title: 'Success' },
    warning: { icon: AlertCircle,   bg: 'bg-[#1f1f1f]',  border: 'border-yellow-500/60', icon_color: 'text-yellow-500', title: 'Warning' },
    info:    { icon: Info,          bg: 'bg-[#1f1f1f]',  border: 'border-blue-500/60',   icon_color: 'text-blue-500',   title: 'Information' },
  }

  return (
    <div>
      {/* Custom Notification Modal */}
      {notification && (() => {
        const cfg = notificationConfig[notification.type] || notificationConfig.info
        const Icon = cfg.icon
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setNotification(null)} />
            <div className={`relative z-10 w-full max-w-md mx-4 rounded-2xl shadow-2xl border-2 ${cfg.bg} ${cfg.border} p-6`}>
              <div className="flex items-start gap-4">
                <div className={`flex-shrink-0 mt-0.5 ${cfg.icon_color}`}>
                  <Icon className="w-7 h-7" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-white mb-1">{cfg.title}</h3>
                  <p className="text-sm text-gray-300 break-words">{notification.message}</p>
                </div>
                <button
                  onClick={() => setNotification(null)}
                  className="flex-shrink-0 text-gray-400 hover:text-gray-200 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  onClick={() => setNotification(null)}
                  className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Custom Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl shadow-2xl border-2 bg-white border-gray-200 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 mt-0.5 text-yellow-500">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-gray-800 mb-1">Confirm</h3>
                <p className="text-sm text-gray-600">{confirmDialog.message}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => { setConfirmDialog(null); confirmDialog.onConfirm(false) }}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmDialog(null); confirmDialog.onConfirm(true) }}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Active Directory Scanner</h1>
          {!isConnected && (
            <p className="text-gray-600 mt-1">
              Enter your domain controller details to scan domain users, detect risky accounts, and enforce access policies
            </p>
          )}
        </div>
        {isConnected && (
          <div className="flex gap-3 items-center">
            {connection?.connected && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm font-medium px-3 py-2 rounded-lg">
                <Wifi className="w-4 h-4" />
                Connected to {connection.config?.server}
                <button onClick={handleDisconnect} className="ml-2 text-green-500 hover:text-red-500 transition-colors" title="Disconnect">
                  <Unplug className="w-4 h-4" />
                </button>
              </div>
            )}
            <button
              onClick={handleRunScan}
              disabled={scanning}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning...' : 'Run AD Scan'}
            </button>
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────
          CONNECTION FORM (shown when NOT connected)
          ────────────────────────────────────────── */}
      {!isConnected && (
        <div className="max-w-5xl mx-auto">
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            {/* Form Body */}
            <div className="p-6 space-y-4">
              {/* Server Row */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Server IP / Hostname</label>
                <input
                  type="text"
                  placeholder="192.168.1.10 or dc.mylab.local"
                  value={connForm.server}
                  onChange={e => setConnForm({ ...connForm, server: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none transition"
                />
              </div>

              {/* Domain + Base DN Row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Domain Name</label>
                  <input
                    type="text"
                    placeholder="mylab.local"
                    value={connForm.domain}
                    onChange={e => setConnForm({ ...connForm, domain: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Base DN</label>
                  <input
                    type="text"
                    placeholder="DC=mylab,DC=local"
                    value={connForm.base_dn}
                    onChange={e => setConnForm({ ...connForm, base_dn: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none transition"
                  />
                </div>
              </div>

              {/* Username + Password */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Bind Username</label>
                  <input
                    type="text"
                    placeholder="MYLAB\Administrator or CN=Admin,CN=Users,DC=mylab,DC=local"
                    value={connForm.bind_user}
                    onChange={e => setConnForm({ ...connForm, bind_user: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Bind Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter password"
                      value={connForm.bind_password}
                      onChange={e => setConnForm({ ...connForm, bind_password: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Encryption Mode */}
              <div>
                <p className="text-sm font-semibold text-white">Encryption</p>
                <div className="flex items-center gap-3 mt-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={connForm.use_ssl}
                      onChange={e => setConnForm({
                        ...connForm,
                        use_ssl: e.target.checked,
                        use_start_tls: false,
                        port: e.target.checked ? 636 : 389,
                      })}
                    />
                    <div className="w-12 h-7 bg-[#3a3a3a] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-white rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                    <span className="absolute left-1 top-1 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></span>
                  </label>
                  <p className="text-sm text-gray-200">{connForm.use_ssl ? 'LDAPS / SSL (port 636)' : 'LDAP (no SSL, port 389)'}</p>
                </div>
                <p className="text-xs text-gray-500 mt-1">Port is auto-selected based on encryption: LDAP=389, LDAPS=636.</p>
                {!connForm.use_ssl && (
                  <p className="text-xs text-amber-600 mt-1">⚠ Without encryption, password operations (create user, reset password) will fail.</p>
                )}
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`rounded-lg p-4 flex items-start gap-3 ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  {testResult.success
                    ? <Wifi className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    : <WifiOff className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />}
                  <div>
                    <p className={`font-semibold text-sm ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
                      {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                    </p>
                    <p className={`text-sm mt-0.5 ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                      {testResult.message}
                    </p>
                  </div>
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleTestConnection}
                  disabled={testing || !connForm.server || !connForm.bind_user || !connForm.bind_password}
                  className="flex-1 bg-gray-100 text-gray-700 font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 border border-gray-200"
                >
                  {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={handleConnect}
                  disabled={connecting || !connForm.server || !connForm.bind_user || !connForm.bind_password || !connForm.base_dn}
                  className="flex-1 bg-blue-600 text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {connecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                  {connecting ? 'Connecting...' : 'Connect & Save'}
                </button>
              </div>


            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────
          SCANNER UI (shown when connected)
          ────────────────────────────────────────── */}
      {isConnected && (
      <>
      {/* Summary Cards */}
      {scan && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-2xl border shadow-md p-6 flex items-start justify-between" style={{ borderColor: 'var(--app-border-color)' }}>
            <div>
              <p className="text-blue-200 text-sm font-medium mb-2">Total AD Users</p>
              <p className="text-5xl leading-none font-bold text-blue-400">{scan.total_users}</p>
            </div>
            <div className="bg-[#1a3a5c] w-16 h-16 rounded-2xl flex-shrink-0 flex items-center justify-center">
              <Users className="w-7 h-7 text-blue-400" />
            </div>
          </div>
          <div className="bg-white rounded-2xl border shadow-md p-6 flex items-start justify-between" style={{ borderColor: 'var(--app-border-color)' }}>
            <div>
              <p className="text-blue-200 text-sm font-medium mb-2">High Risk Accounts</p>
              <p className="text-5xl leading-none font-bold text-red-500">{scan.high_risk_count}</p>
            </div>
            <div className="bg-[#4a2c35] w-16 h-16 rounded-2xl flex-shrink-0 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
          </div>
          <div className="bg-white rounded-2xl border shadow-md p-6 flex items-start justify-between" style={{ borderColor: 'var(--app-border-color)' }}>
            <div>
              <p className="text-blue-200 text-sm font-medium mb-2">Privileged Accounts</p>
              <p className="text-5xl leading-none font-bold text-orange-400">{scan.privileged_users}</p>
            </div>
            <div className="bg-[#4a3a2a] w-16 h-16 rounded-2xl flex-shrink-0 flex items-center justify-center">
              <Shield className="w-7 h-7 text-orange-400" />
            </div>
          </div>
          <div className="bg-white rounded-2xl border shadow-md p-6 flex items-start justify-between" style={{ borderColor: 'var(--app-border-color)' }}>
            <div>
              <p className="text-blue-200 text-sm font-medium mb-2">Stale Accounts</p>
              <p className="text-5xl leading-none font-bold text-gray-400">{scan.stale_accounts}</p>
            </div>
            <div className="bg-[#3a4045] w-16 h-16 rounded-2xl flex-shrink-0 flex items-center justify-center">
              <UserX className="w-7 h-7 text-gray-400" />
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-md mb-6">
        <div className="flex w-full border-b overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-fit px-4 py-4 text-center font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {!scan && !['groups','ous','computers','dcs'].includes(activeTab) && (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Scan Data Available</h3>
          <p className="text-gray-500 mb-6">Run your first AD scan to see domain users and risk analysis.</p>
          <button onClick={handleRunScan} disabled={scanning}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
            {scanning ? 'Scanning...' : 'Run First Scan'}
          </button>
        </div>
      )}

      {/* ─── Overview Tab ─── */}
      {activeTab === 'overview' && scan && (
        <div className="space-y-6">
          {/* Scan Info */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Last Scan Information</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-gray-500">Scan Time:</span><br /><strong>{formatScanTimestamp(scan.scan_timestamp)}</strong></div>
              <div>
                <span className="text-gray-500">Source:</span><br />
                <strong>{currentConnectionSource}</strong>
              </div>
              <div><span className="text-gray-500">Duration:</span><br /><strong>{scan.scan_duration_ms}ms</strong></div>
              <div><span className="text-gray-500">Enabled/Disabled:</span><br /><strong>{scan.enabled_users} / {scan.disabled_users}</strong></div>
            </div>
          </div>

          {/* Risk Breakdown Table */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Risk Breakdown</h2>
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left py-3 px-4 text-gray-600 font-semibold">Risk Type</th>
                  <th className="text-left py-3 px-4 text-gray-600 font-semibold">Count</th>
                  <th className="text-left py-3 px-4 text-gray-600 font-semibold">Severity</th>
                </tr>
              </thead>
              <tbody>
                {riskBreakdown.map((item, idx) => (
                  <tr key={idx} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-800">{item.risk_type}</td>
                    <td className="py-3 px-4">
                      <span className="text-2xl font-bold text-gray-800">{item.count}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${RISK_COLORS[item.severity] || RISK_COLORS.Info}`}>
                        {item.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* ─── AD Users Tab ─── */}
      {activeTab === 'users' && scan && (
        <div>
          {/* Filters */}
          <div className="bg-[#1f1f1f] rounded-lg shadow-md p-4 mb-6">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text" placeholder="Search by name, username, or email..."
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-[#3a3a3a] rounded-lg bg-[#323232] text-[#9c9c9c] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white"
                />
              </div>
              <select value={filterRisk} onChange={e => setFilterRisk(e.target.value)}
                className="px-4 py-2.5 border border-[#3a3a3a] rounded-lg bg-[#1f1f1f] text-[#9c9c9c] focus:outline-none focus:ring-2 focus:ring-white">
                <option value="All">All Risk Levels</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <button onClick={openCreateUser}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 transition-colors">
                <Plus className="w-4 h-4" /> Add User
              </button>
            </div>
            <div className="mt-2 text-sm text-gray-500">
              Showing {filteredUsers.length} of {users.length} users
            </div>
          </div>

          {/* Users List */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Last Logon</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Risk</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Flags</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredUsers.map((user, idx) => {
                  const protectedAccount = isSystemAccount(user.sam_account_name)
                  return (
                  <React.Fragment key={idx}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedUser(expandedUser === idx ? null : idx)}>
                      <td className="py-3 px-4">
                        <div className="flex items-center">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm mr-3 ${
                            user.is_privileged ? 'bg-red-500' : user.enabled ? 'bg-blue-500' : 'bg-gray-400'
                          }`}>
                            {user.display_name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{user.display_name}</p>
                            <p className="text-xs text-gray-500">{user.sam_account_name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          user.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {user.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        {user.is_privileged && (
                          <span className="ml-1 px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                            Privileged
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {user.last_logon ? new Date(user.last_logon).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${RISK_COLORS[user.risk_level] || RISK_COLORS.Low}`}>
                          {user.risk_level}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-gray-600">{user.risk_flags?.length || 0} flags</span>
                      </td>
                      <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3">
                          <button onClick={() => !protectedAccount && openPasswordReset(user)} title={protectedAccount ? 'System account password reset is blocked' : 'Reset password'}
                            disabled={protectedAccount}
                            className={`transition-colors ${protectedAccount ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-orange-600'}`}>
                            <AlertCircle className="w-4 h-4" />
                          </button>
                          <button onClick={() => !protectedAccount && openEditUser(user)} title={protectedAccount ? 'System account edit is blocked' : 'Edit user'}
                            disabled={protectedAccount}
                            className={`transition-colors ${protectedAccount ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-blue-600'}`}>
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => !protectedAccount && handleDeleteUser(user.sam_account_name)} title={protectedAccount ? 'System account delete is blocked' : 'Delete user'}
                            disabled={protectedAccount}
                            className={`transition-colors ${protectedAccount ? 'text-gray-300 cursor-not-allowed' : 'text-red-500 hover:text-red-700'}`}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {expandedUser === idx ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </td>
                    </tr>
                    {expandedUser === idx && (
                      <tr>
                        <td colSpan={7} className="bg-gray-50 px-6 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-gray-500">Email</p>
                              <p className="font-medium">{user.email || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Password Last Set</p>
                              <p className="font-medium">
                                {user.password_last_set ? new Date(user.password_last_set).toLocaleDateString() : 'Unknown'}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">Password Never Expires</p>
                              <p className={`font-medium ${user.password_never_expires ? 'text-red-600' : 'text-green-600'}`}>
                                {user.password_never_expires ? 'Yes ⚠️' : 'No ✓'}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">Description</p>
                              <p className="font-medium">{user.description || <span className="text-red-500">Blank ⚠️</span>}</p>
                            </div>
                            <div className="md:col-span-2">
                              <p className="text-gray-500 mb-1">Group Memberships</p>
                              <div className="flex flex-wrap gap-1">
                                {(user.member_of || []).map((group, gIdx) => (
                                  <span key={gIdx} className={`px-2 py-1 text-xs rounded-full ${
                                    ['Domain Admins', 'Enterprise Admins', 'Administrators', 'Backup Operators'].includes(group)
                                      ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                                  }`}>
                                    {group}
                                  </span>
                                ))}
                              </div>
                              <div className="flex gap-2 mt-2">
                                <button onClick={() => openGroupAssign(user, 'add')}
                                  className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors">
                                  <UserPlus className="w-3 h-3" /> Add to Group
                                </button>
                                {(user.member_of || []).length > 0 && (
                                  <button onClick={() => openGroupAssign(user, 'remove')}
                                    className="flex items-center gap-1 text-xs px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors">
                                    <UserMinus className="w-3 h-3" /> Remove from Group
                                  </button>
                                )}
                              </div>
                            </div>
                            {user.risk_flags?.length > 0 && (
                              <div className="md:col-span-2">
                                <p className="text-gray-500 mb-1">Risk Flags</p>
                                <div className="flex flex-wrap gap-1">
                                  {user.risk_flags.map((flag, fIdx) => (
                                    <span key={fIdx} className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700">
                                      ⚠ {flag}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── AD Groups Tab ─── */}
      {activeTab === 'groups' && (
        <div className="space-y-4">
          {groupsLoading ? (
            <div className="bg-white rounded-lg shadow-md p-12 flex items-center justify-center gap-3">
              <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
              <span className="text-gray-600 font-medium">Fetching groups from Active Directory...</span>
            </div>
          ) : (
            <>
              {/* Search + refresh bar */}
              <div className="bg-white rounded-lg shadow-md p-4 flex flex-col md:flex-row gap-4 items-center">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search groups by name or description..."
                    value={groupSearch}
                    onChange={e => setGroupSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-[#3a3a3a] rounded-lg bg-[#1f1f1f] text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white"
                  />
                </div>
                <button onClick={() => { setCreateGroupForm({ name: '', scope: 'Global', group_type: 'Security', description: '', ou_dn: '' }); setShowCreateGroupModal(true) }}
                  className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 transition-colors">
                  <Plus className="w-4 h-4" /> Add Group
                </button>
                <button
                  onClick={fetchAdGroups}
                  disabled={groupsLoading}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
              </div>

              {/* Groups table */}
              <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-800">Active Directory Groups</h2>
                  <span className="text-sm text-gray-500">
                    {adGroups.filter(g =>
                      !groupSearch ||
                      g.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
                      g.description?.toLowerCase().includes(groupSearch.toLowerCase())
                    ).length} groups
                  </span>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Group Name</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Scope</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Members</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Description</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Actions</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {adGroups
                      .filter(g =>
                        !groupSearch ||
                        g.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
                        g.description?.toLowerCase().includes(groupSearch.toLowerCase())
                      )
                      .map((group, idx) => (
                        <React.Fragment key={idx}>
                          <tr
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => setExpandedGroup(expandedGroup === idx ? null : idx)}
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                  <Users className="w-4 h-4 text-indigo-600" />
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">{group.name}</p>
                                  {group.sam_account_name && group.sam_account_name !== group.name && (
                                    <p className="text-xs text-gray-400">{group.sam_account_name}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                group.type === 'Security' ? 'bg-red-100 text-red-700' :
                                group.type === 'Distribution' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>{group.type}</span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                group.scope === 'Global' ? 'bg-green-100 text-green-700' :
                                group.scope === 'Universal' ? 'bg-purple-100 text-purple-700' :
                                group.scope === 'Domain Local' ? 'bg-orange-100 text-orange-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>{group.scope}</span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-800">
                                <Users className="w-3 h-3 text-gray-400" />
                                {group.member_count}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-500 max-w-xs">
                              <span className="line-clamp-1">
                                {group.description || <span className="italic text-gray-300">No description</span>}
                              </span>
                            </td>
                            <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-3">
                                <button onClick={() => {
                                  const normalizedScope = group.scope === 'Domain Local' ? 'DomainLocal' : (group.scope || 'Global')
                                  setEditGroupCn(group.name)
                                  setEditGroupForm({
                                    name: group.name || '',
                                    scope: normalizedScope,
                                    group_type: group.type || 'Security',
                                    description: group.description || '',
                                  })
                                  setShowEditGroupModal(true)
                                }}
                                  title="Edit group" className="text-gray-500 hover:text-blue-600 transition-colors">
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleDeleteGroup(group.name)}
                                  title="Delete group" className="text-red-500 hover:text-red-700 transition-colors">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {expandedGroup === idx
                                ? <ChevronUp className="w-4 h-4 text-gray-400" />
                                : <ChevronDown className="w-4 h-4 text-gray-400" />}
                            </td>
                          </tr>
                          {expandedGroup === idx && (
                            <tr>
                              <td colSpan={7} className="bg-[#252525] border-t border-[#2a2a2a] px-8 py-4">
                                <p className="text-xs font-semibold text-gray-400 uppercase mb-3">Members ({group.members.length})</p>
                                {group.members.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {group.members.map((m, mi) => (
                                      <span key={mi} className="px-3 py-1 text-xs font-medium bg-[#1f1f1f] border border-[#3a3a3a] text-gray-300 rounded-full">
                                        {m}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-400 italic">No members</p>
                                )}
                                <p className="text-xs text-gray-400 mt-3 font-mono truncate">{group.dn}</p>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                  </tbody>
                </table>
                {adGroups.length === 0 && !groupsLoading && (
                  <div className="p-12 text-center">
                    <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">No groups found</p>
                    <p className="text-gray-400 text-sm mt-1">Connect to AD and click Refresh to load groups</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Organizational Units Tab ─── */}
      {activeTab === 'ous' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-md p-4 flex flex-col md:flex-row gap-4 items-center">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search OUs by name or path..."
                value={ouSearch} onChange={e => setOuSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-white" />
            </div>
            <button onClick={() => { setOuForm({ name: '', description: '', parent_dn: '' }); setShowOuModal(true) }}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 transition-colors">
              <Plus className="w-4 h-4" /> Add OU
            </button>
            <button onClick={fetchOus} disabled={ousLoading}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors">
              <RefreshCw className={`w-4 h-4 ${ousLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Organizational Units</h2>
                <p className="text-sm text-gray-500 mt-0.5">Containers used to organise domain objects by department or function</p>
              </div>
              <span className="text-sm text-gray-500">{ous.filter(o => !ouSearch || o.name.toLowerCase().includes(ouSearch.toLowerCase()) || o.path.toLowerCase().includes(ouSearch.toLowerCase())).length} OUs</span>
            </div>
            {ousLoading ? (
              <div className="p-12 flex items-center justify-center gap-3">
                <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="text-gray-600">Loading organizational units...</span>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">OU Name</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Path</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Managed By</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Created</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {ous
                    .filter(o => !ouSearch || o.name.toLowerCase().includes(ouSearch.toLowerCase()) || o.path.toLowerCase().includes(ouSearch.toLowerCase()))
                    .map((ou, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <span className="text-yellow-600 font-bold text-xs">OU</span>
                            </div>
                            <span className="font-medium text-gray-900">{ou.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600 font-mono">{ou.path || '—'}</td>
                        <td className="py-3 px-4 text-sm text-gray-500">{ou.description || <span className="italic text-gray-300">None</span>}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">{ou.managed_by || <span className="italic text-gray-300">None</span>}</td>
                        <td className="py-3 px-4 text-sm text-gray-500">{ou.created ? ou.created.replace('T', ' ') : '—'}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <button onClick={() => {
                              setEditOuDn(ou.dn)
                              setEditOuForm({ name: ou.name || '', description: ou.description || '' })
                              setShowEditOuModal(true)
                            }}
                              title="Edit OU" className="text-gray-500 hover:text-blue-600 transition-colors">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteOu(ou.dn, ou.name)}
                              title="Delete OU" className="text-red-500 hover:text-red-700 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            {!ousLoading && ous.length === 0 && (
              <div className="p-12 text-center">
                <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <span className="text-yellow-600 font-bold">OU</span>
                </div>
                <p className="text-gray-500 font-medium">No OUs found</p>
                <p className="text-gray-400 text-sm mt-1">Your domain has no custom Organizational Units — all objects are in the default CN=Users/CN=Computers containers</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Computers Tab ─── */}
      {activeTab === 'computers' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-md p-4 flex flex-col md:flex-row gap-4 items-center">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input type="text" placeholder="Search by name, hostname, or OS..."
                value={computerSearch} onChange={e => setComputerSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-white" />
            </div>
            <select value={computerFilter} onChange={e => setComputerFilter(e.target.value)}
              className="px-4 py-2.5 border border-[#3a3a3a] rounded-lg bg-[#1f1f1f] text-[#9c9c9c] focus:outline-none focus:ring-2 focus:ring-white">
              <option value="All">All Status</option>
              <option value="Enabled">Enabled</option>
              <option value="Disabled">Disabled</option>
            </select>
            <button onClick={fetchComputers} disabled={computersLoading}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors">
              <RefreshCw className={`w-4 h-4 ${computersLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Domain Computers</h2>
                <p className="text-sm text-gray-500 mt-0.5">All workstations and servers joined to the domain</p>
              </div>
              <span className="text-sm text-gray-500">
                {computers.filter(c => {
                  const matchSearch = !computerSearch || c.name.toLowerCase().includes(computerSearch.toLowerCase()) || c.dns_hostname.toLowerCase().includes(computerSearch.toLowerCase()) || c.os.toLowerCase().includes(computerSearch.toLowerCase())
                  const matchFilter = computerFilter === 'All' || (computerFilter === 'Enabled' ? c.enabled : !c.enabled)
                  return matchSearch && matchFilter
                }).length} computers
              </span>
            </div>
            {computersLoading ? (
              <div className="p-12 flex items-center justify-center gap-3">
                <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="text-gray-600">Loading domain computers...</span>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Computer</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Operating System</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Last Seen</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {computers
                    .filter(c => {
                      const matchSearch = !computerSearch || c.name.toLowerCase().includes(computerSearch.toLowerCase()) || c.dns_hostname.toLowerCase().includes(computerSearch.toLowerCase()) || c.os.toLowerCase().includes(computerSearch.toLowerCase())
                      const matchFilter = computerFilter === 'All' || (computerFilter === 'Enabled' ? c.enabled : !c.enabled)
                      return matchSearch && matchFilter
                    })
                    .map((c, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              c.enabled ? 'bg-blue-100' : 'bg-gray-100'
                            }`}>
                              <Server className={`w-4 h-4 ${c.enabled ? 'text-blue-600' : 'text-gray-400'}`} />
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{c.name}</p>
                              {c.dns_hostname && <p className="text-xs text-gray-400">{c.dns_hostname}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <p className="text-sm text-gray-800">{c.os}</p>
                          {c.os_version && <p className="text-xs text-gray-400">{c.os_version}</p>}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            c.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>{c.enabled ? 'Active' : 'Disabled'}</span>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">{c.last_logon || 'Never'}</td>
                        <td className="py-3 px-4 text-sm text-gray-500">{c.description || <span className="italic text-gray-300">None</span>}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <button onClick={() => {
                              setEditComputerCn(c.name)
                              setEditComputerForm({
                                name: c.name || '',
                                dns_hostname: c.dns_hostname || '',
                                os: c.os || '',
                                os_version: c.os_version || '',
                                description: c.description || '',
                                enabled: c.enabled,
                              })
                              setShowEditComputerModal(true)
                            }}
                              title="Edit computer" className="text-gray-500 hover:text-blue-600 transition-colors">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteComputer(c.name)}
                              title="Delete computer" className="text-red-500 hover:text-red-700 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            {!computersLoading && computers.length === 0 && (
              <div className="p-12 text-center">
                <Server className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No computers found</p>
                <p className="text-gray-400 text-sm mt-1">No domain-joined computers detected. Make sure your Win11 VM is joined and click Refresh.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Domain Controllers Tab ─── */}
      {activeTab === 'dcs' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-md p-4 flex justify-between items-center">
            <p className="text-sm text-gray-600">Domain Controllers are the servers that host and manage your Active Directory domain.</p>
            <button onClick={fetchDcs} disabled={dcsLoading}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors">
              <RefreshCw className={`w-4 h-4 ${dcsLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Domain Controllers</h2>
                <p className="text-sm text-gray-500 mt-0.5">Servers running Active Directory Domain Services (AD DS)</p>
              </div>
              <span className="text-sm text-gray-500">{dcs.length} DC{dcs.length !== 1 ? 's' : ''}</span>
            </div>
            {dcsLoading ? (
              <div className="p-12 flex items-center justify-center gap-3">
                <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="text-gray-600">Loading domain controllers...</span>
              </div>
            ) : dcs.length === 0 ? (
              <div className="p-12 text-center">
                <Shield className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No domain controllers found</p>
                <p className="text-gray-400 text-sm mt-1">Click Refresh to query Active Directory</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {dcs.map((dc, idx) => (
                  <div key={idx} className="p-6 hover:bg-gray-50">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        dc.enabled ? 'bg-green-100' : 'bg-red-100'
                      }`}>
                        <Shield className={`w-6 h-6 ${dc.enabled ? 'text-green-600' : 'text-red-500'}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-bold text-gray-900 text-lg">{dc.name}</h3>
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            dc.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>{dc.enabled ? 'Online' : 'Disabled'}</span>
                          {dc.is_global_catalog && (
                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">Global Catalog</span>
                          )}
                        </div>
                        {dc.dns_hostname && <p className="text-sm text-blue-600 mt-0.5">{dc.dns_hostname}</p>}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 text-sm">
                          <div>
                            <p className="text-gray-500">Operating System</p>
                            <p className="font-medium text-gray-800">{dc.os}</p>
                            {dc.os_version && <p className="text-xs text-gray-400">{dc.os_version}</p>}
                          </div>
                          <div>
                            <p className="text-gray-500">Last Logon</p>
                            <p className="font-medium text-gray-800">{dc.last_logon || 'Unknown'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Created</p>
                            <p className="font-medium text-gray-800">{dc.created ? dc.created.replace('T', ' ') : '—'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Description</p>
                            <p className="font-medium text-gray-800">{dc.description || <span className="text-gray-400 italic">None</span>}</p>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 font-mono mt-2 truncate">{dc.dn}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Risk Analysis Tab ─── */}
      {activeTab === 'risks' && scan && (
        <div className="space-y-6">
          {/* Privilege Escalation Check */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Privilege Escalation Check</h2>
            <p className="text-sm text-gray-500 mb-4">Users who are members of high-privilege groups</p>
            <div className="space-y-3">
              {users.filter(u => u.is_privileged).map((user, idx) => (
                <div key={idx} className="flex items-center justify-between bg-[#252525] border border-[#3a3a3a] rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white font-semibold">
                      {user.display_name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800">{user.display_name}</p>
                      <p className="text-xs text-gray-500">{user.sam_account_name}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 max-w-md justify-end">
                    {(user.member_of || [])
                      .filter(g => ['Domain Admins', 'Enterprise Admins', 'Administrators', 'Backup Operators', 'Schema Admins', 'Account Operators'].includes(g))
                      .map((g, gi) => (
                        <span key={gi} className="px-2 py-1 text-xs font-semibold rounded-full bg-red-200 text-red-800">{g}</span>
                      ))}
                  </div>
                  <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                    user.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {user.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
              ))}
              {users.filter(u => u.is_privileged).length === 0 && (
                <p className="text-gray-500 text-center py-4">No privileged users found</p>
              )}
            </div>
          </div>

          {/* Orphaned Accounts */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Orphaned Accounts</h2>
            <p className="text-sm text-gray-500 mb-4">Disabled accounts still in privileged groups</p>
            <div className="space-y-3">
              {users.filter(u => u.is_orphaned).map((user, idx) => (
                <div key={idx} className="flex items-center justify-between bg-[#252525] border border-[#3a3a3a] rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-400 rounded-full flex items-center justify-center text-white font-semibold">
                      {user.display_name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800">{user.display_name}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                  </div>
                  <span className="px-3 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                    Orphaned
                  </span>
                </div>
              ))}
              {users.filter(u => u.is_orphaned).length === 0 && (
                <p className="text-gray-500 text-center py-4">No orphaned accounts found</p>
              )}
            </div>
          </div>

          {/* Stale Accounts */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Stale Accounts (&gt;90 days)</h2>
            <p className="text-sm text-gray-500 mb-4">Users who haven't logged in for over 90 days</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="text-left py-2 px-4 text-xs text-gray-500 uppercase">User</th>
                    <th className="text-left py-2 px-4 text-xs text-gray-500 uppercase">Last Logon</th>
                    <th className="text-left py-2 px-4 text-xs text-gray-500 uppercase">Status</th>
                    <th className="text-left py-2 px-4 text-xs text-gray-500 uppercase">Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.filter(u => u.is_stale).map((user, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="py-2 px-4 font-medium">{user.display_name}</td>
                      <td className="py-2 px-4 text-sm text-gray-600">
                        {user.last_logon ? new Date(user.last_logon).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="py-2 px-4">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          user.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>{user.enabled ? 'Enabled' : 'Disabled'}</span>
                      </td>
                      <td className="py-2 px-4">
                        <span className={`px-2 py-1 text-xs rounded-full ${RISK_COLORS[user.risk_level]}`}>{user.risk_level}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.filter(u => u.is_stale).length === 0 && (
                <p className="text-gray-500 text-center py-4">No stale accounts found</p>
              )}
            </div>
          </div>

          {/* Weak Configurations */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Weak Configurations</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <p className="font-semibold text-gray-800">Password Never Expires</p>
                  <span className="text-2xl font-bold text-orange-400">{scan.password_never_expires}</span>
                </div>
                <p className="text-sm text-gray-500 mt-1">Accounts with non-expiring passwords violate security best practices</p>
              </div>
              <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <p className="font-semibold text-gray-800">Blank Descriptions</p>
                  <span className="text-2xl font-bold text-[#e3b50a]">
                    {users.filter(u => !u.description?.trim()).length}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1">Accounts without descriptions make auditing difficult</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Create / Edit User Modal ═══ */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <h2 className="text-lg font-bold">{userModalMode === 'create' ? 'New User' : 'Edit AD User'}</h2>
              <button onClick={() => setShowUserModal(false)} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveUser} className="p-5 space-y-3 overflow-y-auto flex-1">
              {userModalMode === 'create' && (
                <>
                  <div className="grid grid-cols-5 gap-3">
                    <div className="col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-1">First name *</label>
                      <input type="text" required value={userForm.first_name} onChange={e => setUserForm({...userForm, first_name: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
                    </div>
                    <div className="col-span-1">
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Initials</label>
                      <input type="text" value={userForm.initials} onChange={e => setUserForm({...userForm, initials: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Last name</label>
                      <input type="text" value={userForm.last_name} onChange={e => setUserForm({...userForm, last_name: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Full name</label>
                    <input type="text" value={userForm.full_name || `${userForm.first_name} ${userForm.last_name}`.trim()}
                      onChange={e => setUserForm({...userForm, full_name: e.target.value})}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">User logon name *</label>
                      <input type="text" required value={userForm.user_logon_name} onChange={e => setUserForm({...userForm, user_logon_name: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">@domain</label>
                      <select
                        value={userForm.upn_suffix}
                        onChange={e => setUserForm({...userForm, upn_suffix: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none"
                      >
                        {resolvedUpnSuffixOptions.map((suffix) => (
                          <option key={suffix} value={suffix}>@{suffix}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">User logon name (pre-Windows 2000) *</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        type="text"
                        value={preWindowsDomainPrefix}
                        readOnly
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
                      />
                      <input
                        type="text"
                        required
                        value={userForm.sam_account_name}
                        onChange={e => setUserForm({...userForm, sam_account_name: e.target.value})}
                        className="w-full md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Password *</label>
                    <div className="relative">
                      <input
                        type={showAdUserPassword ? 'text' : 'password'}
                        required
                        value={userForm.password}
                        onChange={e => setUserForm({...userForm, password: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAdUserPassword(v => !v)}
                        className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700"
                        aria-label={showAdUserPassword ? 'Hide password' : 'Show password'}
                        title={showAdUserPassword ? 'Hide password' : 'Show password'}
                      >
                        {showAdUserPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {userModalMode === 'edit' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">First name</label>
                      <input type="text" value={userForm.first_name} onChange={e => setUserForm({...userForm, first_name: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Last name</label>
                      <input type="text" value={userForm.last_name} onChange={e => setUserForm({...userForm, last_name: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Display name</label>
                    <input type="text" value={userForm.full_name} onChange={e => setUserForm({...userForm, full_name: e.target.value})}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">User logon name</label>
                      <input type="text" value={userForm.user_logon_name} onChange={e => setUserForm({...userForm, user_logon_name: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">@domain</label>
                      <select
                        value={userForm.upn_suffix}
                        onChange={e => setUserForm({...userForm, upn_suffix: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none"
                      >
                        {resolvedUpnSuffixOptions.map((suffix) => (
                          <option key={suffix} value={suffix}>@{suffix}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">User logon name (pre-Windows 2000)</label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        type="text"
                        value={preWindowsDomainPrefix}
                        readOnly
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
                      />
                      <input
                        type="text"
                        value={userForm.sam_account_name}
                        onChange={e => setUserForm({...userForm, sam_account_name: e.target.value})}
                        className="w-full md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none"
                      />
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                <input type="text" value={userForm.description} onChange={e => setUserForm({...userForm, description: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                <div className="text-sm font-semibold text-gray-700">Account options</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userForm.user_must_change_password_next_logon}
                      onChange={e => setUserForm({...userForm, user_must_change_password_next_logon: e.target.checked})}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-white"
                    />
                    <span className="text-sm font-medium text-gray-700">User must change password at next logon</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userForm.user_cannot_change_password}
                      onChange={e => setUserForm({...userForm, user_cannot_change_password: e.target.checked})}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-white"
                    />
                    <span className="text-sm font-medium text-gray-700">User cannot change password</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer md:col-span-2">
                    <input
                      type="checkbox"
                      checked={userForm.password_never_expires}
                      onChange={e => setUserForm({...userForm, password_never_expires: e.target.checked})}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-white"
                    />
                    <span className="text-sm font-medium text-gray-700">Password never expires</span>
                  </label>
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="text-sm font-semibold text-gray-700">Log on to</div>
                  <div className="flex items-center gap-4 text-sm flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={userForm.logon_to_all_computers}
                        onChange={() => setUserForm({...userForm, logon_to_all_computers: true})}
                        className="text-blue-600 focus:ring-white"
                      />
                      <span className="text-gray-700">All computers</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={!userForm.logon_to_all_computers}
                        onChange={() => setUserForm({...userForm, logon_to_all_computers: false})}
                        className="text-blue-600 focus:ring-white"
                      />
                      <span className="text-gray-700">The following computers</span>
                    </label>
                  </div>
                </div>
                {!userForm.logon_to_all_computers && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">Select one or more computers. These are stored in AD as workstation restrictions.</p>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      This AD restriction is primarily enforced for Windows domain logon. Linux clients (for example SSSD/realmd) may still allow sign-in unless host-side access control is configured.
                    </div>
                    {computersLoading ? (
                      <p className="text-sm text-gray-500">Loading computers...</p>
                    ) : computers.length === 0 ? (
                      <p className="text-sm text-gray-500">No computers available. Open the Computers tab and refresh first.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                        {computers.map((computer) => {
                          const computerName = computer.name.toUpperCase()
                          const checked = userForm.logon_workstations.includes(computerName)
                          return (
                            <label key={computerName} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setUserForm(prev => {
                                    const selected = prev.logon_workstations.includes(computerName)
                                      ? prev.logon_workstations.filter(item => item !== computerName)
                                      : [...prev.logon_workstations, computerName]
                                    return { ...prev, logon_workstations: selected }
                                  })
                                }}
                                className="w-4 h-4 rounded text-blue-600 focus:ring-white"
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-gray-700 truncate">{computer.name}</div>
                                {computer.dns_hostname && <div className="text-xs text-gray-400 truncate">{computer.dns_hostname}</div>}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={userForm.enabled} onChange={e => setUserForm({...userForm, enabled: e.target.checked})} className="w-4 h-4 rounded text-blue-600 focus:ring-white" />
                  <span className="text-sm font-medium text-gray-700">Account Enabled</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                  {userModalMode === 'create' ? 'Create User' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ Group Assign/Remove Modal ═══ */}
      {showGroupAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className={`px-6 py-4 text-white ${groupAssignAction === 'add' ? 'bg-gradient-to-r from-green-600 to-emerald-600' : 'bg-gradient-to-r from-red-600 to-rose-600'}`}>
              <h2 className="text-lg font-bold">{groupAssignAction === 'add' ? 'Add to Group' : 'Remove from Group'}</h2>
              <p className="text-sm opacity-80">User: {groupAssignUser?.display_name}</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Select Group</label>
                <select value={selectedGroupDn} onChange={e => setSelectedGroupDn(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none">
                  <option value="">-- Select a group --</option>
                  {(groupAssignAction === 'remove'
                    ? adGroups.filter(g => (groupAssignUser?.member_of || []).includes(g.name))
                    : adGroups
                  ).map((g, i) => (
                    <option key={i} value={g.dn}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowGroupAssignModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button onClick={handleGroupAssign} disabled={!selectedGroupDn}
                  className={`px-5 py-2 text-white rounded-lg font-medium disabled:opacity-50 ${groupAssignAction === 'add' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
                  {groupAssignAction === 'add' ? 'Add to Group' : 'Remove from Group'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Create Group Modal ═══ */}
      {showCreateGroupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <h2 className="text-lg font-bold">New Group</h2>
              <button onClick={() => setShowCreateGroupModal(false)} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateGroup} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Group name *</label>
                <input type="text" required value={createGroupForm.name} onChange={e => setCreateGroupForm({...createGroupForm, name: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Group scope</label>
                  <div className="space-y-1">
                    {['DomainLocal', 'Global', 'Universal'].map(s => (
                      <label key={s} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="scope" value={s} checked={createGroupForm.scope === s}
                          onChange={e => setCreateGroupForm({...createGroupForm, scope: e.target.value})}
                          className="text-blue-600 focus:ring-white" />
                        <span className="text-sm text-gray-700">{s === 'DomainLocal' ? 'Domain local' : s}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Group type</label>
                  <div className="space-y-1">
                    {['Security', 'Distribution'].map(t => (
                      <label key={t} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="gtype" value={t} checked={createGroupForm.group_type === t}
                          onChange={e => setCreateGroupForm({...createGroupForm, group_type: e.target.value})}
                          className="text-blue-600 focus:ring-white" />
                        <span className="text-sm text-gray-700">{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                <input type="text" value={createGroupForm.description} onChange={e => setCreateGroupForm({...createGroupForm, description: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateGroupModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ Edit Group Modal ═══ */}
      {showEditGroupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <h2 className="text-lg font-bold">Edit Group: {editGroupCn}</h2>
              <button onClick={() => setShowEditGroupModal(false)} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpdateGroup} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Group name *</label>
                <input type="text" required value={editGroupForm.name} onChange={e => setEditGroupForm({...editGroupForm, name: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Group scope</label>
                  <div className="space-y-1">
                    {['DomainLocal', 'Global', 'Universal'].map(s => (
                      <label key={s} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="edit_scope" value={s} checked={editGroupForm.scope === s}
                          onChange={e => setEditGroupForm({...editGroupForm, scope: e.target.value})}
                          className="text-blue-600 focus:ring-white" />
                        <span className="text-sm text-gray-700">{s === 'DomainLocal' ? 'Domain local' : s}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Group type</label>
                  <div className="space-y-1">
                    {['Security', 'Distribution'].map(t => (
                      <label key={t} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="edit_gtype" value={t} checked={editGroupForm.group_type === t}
                          onChange={e => setEditGroupForm({...editGroupForm, group_type: e.target.value})}
                          className="text-blue-600 focus:ring-white" />
                        <span className="text-sm text-gray-700">{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                <input type="text" value={editGroupForm.description} onChange={e => setEditGroupForm({...editGroupForm, description: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowEditGroupModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ Create OU Modal ═══ */}
      {showOuModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <h2 className="text-lg font-bold">New Organizational Unit</h2>
              <button onClick={() => setShowOuModal(false)} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateOu} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Name *</label>
                <input type="text" required value={ouForm.name} onChange={e => setOuForm({...ouForm, name: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                <input type="text" value={ouForm.description} onChange={e => setOuForm({...ouForm, description: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Parent OU (optional)</label>
                <select value={ouForm.parent_dn} onChange={e => setOuForm({...ouForm, parent_dn: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none">
                  <option value="">Root (Domain)</option>
                  {ous.map((o, i) => (
                    <option key={i} value={o.dn}>{o.name} ({o.path})</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowOuModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ Edit OU Modal ═══ */}
      {showEditOuModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <h2 className="text-lg font-bold">Edit OU</h2>
              <button onClick={() => setShowEditOuModal(false)} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpdateOu} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">OU Name *</label>
                <input type="text" required value={editOuForm.name} onChange={e => setEditOuForm({...editOuForm, name: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                <input type="text" value={editOuForm.description} onChange={e => setEditOuForm({...editOuForm, description: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowEditOuModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ Create Computer Modal ═══ */}
      {showComputerModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <h2 className="text-lg font-bold">New Computer</h2>
              <button onClick={() => setShowComputerModal(false)} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateComputer} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Computer name *</label>
                <input type="text" required value={computerForm.name} onChange={e => setComputerForm({...computerForm, name: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Target OU (optional)</label>
                <select value={computerForm.ou_dn} onChange={e => setComputerForm({...computerForm, ou_dn: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none">
                  <option value="">Default (CN=Computers)</option>
                  {ous.map((o, i) => (
                    <option key={i} value={o.dn}>{o.name} ({o.path})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                <input type="text" value={computerForm.description} onChange={e => setComputerForm({...computerForm, description: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowComputerModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ Edit Computer Modal ═══ */}
      {showEditComputerModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <h2 className="text-lg font-bold">Edit Computer: {editComputerCn}</h2>
              <button onClick={() => setShowEditComputerModal(false)} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpdateComputer} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                <input type="text" value={editComputerForm.description} onChange={e => setEditComputerForm({...editComputerForm, description: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none" />
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editComputerForm.enabled} onChange={e => setEditComputerForm({...editComputerForm, enabled: e.target.checked})}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-white" />
                  <span className="text-sm font-medium text-gray-700">Enabled</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowEditComputerModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ Password Reset Modal ═══ */}
      {showPasswordResetModal && passwordResetUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <h2 className="text-lg font-bold">Reset AD User Password</h2>
              <button onClick={() => setShowPasswordResetModal(false)} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleResetPassword} className="p-6 space-y-4">
              <p className="text-sm text-gray-700">
                <strong>User:</strong> {passwordResetUser.display_name} ({passwordResetUser.sam_account_name})
              </p>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">New Password *</label>
                <div className="relative">
                  <input 
                    type={showResetPassword ? 'text' : 'password'}
                    value={resetPasswordForm.new_password} 
                    onChange={e => {
                      setResetPasswordForm({...resetPasswordForm, new_password: e.target.value})
                      if (resetPasswordError) setResetPasswordError('')
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none"
                    placeholder="Enter new password"
                    required 
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(v => !v)}
                    className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700"
                    aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                  >
                    {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Must be 8+ characters with uppercase, lowercase, number, and special character
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Confirm Password *</label>
                <div className="relative">
                  <input 
                    type={showConfirmResetPassword ? 'text' : 'password'}
                    value={resetPasswordForm.confirm_password} 
                    onChange={e => {
                      setResetPasswordForm({...resetPasswordForm, confirm_password: e.target.value})
                      if (resetPasswordError) setResetPasswordError('')
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-white focus:border-white outline-none"
                    placeholder="Re-enter password"
                    required 
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmResetPassword(v => !v)}
                    className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700"
                    aria-label={showConfirmResetPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {resetPasswordError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  {resetPasswordError}
                </div>
              )}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
                <strong>Note:</strong> Password reset requires a secure (SSL/TLS) AD connection. The user may need to log in with the new password at their next opportunity.
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowPasswordResetModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Reset Password</button>
              </div>
            </form>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  )
}

export default ADScanner
