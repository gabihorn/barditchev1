#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs (or updates) the youtube-guard agent as a Windows service.

.EXAMPLE
  # Standalone, controlled by a Telegram bot (no server needed)
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -TelegramToken 123456:ABC...

.EXAMPLE
  # Controlled by the control server
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -ServerUrl http://192.168.1.10:8088 -AgentToken <AGENT_TOKEN>
#>
param(
  [string]$TelegramToken,
  [string]$PairingCode,
  [string]$ServerUrl,
  [string]$AgentToken,
  [string]$InstallDir = "$env:ProgramData\YouTubeGuard"
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 20+ is required. Install the LTS version from https://nodejs.org and reopen PowerShell.'
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js 20+ is required (found $(node --version))" }

$cfgPath = Join-Path $InstallDir 'config.json'
$firstInstall = -not (Test-Path $cfgPath)
if ($firstInstall -and -not $TelegramToken -and -not ($ServerUrl -and $AgentToken)) {
  throw 'First install: pass -TelegramToken (standalone) or -ServerUrl and -AgentToken (server mode)'
}

$src = Join-Path $PSScriptRoot '..\agent'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $InstallDir -Recurse -Force `
  -Exclude 'node_modules', 'logs', 'daemon', 'data', 'config.json', 'state-cache.json', 'test'

Push-Location $InstallDir
try {
  npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

  if ($firstInstall) {
    $cfg = Get-Content (Join-Path $InstallDir 'config.example.json') -Raw | ConvertFrom-Json
    $cfg.agentId = $env:COMPUTERNAME
    if ($TelegramToken) {
      if (-not $PairingCode) { $PairingCode = '{0:D6}' -f (Get-Random -Minimum 0 -Maximum 1000000) }
      $cfg.controller = 'telegram'
      $cfg.telegram = [pscustomobject]@{ botToken = $TelegramToken; pairingCode = $PairingCode; notifyScheduleChanges = $true }
      $cfg.serverUrl = ''
      $cfg.agentToken = ''
    } else {
      $cfg.controller = 'server'
      $cfg.serverUrl = $ServerUrl
      $cfg.agentToken = $AgentToken
    }
    # UTF-8 without BOM
    [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 5))
    Write-Host "config.json created at $cfgPath"
  }

  if (Get-Service -Name 'YouTubeGuard' -ErrorAction SilentlyContinue) {
    Restart-Service -Name 'YouTubeGuard'
    Write-Host 'Service updated and restarted.'
  } else {
    node install-service.js
    if ($LASTEXITCODE -ne 0) { throw 'service installation failed' }
  }

  # Only SYSTEM and Administrators may read/modify the agent (the tokens and config stay private).
  # SIDs are used so this works on Hebrew/localized Windows as well.
  icacls $InstallDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
} finally {
  Pop-Location
}

Start-Sleep -Seconds 3
Get-Service -Name 'YouTubeGuard' -ErrorAction SilentlyContinue | Format-Table -AutoSize Name, Status, StartType
Write-Host "Logs: $InstallDir\logs\agent.log"
if ($TelegramToken -and $firstInstall) {
  Write-Host ''
  Write-Host '=============================================' -ForegroundColor Green
  Write-Host "  Telegram pairing code:  $PairingCode" -ForegroundColor Green
  Write-Host "  Send to your bot:  /pair $PairingCode" -ForegroundColor Green
  Write-Host '=============================================' -ForegroundColor Green
}
