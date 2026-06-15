param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcTauri = Join-Path $repoRoot "src-tauri"
$targetDir = Join-Path $srcTauri "target"
$releaseDir = Join-Path $targetDir "release"
$tauriConfigPath = Join-Path $srcTauri "tauri.conf.json"
$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$productName = $tauriConfig.productName
$appVersion = $tauriConfig.version
$productVersionQuad = "$($appVersion.Split('-')[0]).0"
$appExeName = "emview-tauri.exe"
$appExePath = Join-Path $releaseDir $appExeName
$iconPath = Join-Path $srcTauri "icons\icon.ico"
$nsisVersion = "3.11"
$nsisDir = Join-Path $targetDir "nsis-$nsisVersion"
$nsisZip = Join-Path $targetDir "nsis-$nsisVersion.zip"
$makensis = Join-Path $nsisDir "makensis.exe"
$bundleDir = Join-Path $releaseDir "bundle\onefile"
$sfxScript = Join-Path $bundleDir "onefile-sfx.nsi"
$onefilePath = Join-Path $bundleDir "$($productName)_$($appVersion)_x64-onefile.exe"

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

if (-not (Test-Path $appExePath)) {
  throw "Expected release executable was not found: $appExePath"
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

$scriptContent = @'
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
ManifestSupportedOS all
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow

!ifndef PRODUCT_NAME
!define PRODUCT_NAME "EMView"
!endif
!ifndef PRODUCT_VERSION
!define PRODUCT_VERSION "1.0.0"
!endif
!ifndef PRODUCT_VERSION_QUAD
!define PRODUCT_VERSION_QUAD "1.0.0.0"
!endif
!ifndef PRODUCT_PUBLISHER
!define PRODUCT_PUBLISHER "EMView"
!endif
!ifndef APP_EXE
!define APP_EXE "emview-tauri.exe"
!endif

Name "${PRODUCT_NAME}"
OutFile "${OUTPUT_EXE}"
Icon "${ICON_PATH}"
BrandingText "${PRODUCT_NAME}"

VIProductVersion "${PRODUCT_VERSION_QUAD}"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 ${PRODUCT_PUBLISHER}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} Self-Extracting Package"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"

Section "Run"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "/oname=${APP_EXE}" "${SOURCE_EXE}"
  ExecWait '"$PLUGINSDIR\${APP_EXE}"'
SectionEnd
'@

Set-Content -LiteralPath $sfxScript -Value $scriptContent -Encoding UTF8

$env:PATH = "$nsisDir;$nsisDir\Bin;$env:PATH"
Invoke-Checked -FilePath $makensis -Arguments @(
  "/V2",
  "/DPRODUCT_NAME=$productName",
  "/DPRODUCT_VERSION=$appVersion",
  "/DPRODUCT_VERSION_QUAD=$productVersionQuad",
  "/DPRODUCT_PUBLISHER=$productName",
  "/DAPP_EXE=$appExeName",
  "/DSOURCE_EXE=$appExePath",
  "/DOUTPUT_EXE=$onefilePath",
  "/DICON_PATH=$iconPath",
  $sfxScript
) -WorkingDirectory $bundleDir

if (-not (Test-Path $onefilePath)) {
  throw "Expected self-extracting package was not created: $onefilePath"
}

Write-Host "Created onefile self-extracting package: $onefilePath"
