# RBAC with Active Directory Scanner

A full-stack **Enhanced Role-Based Access Control (RBAC)** system with an integrated **Active Directory Scanner** module for enterprise security auditing.

## Architecture

| Layer    | Technology                              |
|----------|-----------------------------------------|
| Frontend | React 18 + Vite + Tailwind CSS + Recharts |
| Backend  | Python FastAPI + SQLAlchemy (SQLite)    |
| AD Scan  | ldap3 (real AD) / Mock data generator   |
| Auth     | JWT (python-jose) + bcrypt (passlib)    |

## Features

### RBAC Core
- User management with role assignment
- Dynamic roles with configurable permissions
- Permission-gated UI routes and API endpoints
- Audit logging with CSV export
- Analytics dashboard with charts
- PDF/CSV report generation

### AD Scanner Module
- **Domain User Scanning** — enumerate all AD users with account details
- **Privilege Escalation Detection** — flag users in Domain Admins, Enterprise Admins, etc.
- **Orphaned Account Detection** — disabled accounts still in privileged groups
- **Stale Account Detection** — users inactive for 90+ days
- **Weak Configuration Audit** — passwords that never expire, blank descriptions
- **Risk Scoring Engine** — automated risk levels (Critical/High/Medium/Low) per user
- **Scan History** — track all scans with comparison

## Quick Start

### Prerequisites
- **Python 3.10+** (for backend)
- **Node.js 18+** (for frontend)

### 1. Start the Backend

```powershell
# Option A: Use the startup script
.\start-backend.ps1

# Option B: Manual
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env   # copy and edit as needed
python main.py
```

The API starts at **http://localhost:3001**. On first run, it creates the database and seeds default data.

> **Environment variables:** The backend ships with a `.env.example` file. Copy it to `.env` and adjust values for your environment. All settings have sensible defaults so `.env` is optional for local development.

### 2. Start the Frontend

```powershell
# Option A: Use the startup script
.\start-frontend.ps1

# Option B: Manual
cd frontend
npm install
npm run dev
```

The app opens at **http://localhost:5173**.

### 3. Login

| Email             | Password | Role  |
|-------------------|----------|-------|
| admin@gmail.com   | admin123 | Admin |

## Default Seed Data

- **3 Roles**: Admin (all permissions), Editor (manage_users, view_reports, view_analytics, view_audit_logs), Viewer (view_reports, view_analytics, view_audit_logs)
- **7 Permissions**: manage_users, manage_roles, manage_permissions, view_reports, view_analytics, view_audit_logs, manage_ad_scanner

## AD Scanner Usage

1. Navigate to **AD Scanner** in the sidebar
2. Click **Run AD Scan** — uses mock data by default (50 simulated AD users)
3. Review the **Overview** tab for risk breakdown
4. Check the **AD Users** tab to browse/search/filter accounts
5. Review the **Risk Analysis** tab for privilege escalation, orphaned, and stale accounts

### Connecting to Real Active Directory

Set environment variables before starting the backend:

```powershell
$env:AD_SERVER = "dc01.yourdomain.com"
$env:AD_PORT = 636
$env:AD_USE_SSL = "true"
$env:AD_BASE_DN = "DC=yourdomain,DC=com"
$env:AD_BIND_USER = "CN=Scanner,OU=Service,DC=yourdomain,DC=com"
$env:AD_BIND_PASSWORD = "your-password"
```

## API Endpoints

### Auth
| Method | Endpoint           | Description      |
|--------|--------------------|------------------|
| POST   | /api/auth/login    | Login            |
| POST   | /api/auth/signup   | Register         |
| GET    | /api/auth/me       | Current user     |

### RBAC
| Method | Endpoint              | Description        |
|--------|-----------------------|--------------------|
| GET    | /api/users            | List users         |
| GET    | /api/roles            | List roles         |
| GET    | /api/permissions      | List permissions   |
| GET    | /api/audit-logs       | List audit logs    |
| GET    | /api/reports/summary  | Dashboard stats    |

### AD Scanner
| Method | Endpoint                            | Description                |
|--------|-------------------------------------|----------------------------|
| POST   | /api/ad-scanner/scan                | Trigger new scan           |
| GET    | /api/ad-scanner/latest              | Latest scan + users + risk |
| GET    | /api/ad-scanner/scans               | Scan history               |
| GET    | /api/ad-scanner/scans/:id/users     | Users from specific scan   |

## Project Structure

```
├── backend/                  # FastAPI backend
│   ├── main.py               # Entry point
│   ├── config.py             # Settings (env vars)
│   ├── database.py           # SQLAlchemy models
│   ├── auth.py               # JWT + password helpers
│   ├── seed.py               # Default data seeder
│   ├── requirements.txt      # Python dependencies
│   ├── ad_scanner/           # AD Scanner module
│   │   ├── risk_engine.py    # Risk scoring engine
│   │   └── scanner.py        # Core LDAP scanner
│   └── routes/               # API route handlers
│       ├── auth_routes.py
│       ├── users.py
│       ├── roles.py
│       ├── permissions.py
│       ├── audit_logs.py
│       ├── reports.py
│       └── ad_scanner.py
├── frontend/                 # React + Vite frontend
│   └── src/
│       ├── pages/
│       │   ├── ADScanner.jsx # AD Scanner page (new)
│       │   ├── Dashboard.jsx # Dashboard (AD cards added)
│       │   └── ...           # Other RBAC pages
│       ├── components/
│       │   └── Sidebar.jsx   # Navigation (AD Scanner added)
│       └── utils/api.js      # Axios client
├── start-backend.ps1         # Backend startup script
└── start-frontend.ps1        # Frontend startup script
```

## License

MIT
