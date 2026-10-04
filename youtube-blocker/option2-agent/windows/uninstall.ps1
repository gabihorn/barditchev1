#Requires -RunAsAdministrator
# Removes the service, the hosts entries, firewall rules and browser policies.
param(
  [string]$InstallDir = "$env:ProgramData\YouTubeGuard",
  [switch]$RemoveFiles
)

$ErrorActionPreference = 'Stop'
Push-Location $InstallDir
try {
  node uninstall-service.js
} finally {
  Pop-Location
}

if ($RemoveFiles) {
  Start-Sleep -Seconds 3
  Remove-Item -Recurse -Force $InstallDir
  Write-Host "$InstallDir removed"
}
