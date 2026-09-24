param(
  [switch]$SkipEnvCopy,
  [switch]$SkipBootstrapRefresh
)

$ErrorActionPreference = "Stop"

$baseUrl = "https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer"
if (-not $SkipBootstrapRefresh) {
  $bootstrapDownload = "$PSCommandPath.download"
  try {
    Invoke-WebRequest -Uri "$baseUrl/bootstrap-external.ps1" -OutFile $bootstrapDownload
    $parseTokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($bootstrapDownload, [ref]$parseTokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count) { throw "Downloaded bootstrap has invalid PowerShell syntax." }
    if ((Get-FileHash -LiteralPath $PSCommandPath).Hash -ne (Get-FileHash -LiteralPath $bootstrapDownload).Hash) {
      Move-Item -LiteralPath $bootstrapDownload -Destination $PSCommandPath -Force
      Write-Host "[runly-bootstrap] Bootstrap actualizado; continuando con la lista vigente."
      $forwarded = @{} + $PSBoundParameters
      $forwarded.SkipBootstrapRefresh = $true
      & $PSCommandPath @forwarded
      return
    }
  } finally {
    if (Test-Path -LiteralPath $bootstrapDownload) { Remove-Item -LiteralPath $bootstrapDownload -Force }
  }
}
$files = @(
  "docker-compose.yml",
  "docker-compose.linux.yml",
  "lib/devkit-installer.mjs",
  "lib/env-compat.mjs",
  "lib/office-config.mjs",
  "lib/firebase-config.mjs",
  "lib/livekit-config.mjs",
  "lib/transcriber-db.mjs",
  "lib/instance-identity.mjs",
  "package.json",
  "setup-external.mjs",
  "setup-external.sh",
  "stop-external.mjs",
  "stop-external.sh",
  ".env.external.example"
)

Write-Host "[runly-bootstrap] Descargando instalador external en $PWD"

foreach ($file in $files) {
  $outFile = Join-Path $PWD $file
  $outDir = Split-Path -Parent $outFile
  if ($outDir) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  }
  Invoke-WebRequest -Uri "$baseUrl/$file" -OutFile $outFile
}

New-Item -ItemType Directory -Force -Path (Join-Path $PWD "custom-modules") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PWD ".secrets/firebase") | Out-Null

if (-not $SkipEnvCopy -and -not (Test-Path ".\.env.external")) {
  Copy-Item ".\.env.external.example" ".\.env.external"
}

Write-Host "[runly-bootstrap] Archivos listos."
Write-Host "[runly-bootstrap] Siguiente paso: edita .env.external y luego ejecuta npm.cmd run runly:external"
