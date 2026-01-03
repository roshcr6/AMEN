# AMEN Agent Runner
# Runs the agent continuously in a separate PowerShell window

Write-Host "Starting AMEN Agent..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the agent" -ForegroundColor Yellow

Set-Location "c:\Users\lenovo\OneDrive\Desktop\AMEN\agent"

# Set Python environment variable for UTF-8
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

# Run the agent
python main.py
