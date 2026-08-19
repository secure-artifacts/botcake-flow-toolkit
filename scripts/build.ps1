$ErrorActionPreference = "Stop"

$projectPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$driveLetter = @("X", "Y", "Z") | Where-Object { -not (Test-Path "${_}:\") } | Select-Object -First 1
if (-not $driveLetter) {
  throw "No temporary drive letter is available for the extension build."
}

$drive = "${driveLetter}:"
& subst $drive $projectPath
if ($LASTEXITCODE -ne 0) {
  throw "Unable to create the temporary build drive."
}

try {
  Push-Location "${drive}\"
  & node ".\node_modules\vite\bin\vite.js" build
  if ($LASTEXITCODE -ne 0) {
    throw "Vite build failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
  & subst $drive /D | Out-Null
}
