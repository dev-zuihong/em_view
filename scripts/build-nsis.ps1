param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcTauri = Join-Path $repoRoot "src-tauri"
$targetDir = Join-Path $srcTauri "target"
$nsisVersion = "3.11"
$nsisDir = Join-Path $targetDir "nsis-$nsisVersion"
$nsisZip = Join-Path $targetDir "nsis-$nsisVersion.zip"
$makensis = Join-Path $nsisDir "makensis.exe"
$installerScript = Join-Path $srcTauri "installer\emview.nsi"
$bundleDir = Join-Path $targetDir "release\bundle\nsis"
$setupPath = Join-Path $bundleDir "EMView_0.1.0_x64-setup.exe"

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

if (-not $SkipBuild) {
  Invoke-Checked -FilePath "npx" -Arguments @("tauri", "build", "--no-bundle") -WorkingDirectory $repoRoot
}

if (-not (Test-Path $makensis)) {
  $existingMakensis = Get-Command "makensis.exe" -ErrorAction SilentlyContinue
  if ($existingMakensis) {
    $makensis = $existingMakensis.Source
  } else {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    if (-not (Test-Path $nsisZip)) {
      $nsisUrl = "https://github.com/tauri-apps/binary-releases/releases/download/nsis-$nsisVersion/nsis-$nsisVersion.zip"
      Invoke-WebRequest -Uri $nsisUrl -OutFile $nsisZip
    }
    Expand-Archive -LiteralPath $nsisZip -DestinationPath $targetDir -Force
  }
}

if (-not (Test-Path $makensis)) {
  throw "NSIS makensis.exe was not found. Expected $makensis"
}

New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

$env:PATH = "$nsisDir;$nsisDir\Bin;$env:PATH"
Invoke-Checked -FilePath $makensis -Arguments @("/V2", $installerScript) -WorkingDirectory (Split-Path -Parent $installerScript)

if (-not (Test-Path $setupPath)) {
  throw "Expected installer was not created: $setupPath"
}

Write-Host "Created installer: $setupPath"
