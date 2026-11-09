#requires -Version 5.1
<#
.SYNOPSIS
  Builds a signed release APK and (only with -Publish) creates a GitHub release.
.EXAMPLE
  .\release.ps1 -VersionName 0.2.0 -VersionCode 2 -Notes "Adds self-update"
  .\release.ps1 -VersionName 0.2.0 -VersionCode 2 -Notes "Adds self-update" -Publish
#>
param(
    [Parameter(Mandatory = $true)][string]$VersionName,
    [Parameter(Mandatory = $true)][int]$VersionCode,
    [string]$Notes = "",
    [string]$Repo = "",
    [switch]$Publish
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$AppDir = Join-Path $Root "app"
$Props = Join-Path $AppDir "gradle.properties"
$Gradle = "C:\Android\gradle-8.10.2\bin\gradle.bat"
$OutDir = Join-Path $ScriptDir "out"

# The release repo is the one the app checks for updates (UPDATE_REPO in app/gradle.properties).
if (-not $Repo) {
    $m = Select-String -Path $Props -Pattern '^UPDATE_REPO=(\S+)' | Select-Object -First 1
    if (-not $m) { throw "Set UPDATE_REPO=owner/name in $Props or pass -Repo" }
    $Repo = $m.Matches[0].Groups[1].Value
}

if ($VersionName -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$') { throw "VersionName must look like 1.2.3" }
if ($VersionCode -lt 1) { throw "VersionCode must be a positive integer" }
if (-not (Test-Path (Join-Path $AppDir "keystore.properties"))) {
    throw "Missing $AppDir\keystore.properties (storeFile, storePassword, keyAlias, keyPassword)."
}

# 1. Update version properties
$lines = Get-Content $Props
$lines = $lines | ForEach-Object {
    if ($_ -match '^APP_VERSION_CODE=') { "APP_VERSION_CODE=$VersionCode" }
    elseif ($_ -match '^APP_VERSION_NAME=') { "APP_VERSION_NAME=$VersionName" }
    else { $_ }
}
Set-Content -Path $Props -Value $lines -Encoding ASCII
Write-Host "Set version $VersionName ($VersionCode) in gradle.properties"

# 2. Test and build the signed release
& $Gradle -p $AppDir ":app:testDebugUnitTest" ":app:assembleRelease"
if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }

# 3. Collect the APK
$built = Join-Path $AppDir "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $built)) { throw "Signed APK not found at $built" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$apk = Join-Path $OutDir "app.apk"
Copy-Item $built $apk -Force

# 4. Checksum, size, metadata
$sha = (Get-FileHash -Algorithm SHA256 -Path $apk).Hash.ToLower()
$size = (Get-Item $apk).Length
$meta = [ordered]@{
    versionCode = $VersionCode
    versionName = $VersionName
    sha256      = $sha
    size        = [long]$size
    notes       = $Notes
}
$metaPath = Join-Path $OutDir "meta.json"
[System.IO.File]::WriteAllText($metaPath, ($meta | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))

# 5. Verify the signature
$apksigner = $null
foreach ($v in @("36.0.0", "35.0.0")) {
    $candidate = "C:\Users\Admin\android-sdk\build-tools\$v\apksigner.bat"
    if (Test-Path $candidate) { $apksigner = $candidate; break }
}
if (-not $apksigner) { throw "apksigner not found in build-tools 36.0.0 or 35.0.0" }
& $apksigner verify --verbose $apk
if ($LASTEXITCODE -ne 0) { throw "apksigner verification failed" }

Write-Host ""
Write-Host "APK:     $apk"
Write-Host "Size:    $size bytes"
Write-Host "SHA-256: $sha"

# 6. Publish only on request
if (-not $Publish) {
    Write-Host ""
    Write-Host "Dry run complete; nothing published"
    return
}

$title = "Samsung Server $VersionName"
$releaseNotes = if ($Notes) { $Notes } else { $title }
& gh release create "v$VersionName" $apk $metaPath --repo $Repo --title $title --notes $releaseNotes
if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
Write-Host "Published v$VersionName to $Repo"
