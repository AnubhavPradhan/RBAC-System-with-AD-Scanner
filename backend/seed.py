"""
Database seeding – creates default roles, permissions, and admin user.
"""
from database import SessionLocal, Role, Permission, User, role_permissions
from auth import hash_password


def seed_database():
    db = SessionLocal()
    try:
        deprecated_permissions = {"manage_permissions", "view_analytics"}
        perms_data = [
            ("manage_users", "Create, edit, and delete users", "User Management"),
            ("manage_roles", "Create, edit, and delete roles", "User Management"),
            ("view_reports", "View and download reports", "Analytics"),
            ("view_audit_logs", "View system audit logs", "System"),
            ("manage_ad_scanner", "Run AD scans and view results", "System"),
            ("manage_settings", "Access and manage application settings", "System"),
        ]

        # Remove deprecated permissions and detach them from roles.
        stale_perms = db.query(Permission).filter(Permission.name.in_(deprecated_permissions)).all()
        for stale in stale_perms:
            db.delete(stale)
        if stale_perms:
            db.commit()

        # Always ensure default permissions exist, even for already-seeded databases.
        existing_perms = {p.name: p for p in db.query(Permission).all()}
        created_any_perm = False
        for name, desc, cat in perms_data:
            if name not in existing_perms:
                p = Permission(name=name, description=desc, category=cat)
                db.add(p)
                existing_perms[name] = p
                created_any_perm = True
        if created_any_perm:
            db.flush()
            db.commit()

        if db.query(Role).count() > 0:
            return  # already seeded

        # ── Roles ──
        admin_role = Role(name="Admin", description="Full system access with all permissions")
        editor_role = Role(name="Editor", description="Can manage users and view reports")
        viewer_role = Role(name="Viewer", description="Read-only access to reports")
        db.add_all([admin_role, editor_role, viewer_role])
        db.flush()

        # ── Permissions ──
        perm_objs = {}
        for name, desc, cat in perms_data:
            p = existing_perms.get(name)
            if p is None:
                p = Permission(name=name, description=desc, category=cat)
                db.add(p)
            perm_objs[name] = p
        db.flush()

        # Admin gets everything
        admin_role.permissions = list(perm_objs.values())
        # Editor
        editor_role.permissions = [perm_objs["manage_users"], perm_objs["view_reports"]]
        # Viewer
        viewer_role.permissions = [perm_objs["view_reports"]]

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

        db.commit()
        print("✅ Database seeded with default data.")
    except Exception as e:
        db.rollback()
        print(f"⚠️  Seed error (may already exist): {e}")
    finally:
        db.close()
