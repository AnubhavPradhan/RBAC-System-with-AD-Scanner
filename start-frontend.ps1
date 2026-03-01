# Start React Frontend
Write-Host "=== ERBAC + AD Scanner Frontend ===" -ForegroundColor Cyan

Set-Location "$PSScriptRoot\frontend"

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing npm dependencies..." -ForegroundColor Yellow
    npm install
}

# Start dev server
Write-Host "Starting Vite dev server on http://localhost:5173 ..." -ForegroundColor Green
npm run dev
