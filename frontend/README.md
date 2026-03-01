# RBAC System - Frontend

A modern Role-Based Access Control (RBAC) system built with React and Tailwind CSS.

## Features

- **Dashboard**: Overview of system statistics and recent activity
- **Users Management**: Add, view, edit, and delete users
- **Roles Management**: Create and manage roles with custom permissions
- **Permissions Management**: Define and organize permissions by category

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Navigate to the frontend folder:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── Layout.jsx       # Main layout wrapper
│   │   └── Sidebar.jsx      # Navigation sidebar
│   ├── pages/
│   │   ├── Dashboard.jsx    # Dashboard page
│   │   ├── Users.jsx        # Users management
│   │   ├── Roles.jsx        # Roles management
│   │   └── Permissions.jsx  # Permissions management
│   ├── App.jsx              # Main app component with routing
│   ├── main.jsx             # Application entry point
│   └── index.css            # Global styles with Tailwind
├── package.json
├── vite.config.js
└── tailwind.config.js
```

## Technologies Used

- **React 18**: Frontend framework
- **React Router**: Client-side routing
- **Tailwind CSS**: Utility-first CSS framework
- **Vite**: Build tool and dev server

## Available Scripts

- `npm run dev`: Start development server
- `npm run build`: Build for production
- `npm run preview`: Preview production build

## Features Breakdown

### Dashboard
- System statistics cards
- Recent activity feed
- User, role, and permission counts

### Users Management
- User list with role assignments
- Add/edit/delete users
- Status management (Active/Inactive)
- User avatar display

### Roles Management
- Role cards with permissions overview
- Assign multiple permissions to roles
- Track users per role
- Add/edit/delete roles

### Permissions Management
- Organized by categories
- Activate/deactivate permissions
- Add custom permissions
- Category-based grouping

## License

MIT
