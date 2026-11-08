# Install the Ahava fingerprint bridge as a hidden, auto-start background task.
#
# Runs fpbridge.py with pythonw.exe (no console window) at every login, and
# restarts it if it ever stops. After this you never need to keep a terminal
# open — the reader just works whenever the PC is on and logged in.
#
# Usage (PowerShell, in the folder that holds fpbridge.py):
#   powershell -ExecutionPolicy Bypass -File install-bridge-task.ps1
#
# To remove later:
#   Unregister-ScheduledTask -TaskName "AhavaFingerprintBridge" -Confirm:$false

$ErrorActionPreference = "Stop"

# fpbridge.py in the same folder as this script.
$script = Join-Path $PSScriptRoot "fpbridge.py"
if (-not (Test-Path $script)) { throw "fpbridge.py not found next to this script ($script)." }

# Find pythonw.exe (the windowless Python) next to the python that has pyzkfp.
$pyExe  = (& py -c "import sys; print(sys.executable)").Trim()
$pythonw = Join-Path (Split-Path $pyExe) "pythonw.exe"
if (-not (Test-Path $pythonw)) { throw "pythonw.exe not found at $pythonw." }

$action   = New-ScheduledTaskAction -Execute $pythonw -Argument ('"' + $script + '"')
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
              -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
              -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName "AhavaFingerprintBridge" -Action $action `
  -Trigger $trigger -Settings $settings -Force | Out-Null

Start-ScheduledTask -TaskName "AhavaFingerprintBridge"

Write-Host ""
Write-Host "Installed. The fingerprint bridge now starts automatically at login (no window)" -ForegroundColor Green
Write-Host "and restarts itself if it stops. It is running now on http://localhost:8899."
Write-Host "Log file: $env:LOCALAPPDATA\ahava-fp\bridge.log"
