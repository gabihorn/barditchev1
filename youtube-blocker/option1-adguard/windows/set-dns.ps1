#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Points the Windows PC at AdGuard Home and stops browsers from bypassing it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\set-dns.ps1 -DnsServer 192.168.1.10
  powershell -ExecutionPolicy Bypass -File .\set-dns.ps1 -DnsServer 192.168.1.10 -DisableIPv6
  powershell -ExecutionPolicy Bypass -File .\set-dns.ps1 -Revert
#>
param(
  [string]$DnsServer,
  [switch]$DisableIPv6,   # IPv6 DNS servers announced by the router would bypass AdGuard
  [switch]$Revert
)

$ErrorActionPreference = 'Stop'
if (-not $Revert -and -not $DnsServer) { throw 'Pass -DnsServer <AdGuard IP> or -Revert' }

$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.HardwareInterface }

foreach ($a in $adapters) {
  if ($Revert) {
    Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses
    Enable-NetAdapterBinding -Name $a.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue
    Write-Host "[$($a.Name)] DNS reset to DHCP"
  } else {
    Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses $DnsServer
    if ($DisableIPv6) { Disable-NetAdapterBinding -Name $a.Name -ComponentID ms_tcpip6 }
    Write-Host "[$($a.Name)] DNS -> $DnsServer"
  }
}

# --- Browser policies: disable built-in DNS-over-HTTPS so the browser uses AdGuard ---
$policies = @(
  @{ Path = 'HKLM:\SOFTWARE\Policies\Google\Chrome';            Name = 'DnsOverHttpsMode'; Value = 'off'; Type = 'String' },
  @{ Path = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge';           Name = 'DnsOverHttpsMode'; Value = 'off'; Type = 'String' },
  @{ Path = 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave';      Name = 'DnsOverHttpsMode'; Value = 'off'; Type = 'String' },
  @{ Path = 'HKLM:\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS'; Name = 'Enabled'; Value = 0; Type = 'DWord' },
  @{ Path = 'HKLM:\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS'; Name = 'Locked';  Value = 1; Type = 'DWord' }
)

foreach ($p in $policies) {
  if ($Revert) {
    Remove-ItemProperty -Path $p.Path -Name $p.Name -ErrorAction SilentlyContinue
  } else {
    if (-not (Test-Path $p.Path)) { New-Item -Path $p.Path -Force | Out-Null }
    New-ItemProperty -Path $p.Path -Name $p.Name -Value $p.Value -PropertyType $p.Type -Force | Out-Null
  }
}
Write-Host ($(if ($Revert) { 'Browser DoH policies removed' } else { 'Browser DoH disabled by policy (restart the browsers)' }))

ipconfig /flushdns | Out-Null
Write-Host 'DNS cache flushed. Test with:  nslookup youtube.com   (expect 0.0.0.0 while blocked)'
