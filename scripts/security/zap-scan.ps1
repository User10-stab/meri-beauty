<#
.SYNOPSIS
  Run an OWASP ZAP baseline (spider + passive) scan against a target without Docker.

.DESCRIPTION
  Starts the locally-extracted ZAP engine in daemon mode, drives it with
  zap_scan.py over the JSON API, then shuts it down. Reports are written to
  ./security-reports. The ZAP engine is downloaded by install-tools.ps1.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/security/zap-scan.ps1 -TargetUrl http://localhost:3000
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TargetUrl,
  [string]$BaseDir = $(if ($env:SECURITY_TOOLS_DIR) { $env:SECURITY_TOOLS_DIR } else { Join-Path $env:TEMP "opencode\security-tools" }),
  [int]$Port = 8090,
  [int]$SpiderMinutes = 2,
  [switch]$Active
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ReportsDir = Join-Path (Get-Location) 'security-reports'
New-Item -ItemType Directory -Path $ReportsDir -Force | Out-Null

$zapDir = Join-Path $BaseDir 'zap\ZAP_2.17.0'
$zapBat = Join-Path $zapDir 'zap.bat'
$python = Join-Path $BaseDir 'venv\Scripts\python.exe'
$driver = Join-Path $PSScriptRoot 'zap_scan.py'
$daemonLog = Join-Path $ReportsDir 'zap-daemon.out'

if (-not (Test-Path -LiteralPath $zapBat)) {
  throw "ZAP engine not found at $zapBat - run: npm run security:install"
}

$proc = $null
try {
  Write-Host "[zap ] starting engine on port $Port"
  $proc = Start-Process -FilePath $zapBat -WorkingDirectory $zapDir `
    -ArgumentList @('-daemon', '-port', "$Port", '-host', '127.0.0.1',
      '-config', 'api.disablekey=true',
      '-config', 'api.addrs.addr.name=.*',
      '-config', 'api.addrs.addr.regex=true') `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $daemonLog

  $driverArgs = @($driver, '-t', $TargetUrl, '-p', "$Port",
    '-J', (Join-Path $ReportsDir 'zap.json'),
    '-r', (Join-Path $ReportsDir 'zap.html'),
    '-m', "$SpiderMinutes")
  if ($Active) { $driverArgs += '-a' }

  Write-Host "[zap ] scanning $TargetUrl"
  & $python @driverArgs
}
finally {
  if ($proc -and -not $proc.HasExited) {
    & taskkill /PID $proc.Id /T /F *> $null
  }
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

Write-Host "[zap ] done -> $ReportsDir"
