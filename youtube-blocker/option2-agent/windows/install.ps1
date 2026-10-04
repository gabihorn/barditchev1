#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the youtube-guard agent as a Windows service.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -ServerUrl http://192.168.1.10:8088 -AgentToken <AGENT_TOKEN>
#>
param(
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

$src = Join-Path $PSScriptRoot '..\agent'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $InstallDir -Recurse -Force `
  -Exclude 'node_modules', 'logs', 'daemon', 'config.json', 'state-cache.json', 'test'

Push-Location $InstallDir
try {
  npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

  $cfgPath = Join-Path $InstallDir 'config.json'
  if (-not (Test-Path $cfgPath)) {
    if (-not $ServerUrl -or -not $AgentToken) { throw 'First install: pass -ServerUrl and -AgentToken' }
    $cfg = Get-Content (Join-Path $InstallDir 'config.example.json') -Raw | ConvertFrom-Json
    $cfg.serverUrl = $ServerUrl
    $cfg.agentToken = $AgentToken
    $cfg.agentId = $env:COMPUTERNAME
    # UTF-8 without BOM
    [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json))
    Write-Host "config.json created at $cfgPath"
  }

  node install-service.js
  if ($LASTEXITCODE -ne 0) { throw 'service installation failed' }

  # Only SYSTEM and Administrators may read/modify the agent (the token and config stay private).
  # SIDs are used so this works on Hebrew/localized Windows as well.
  icacls $InstallDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
} finally {
  Pop-Location
}

Start-Sleep -Seconds 3
Get-Service -Name 'YouTubeGuard' -ErrorAction SilentlyContinue | Format-Table -AutoSize Name, Status, StartType
Write-Host "Logs: $InstallDir\logs\agent.log"
