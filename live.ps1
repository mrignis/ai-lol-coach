# Live Companion launcher — starts the coach server if needed, then opens the
# live widget in a standalone Chrome/Edge app window (no tabs, no address bar).
$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot
$port = 3000
$url  = "http://localhost:$port/live.html"

function Test-Port($p) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close(); return $true }
  catch { return $false }
}

# 1) Start the server if nothing is listening yet.
if (-not (Test-Port $port)) {
  Write-Host "Starting coach server..."
  Start-Process -FilePath "cmd.exe" -ArgumentList '/c', 'npm start' -WorkingDirectory $root -WindowStyle Minimized
}

# 2) Wait for it to answer (max ~10s).
Write-Host "Waiting for server..."
for ($i = 0; $i -lt 40; $i++) { if (Test-Port $port) { break }; Start-Sleep -Milliseconds 250 }

# 3) Find a Chromium browser for app (window) mode.
$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

# 4) Open the widget as its own window (or fall back to the default browser).
if ($browser) {
  Start-Process $browser -ArgumentList "--app=$url", "--window-size=380,640", "--window-position=60,80"
} else {
  Start-Process $url
}
