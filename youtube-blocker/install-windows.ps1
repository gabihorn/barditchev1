<#
  YouTube Guard - one-step installer for Windows (standalone + Telegram bot).

  Run in PowerShell as Administrator:
    irm https://raw.githubusercontent.com/gabihorn/barditchev1/main/youtube-blocker/install-windows.ps1 | iex

  What it does:
    1. Installs Node.js LTS with winget if it is missing
    2. Downloads YouTube Guard from GitHub
    3. Asks for your Telegram bot token and checks it
    4. Installs the "YouTubeGuard" Windows service
    5. Prints the pairing code to send to your bot
#>

function Install-YouTubeGuard {
  $ErrorActionPreference = 'Stop'
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Please run PowerShell as Administrator (right click > Run as administrator) and try again.'
  }

  # --- 1. Node.js ---
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      throw 'Node.js is missing. Install the LTS version from https://nodejs.org, reopen PowerShell as Administrator and run this again.'
    }
    Write-Host 'Installing Node.js LTS...' -ForegroundColor Cyan
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      throw 'Node.js was installed but is not on PATH yet. Close PowerShell, open it again as Administrator and rerun.'
    }
  }
  Write-Host "Node.js $(node --version)" -ForegroundColor Green

  # --- 2. Download ---
  $work = Join-Path $env:TEMP ('youtube-guard-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $work | Out-Null
  $root = $null
  foreach ($ref in (@($env:YTG_REF, 'main', 'claude/youtube-blocking-windows-7otoh0') | Where-Object { $_ })) {
    try {
      Write-Host "Downloading ($ref)..." -ForegroundColor Cyan
      $zip = Join-Path $work 'src.zip'
      Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/gabihorn/barditchev1/archive/refs/heads/$ref.zip" -OutFile $zip
      $dest = Join-Path $work ($ref -replace '[\\/]', '-')
      Expand-Archive -Path $zip -DestinationPath $dest -Force
      $root = Get-ChildItem -Path $dest -Recurse -Directory -Filter 'youtube-blocker' | Select-Object -First 1
      if ($root -and (Test-Path (Join-Path $root.FullName 'option2-agent\agent\src\telegram.js'))) { break }
      $root = $null
    } catch {
      Write-Host "  not available: $($_.Exception.Message)" -ForegroundColor DarkGray
    }
  }
  if (-not $root) { throw 'Could not download YouTube Guard from GitHub.' }

  # --- 3. Telegram bot token ---
  $existing = Test-Path "$env:ProgramData\YouTubeGuard\config.json"
  $token = $null
  if (-not $existing) {
    Write-Host ''
    Write-Host 'Create a bot: open Telegram > @BotFather > /newbot > copy the token.' -ForegroundColor Yellow
    for (;;) {
      $token = (Read-Host 'Paste the bot token').Trim()
      try {
        $me = Invoke-RestMethod -UseBasicParsing -Uri "https://api.telegram.org/bot$token/getMe"
        Write-Host "Bot found: @$($me.result.username)" -ForegroundColor Green
        $botName = $me.result.username
        break
      } catch {
        Write-Host 'That token did not work, try again.' -ForegroundColor Red
      }
    }
  } else {
    Write-Host 'Existing installation found - updating the code, keeping your settings.' -ForegroundColor Cyan
  }

  # --- 4. Install the service ---
  $installer = Join-Path $root.FullName 'option2-agent\windows\install.ps1'
  if ($token) {
    & $installer -TelegramToken $token
  } else {
    & $installer
  }

  if ($botName) {
    Write-Host "Open https://t.me/$botName in Telegram and send the /pair command shown above." -ForegroundColor Green
  }
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

try {
  Install-YouTubeGuard
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
