"""
Database seeding – creates default roles, permissions, and admin user.
"""
from database import SessionLocal, Role, Permission, User, role_permissions, ADGroupMapping
from auth import hash_password


def seed_database():
    db = SessionLocal()
    try:
        if db.query(Role).count() > 0:
            return  # already seeded

        # ── Roles ──
        admin_role = Role(name="Admin", description="Full system access with all permissions")
        editor_role = Role(name="Editor", description="Can manage users and view analytics")
        viewer_role = Role(name="Viewer", description="Read-only access to analytics and reports")
        db.add_all([admin_role, editor_role, viewer_role])
        db.flush()

        # ── Permissions ──
        perms_data = [
            ("manage_users", "Create, edit, and delete users", "User Management"),
            ("manage_roles", "Create, edit, and delete roles", "User Management"),
            ("manage_permissions", "Create, edit, and delete permissions", "User Management"),
            ("view_analytics", "View analytics dashboard", "Analytics"),
            ("view_reports", "View and download reports", "Analytics"),
            ("view_audit_logs", "View system audit logs", "System"),
            ("manage_ad_scanner", "Run AD scans and view results", "System"),
        ]
        perm_objs = {}
        for name, desc, cat in perms_data:
            p = Permission(name=name, description=desc, category=cat)
            db.add(p)
            perm_objs[name] = p
        db.flush()

        # Admin gets everything
        admin_role.permissions = list(perm_objs.values())
        # Editor
        editor_role.permissions = [perm_objs["manage_users"], perm_objs["view_analytics"], perm_objs["view_reports"]]
        # Viewer
        viewer_role.permissions = [perm_objs["view_analytics"], perm_objs["view_reports"]]

        # ── Default admin user ──
        admin_user = User(
            name="Admin",
            username="admin",
            email="admin@gmail.com",
            password=hash_password("admin123"),
            role="Admin",
            status="Active",
        )
        db.add(admin_user)

        # ── Default AD group → RBAC role mappings ──
        mappings = [
            ADGroupMapping(ad_group="Domain Admins", rbac_role="Admin"),
            ADGroupMapping(ad_group="Enterprise Admins", rbac_role="Admin"),
            ADGroupMapping(ad_group="Web_Admins", rbac_role="Admin"),
            ADGroupMapping(ad_group="Web_Editors", rbac_role="Editor"),
            ADGroupMapping(ad_group="Domain Users", rbac_role="Viewer"),
        ]
        db.add_all(mappings)

        db.commit()
        print("✅ Database seeded with default data.")
    except Exception as e:
        db.rollback()
        print(f"⚠️  Seed error (may already exist): {e}")
    finally:
        db.close()
