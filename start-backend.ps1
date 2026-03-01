# Start Python FastAPI Backend
Write-Host "=== ERBAC + AD Scanner Backend ===" -ForegroundColor Cyan

Set-Location "$PSScriptRoot\backend"

# Create virtual environment if it doesn't exist
if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& .\venv\Scripts\Activate.ps1

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt --quiet

# Create data directory
if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}

# Start the server
Write-Host "Starting FastAPI server on http://localhost:3001 ..." -ForegroundColor Green
python main.py
