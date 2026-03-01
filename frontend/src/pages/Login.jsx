import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/* User login */
const Login = () => {
  const [isLogin, setIsLogin] = useState(true)
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    email: '',
    password: ''
  })
  const [error, setError] = useState('')
  const { login, signup } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (isLogin) {
      const result = await login(formData.email, formData.password)
      if (result.success) {
        navigate('/dashboard')
      } else {
        setError(result.error)
      }
    } else {
      if (!formData.name || !formData.username || !formData.email || !formData.password) {
        setError('Please fill in all fields')
        return
      }
      const result = await signup({ ...formData, role: 'Viewer' })
      if (result.success) {
        navigate('/dashboard')
      } else {
        setError(result.error)
      }
    }
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }
  
  return (
    <div className="min-h-screen bg-gray-800 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Enhanced RBAC</h1>
          
          {/* User sign up */}
          <p className="text-gray-500 mt-2">
            {isLogin ? 'Welcome back! Please login.' : 'Create your account'} 
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-gray-700 font-medium mb-2">Name</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="Enter your name"
              />
            </div>
          )}

          {!isLogin && (
            <div>
              <label className="block text-gray-700 font-medium mb-2">Username</label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="Choose a username"
              />
            </div>
          )}

          <div>
            <label className="block text-gray-700 font-medium mb-2">
              {isLogin ? 'Email or Username' : 'Email'}
            </label>
            <input
              type={isLogin ? 'text' : 'email'}
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder={isLogin ? 'Enter your email or username' : 'Enter your email'}
              required
            />
          </div>

          <div>
            <label className="block text-gray-700 font-medium mb-2">Password</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition duration-200"
          >
            {isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsLogin(!isLogin)
              setError('')
              setFormData({ name: '', username: '', email: '', password: '' })
            }}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Login'}
          </button>
        </div>

        {/* Default admin account for demo */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          {isLogin ? (
            <>
              <p className="text-sm text-gray-600 font-semibold mb-2">Default Admin Account:</p>
              <div className="space-y-1">
                <p className="text-xs text-gray-700">
                  <span className="font-medium">Username:</span> admin
                </p>
                <p className="text-xs text-gray-700">
                  <span className="font-medium">Email:</span> admin@gmail.com
                </p>
                <p className="text-xs text-gray-700">
                  <span className="font-medium">Password:</span> admin123
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 font-semibold mb-1">New Users:</p>
              <p className="text-xs text-gray-500">Will be assigned Viewer role by default. Contact admin for elevated access.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Login
