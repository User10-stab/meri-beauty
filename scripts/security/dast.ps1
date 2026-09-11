<#
.SYNOPSIS
  Runs dynamic scans (Nuclei templates + OWASP ZAP baseline) against a running app.

.DESCRIPTION
  Point this at an already-running instance (local `next dev`, staging, etc.).
  Nuclei runs first; ZAP baseline is optional (it downloads OWASP ZAP on first
  use, ~350 MB into the tool venv). Reports land in ./security-reports.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/security/dast.ps1 -TargetUrl http://localhost:3000
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TargetUrl,
  [string]$BaseDir = $(if ($env:SECURITY_TOOLS_DIR) { $env:SECURITY_TOOLS_DIR } else { Join-Path $env:TEMP "opencode\security-tools" }),
  [switch]$SkipZap,
  [switch]$SkipTemplatesUpdate
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ReportsDir = Join-Path (Get-Location) 'security-reports'
New-Item -ItemType Directory -Path $ReportsDir -Force | Out-Null

$nuclei = Join-Path $BaseDir 'bin\nuclei.exe'
if (-not (Test-Path -LiteralPath $nuclei)) {
  throw "nuclei not found at $nuclei - run: npm run security:install"
}

if (-not $SkipTemplatesUpdate) {
  Write-Host "[nuclei] updating templates"
  & $nuclei -update-templates
}

Write-Host "[nuclei] scanning $TargetUrl"
& $nuclei -u $TargetUrl -severity critical,high,medium `
  -jsonl -o (Join-Path $ReportsDir 'nuclei.jsonl') -rate-limit 150 -silent

if (-not $SkipZap) {
  Write-Host "[zap ] baseline (spider + passive) scan"
  & (Join-Path $PSScriptRoot 'zap-scan.ps1') -TargetUrl $TargetUrl -BaseDir $BaseDir
  if ($LASTEXITCODE -ne 0) { Write-Warning "ZAP scan exited with $LASTEXITCODE" }
}

Write-Host "`nReports: $ReportsDir"
