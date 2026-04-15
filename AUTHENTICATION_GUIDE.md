# Authentication System - Quick Guide

## ✅ What's Been Implemented

A full-stack authentication system with JWT-based role-based access control (RBAC), powered by a **Python FastAPI** backend and **React** frontend.

## 🚀 How to Use

### 1. Start the Backend
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env   # copy and edit as needed
python main.py
```
The API starts at **http://localhost:3001**.

### 2. Start the Frontend
```powershell
cd frontend
npm install
npm run dev
```
The app opens at **http://localhost:5173**.

### 3. Default Login
| Email             | Password | Role  |
|-------------------|----------|-------|
| admin@gmail.com   | admin123 | Admin |

### 4. Create Additional Accounts
- Go to `http://localhost:5173/login`
- Click "Sign Up"
- Fill in your details and choose a role: **Admin**, **Editor**, or **Viewer**

### 3. Role Permissions

#### 👑 Admin
- Full access to everything
- Can manage users, roles, and permissions
- Can view analytics, reports, and audit logs

#### ✏️ Editor  
- Can manage users
- Can view analytics and reports
- Cannot manage roles or permissions
- Cannot view audit logs

#### 👁️ Viewer
- Can only view analytics and reports
- Cannot manage users, roles, or permissions
- Cannot view audit logs

### 4. Testing Different Roles

**Option 1: Create Multiple Accounts**
- Sign up with different emails and roles
- Logout and login with different credentials

**Option 2: Use the Users Page (Admin only)**
- Login as Admin
- Go to Users page
- Add users with different roles
- Logout and login as those users

## 🎯 Key Features

### ✨ Dynamic Sidebar
- Menu items automatically hide based on user permissions
- Users only see pages they have access to

### 🔒 Protected Routes
- Each page checks permissions before rendering
- Unauthorized access shows "Access Denied" message
- Automatic redirect to login if not authenticated

### 💾 Data Persistence
- All data stored in localStorage
- Login state persists across browser sessions
- Users remain logged in until they logout

### 🎨 User Interface
- Clean, modern login/signup page
- User info displayed in top bar
- Logout button in header
- Visual feedback for access denied

## 📋 Permission Mapping

| Page | Permission Required |
|------|-------------------|
| Dashboard | None (all users) |
| Users | `manage_users` |
| Roles | `manage_roles` |
| Permissions | `manage_permissions` |
| Analytics | `view_analytics` |
| Reports | `view_reports` |
| Audit Logs | `view_audit_logs` |
| AD Scanner | `manage_ad_scanner` |
| Settings | `manage_settings` |

## 🧪 Test Scenarios

### Test 1: Admin Access
1. Sign up as Admin
2. You should see all menu items
3. You can access all pages

### Test 2: Editor Access
1. Sign up as Editor
2. You should see: Dashboard, Users, Analytics, Reports, Settings
3. Try to access `/roles` - you'll get "Access Denied"

### Test 3: Viewer Access
1. Sign up as Viewer
2. You should see: Dashboard, Analytics, Reports, Settings
3. Try to access `/users` - you'll get "Access Denied"

## 🔄 How Authentication Works

1. **Signup**: Creates user via `/api/auth/signup` with hashed password (bcrypt)
2. **Login**: Validates credentials via `/api/auth/login`, returns a JWT token
3. **Session**: JWT stored in localStorage, sent as `Authorization: Bearer <token>` header
4. **Authorization**: Backend middleware validates JWT and checks user role/permissions per endpoint
5. **Frontend Guards**: React routes check permissions and hide unauthorized sidebar items
6. **Logout**: Removes JWT from localStorage

## ⚠️ Important Notes

### Security
- Passwords are hashed with **bcrypt** via passlib
- Authentication uses **JWT tokens** (python-jose) with configurable expiry
- API endpoints are protected with FastAPI dependency injection
- Set a strong `JWT_SECRET` in `.env` for production

### Environment Configuration
Copy `backend/.env.example` to `backend/.env` and configure:
```env
JWT_SECRET=change_me_in_production
DATABASE_URL=sqlite:///./data/rbac.db
AD_SERVER=ldaps://dc.example.com
```

## 🐛 Troubleshooting

### Issue: Can't login after signup
- Check browser console for errors (Network tab for API failures)
- Ensure the backend is running on `http://localhost:3001`
- Try deleting `backend/data/rbac.db` and restarting the backend to re-seed

### Issue: Sidebar shows all items regardless of role
- Check that the user's role has the correct permissions in the database
- Default roles/permissions are seeded on first backend startup

### Issue: Getting "Access Denied" on allowed pages
- Check that your role has the required permission
- Verify the JWT token is valid (not expired)
- Check the backend logs for auth errors

### Issue: Backend won't start
- Ensure Python 3.10+ is installed
- Activate the virtual environment: `.\venv\Scripts\Activate.ps1`
- Install dependencies: `pip install -r requirements.txt`
- Check that port 3001 is not in use

## 🎓 Next Steps

1. **Test the system** with different roles
2. **Add more roles** through the Roles page (Admin only)
3. **Run an AD Scan** from the AD Scanner page
4. **Configure real AD** by setting environment variables in `.env`

## 📱 Quick Commands

```powershell
# Start backend
cd backend
.\venv\Scripts\Activate.ps1
python main.py

# Start frontend
cd frontend
npm run dev

# Reset database (stop backend first)
Remove-Item backend\data\rbac.db -Force
python main.py   # re-seeds on startup

# Clear frontend auth state (in browser console)
localStorage.clear()
```
