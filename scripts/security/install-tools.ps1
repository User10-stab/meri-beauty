<#
.SYNOPSIS
  Installs the lightweight pentest toolchain (Gitleaks, Trivy, Nuclei, Semgrep).

.DESCRIPTION
  Downloads pinned Windows binaries into <BaseDir>\bin and creates a Python
  virtualenv with Semgrep under <BaseDir>\venv. Idempotent - existing tools are
  skipped. Defaults to %TEMP%\opencode\security-tools so the repo's C: drive
  stays untouched. Override with -BaseDir or $env:SECURITY_TOOLS_DIR.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/security/install-tools.ps1
#>
[CmdletBinding()]
param(
  [string]$BaseDir = $(if ($env:SECURITY_TOOLS_DIR) { $env:SECURITY_TOOLS_DIR } else { Join-Path $env:TEMP "opencode\security-tools" })
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$versions = @{ gitleaks = '8.30.1'; trivy = '0.74.0'; nuclei = '3.11.1' }
$urls = @{
  gitleaks = "https://github.com/gitleaks/gitleaks/releases/download/v$($versions.gitleaks)/gitleaks_$($versions.gitleaks)_windows_x64.zip"
  trivy    = "https://github.com/aquasecurity/trivy/releases/download/v$($versions.trivy)/trivy_$($versions.trivy)_windows-64bit.zip"
  nuclei   = "https://github.com/projectdiscovery/nuclei/releases/download/v$($versions.nuclei)/nuclei_$($versions.nuclei)_windows_amd64.zip"
}

$BinDir = Join-Path $BaseDir 'bin'
$DataDir = Join-Path $BaseDir 'data'
$VenvDir = Join-Path $BaseDir 'venv'
foreach ($d in @($BaseDir, $BinDir, $DataDir)) {
  New-Item -ItemType Directory -Path $d -Force | Out-Null
}

Write-Host "Tool directory: $BaseDir`n"

foreach ($name in 'gitleaks', 'trivy', 'nuclei') {
  $exePath = Join-Path $BinDir "$name.exe"
  if (Test-Path -LiteralPath $exePath) { Write-Host "[skip] $name already installed"; continue }
  $zip = Join-Path $BaseDir "$name.zip"
  Write-Host "[get ] $name $($versions[$name])"
  Invoke-WebRequest -Uri $urls[$name] -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $BinDir -Force
  Remove-Item -LiteralPath $zip -Force
}

$venvPython = Join-Path $VenvDir 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
  Write-Host "[venv] creating $VenvDir"
  python -m venv $VenvDir
}
Write-Host "[pip ] semgrep"
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install semgrep --quiet

# OWASP ZAP engine - used by security:dast. ~273 MB, only downloaded once.
$zapMarker = Join-Path $BaseDir 'zap\ZAP_2.17.0\zap.bat'
if (Test-Path -LiteralPath $zapMarker) {
  Write-Host "[skip] OWASP ZAP already installed"
} else {
  Write-Host "[get ] OWASP ZAP 2.17.0 (~273 MB)"
  $zapZip = Join-Path $BaseDir 'zap.zip'
  Invoke-WebRequest -Uri 'https://github.com/zaproxy/zaproxy/releases/download/v2.17.0/ZAP_2.17.0_Crossplatform.zip' -OutFile $zapZip
  Expand-Archive -LiteralPath $zapZip -DestinationPath (Join-Path $BaseDir 'zap') -Force
  Remove-Item -LiteralPath $zapZip -Force
}

Write-Host "`nInstalled versions:"
& (Join-Path $BinDir 'gitleaks.exe') version
& (Join-Path $BinDir 'trivy.exe') --version
& (Join-Path $BinDir 'nuclei.exe') -version
& (Join-Path $VenvDir 'Scripts\semgrep.exe') --version
