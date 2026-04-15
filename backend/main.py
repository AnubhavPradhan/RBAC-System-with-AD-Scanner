"""
RBAC with AD Scanner – FastAPI Backend
Main application entry point.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from config import settings
from database import init_db
from seed import seed_database


# ── Logging setup ──
logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.info("[Startup] Initializing database...")
    init_db()
    logging.info("[Startup] Database initialized.")

    logging.info("[Startup] Seeding database...")
    try:
        seed_database()
        logging.info("[Startup] Database seeding complete.")
    except Exception as e:
        logging.error(f"[Startup] Database seeding failed: {e}")

    print(f"\U0001f680 {settings.APP_NAME} backend ready")
    if settings.AD_SERVER:
        print(f"   AD Server: {settings.AD_SERVER}:{settings.AD_PORT}")
    yield

from routes.auth_routes import router as auth_router
from routes.users import router as users_router
from routes.roles import router as roles_router
from routes.permissions import router as permissions_router
from routes.audit_logs import router as audit_logs_router
from routes.reports import router as reports_router
from routes.ad_scanner import router as ad_scanner_router

# ── Create app ──

app = FastAPI(
    title=settings.APP_NAME,
    version="2.0.0",
    description="Enhanced Role-Based Access Control System with Active Directory Scanner",
    lifespan=lifespan,
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://localhost(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register routes ──
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(roles_router)
app.include_router(permissions_router)
app.include_router(audit_logs_router)
app.include_router(reports_router)
app.include_router(ad_scanner_router)


@app.get("/api/health")
def health_check():
    from datetime import datetime
    return {"status": "OK", "timestamp": datetime.utcnow().isoformat(), "backend": "FastAPI"}



if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)
