[CmdletBinding()]
param(
    [switch]$Development,
    [switch]$PrepareTranscriptionModel
)

$ErrorActionPreference = "Stop"

$repoPath = $PSScriptRoot
$venvPython = Join-Path $repoPath ".venv\Scripts\python.exe"
$requirements = if ($Development) {
    Join-Path $repoPath "backend\requirements-dev.txt"
}
else {
    Join-Path $repoPath "backend\requirements.txt"
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        Write-Host "Creating Python 3.12 environment..." -ForegroundColor Cyan
        Invoke-CheckedCommand `
            -FilePath $pyLauncher.Source `
            -ArgumentList @("-3.12", "-m", "venv", (Join-Path $repoPath ".venv")) `
            -FailureMessage "Python 3.12 virtual environment could not be created."
    }
    else {
        $python = Get-Command python -ErrorAction SilentlyContinue
        if (-not $python) {
            throw "Python 3.12 was not found. Install it and retry."
        }
        $version = & $python.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
        if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne "3.12") {
            throw "Python 3.12 is required. The detected python command reports $version."
        }
        Write-Host "Creating Python 3.12 environment..." -ForegroundColor Cyan
        Invoke-CheckedCommand `
            -FilePath $python.Source `
            -ArgumentList @("-m", "venv", (Join-Path $repoPath ".venv")) `
            -FailureMessage "Python 3.12 virtual environment could not be created."
    }
}

$venvVersion = & $venvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($LASTEXITCODE -ne 0 -or $venvVersion.Trim() -ne "3.12") {
    throw "The existing .venv does not use Python 3.12. Recreate it and retry."
}

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    throw "Node.js and npm were not found. Install Node.js 22 LTS and retry."
}
$nodeVersionText = & $node.Source -p "process.versions.node"
if ($LASTEXITCODE -ne 0) {
    throw "The Node.js version could not be read."
}
$nodeVersion = [version]$nodeVersionText.Trim()
$supportedNode = (
    ($nodeVersion.Major -eq 20 -and $nodeVersion -ge [version]"20.19.0") -or
    $nodeVersion -ge [version]"22.12.0"
)
if (-not $supportedNode) {
    throw "Node.js 20.19+ or 22.12+ is required. Detected $nodeVersion."
}

Write-Host "Installing Backend dependencies..." -ForegroundColor Cyan
Invoke-CheckedCommand `
    -FilePath $venvPython `
    -ArgumentList @("-m", "pip", "install", "-r", $requirements) `
    -FailureMessage "Backend dependency installation failed."

Write-Host "Installing Frontend dependencies..." -ForegroundColor Cyan
Push-Location -LiteralPath (Join-Path $repoPath "frontend")
try {
    Invoke-CheckedCommand `
        -FilePath $npm.Source `
        -ArgumentList @("ci") `
        -FailureMessage "Frontend dependency installation failed."
}
finally {
    Pop-Location
}

if ($Development) {
    Write-Host "Installing Chromium for browser smoke tests..." -ForegroundColor Cyan
    Push-Location -LiteralPath (Join-Path $repoPath "frontend")
    try {
        Invoke-CheckedCommand `
            -FilePath $npm.Source `
            -ArgumentList @("exec", "--", "playwright", "install", "chromium") `
            -FailureMessage "Playwright Chromium installation failed."
    }
    finally {
        Pop-Location
    }
}

if ($PrepareTranscriptionModel) {
    Write-Host "Preparing the local speech-recognition model..." -ForegroundColor Cyan
    Push-Location -LiteralPath (Join-Path $repoPath "backend")
    try {
        Invoke-CheckedCommand `
            -FilePath $venvPython `
            -ArgumentList @("-m", "scripts.prepare_transcription_model") `
            -FailureMessage "The speech-recognition model could not be prepared."
    }
    finally {
        Pop-Location
    }
}

Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Run .\start_demo.ps1 from the repository root." -ForegroundColor Cyan
if (-not $PrepareTranscriptionModel) {
    Write-Host "Push-to-Talk downloads its model later. Use -PrepareTranscriptionModel to prepare it now." -ForegroundColor DarkGray
}
