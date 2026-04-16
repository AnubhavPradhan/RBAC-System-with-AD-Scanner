import React from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import PopupHost from './PopupHost'

const Layout = ({ children }) => {
  return (
    <div className="app-shell min-h-screen" style={{ backgroundColor: 'var(--app-bg-color)' }}>
      <PopupHost />
      <Topbar />
      <div className="min-h-[calc(100vh-76px)]">
        <Sidebar />
        <main className="ml-64">
        <div className="p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
        </main>
      </div>
    </div>
  )
}

export default Layout
