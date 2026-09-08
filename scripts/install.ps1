# Install a built version over the running app -- and refuse to do it mid-match.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Force
#
# This exists because the guard was being retyped by hand each time and was
# silently broken: it called Invoke-WebRequest with -SkipCertificateCheck, which
# Windows PowerShell 5.1 does not have. The cmdlet threw a parameter-binding
# error rather than a connection error, the catch read every failure as "no game
# running", and three builds were installed over a live ranked game.
#
# The check is now a TCP probe of League's Live Client Data port. No HTTPS, no
# certificate, nothing to get wrong: the port is open exactly while a game runs.

param([switch]$Force)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exeName = 'AI LoL Coach'
$installed = Join-Path $env:LOCALAPPDATA "Programs\$exeName\$exeName.exe"

function Test-GameRunning {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    # League binds 2999 only while you are in a match -- loading screen included.
    $ok = $client.ConnectAsync('127.0.0.1', 2999).Wait(1500)
    return $ok -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

$setup = Get-ChildItem (Join-Path $root 'dist') -Filter "$exeName Setup *.exe" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { Write-Error "No installer in dist/ -- run npm run dist first."; exit 1 }

if (Test-GameRunning) {
  if (-not $Force) {
    Write-Host "A game is running (port 2999 is open)." -ForegroundColor Yellow
    Write-Host "Installing now would kill the overlay mid-match. Re-run after the game, or pass -Force."
    exit 2
  }
  Write-Host "A game is running, but -Force was given. Installing anyway." -ForegroundColor Yellow
}

Write-Host "Installing $($setup.Name)"
Get-Process $exeName -ErrorAction SilentlyContinue | Stop-Process -Force
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { try { Stop-Process -Id $_ -Force } catch {} }
Start-Sleep -Seconds 1

Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait
Start-Process $installed
Start-Sleep -Seconds 13

$version = (Get-Item $installed).VersionInfo.FileVersion
try {
  $health = Invoke-RestMethod 'http://localhost:3000/api/health' -TimeoutSec 10
  Write-Host "installed $version - server ok, llm=$($health.llm)" -ForegroundColor Green
} catch {
  Write-Host "installed $version - SERVER NOT RESPONDING" -ForegroundColor Red
  exit 1
}
