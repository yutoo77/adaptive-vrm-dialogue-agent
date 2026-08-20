$ErrorActionPreference = "Stop"

$backendPath = Join-Path $PSScriptRoot "backend"
$frontendPath = Join-Path $PSScriptRoot "frontend"
$pythonPath = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$runtimePath = Join-Path $backendPath ".runtime"
$backendOutput = Join-Path $runtimePath "backend.stdout.log"
$backendError = Join-Path $runtimePath "backend.stderr.log"
$backendPidFile = Join-Path $runtimePath "backend.pid"
$healthUrl = "http://127.0.0.1:8000/api/health"
$transcriptionHealthUrl = "http://127.0.0.1:8000/api/transcription/health"
$frontendUrl = "http://127.0.0.1:5173/"

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$RootProcessId)

    $childIds = Get-CimInstance Win32_Process -Filter "ParentProcessId = $RootProcessId" -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty ProcessId
    foreach ($childId in $childIds) {
        Stop-ProcessTree -RootProcessId $childId
    }

    Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

function Get-ListenerProcessIds {
    param([Parameter(Mandatory = $true)][int]$Port)

    return @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
}

function Test-AdaptiveBackend {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) {
        return $false
    }

    $commandLine = [string]$process.CommandLine
    if (
        $commandLine -notmatch "(?i)-m\s+uvicorn\s+app\.main:app" -or
        $commandLine -notmatch "(?i)--host\s+127\.0\.0\.1" -or
        $commandLine -notmatch "(?i)--port\s+8000"
    ) {
        return $false
    }

    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        $transcriptionHealth = Invoke-RestMethod -Uri $transcriptionHealthUrl -TimeoutSec 2
        return (
            $health.provider -in @("mock", "openai") -and
            $transcriptionHealth.provider -eq "faster-whisper"
        )
    }
    catch {
        return $false
    }
}

function Test-AdaptiveFrontend {
    try {
        $response = Invoke-WebRequest -Uri $frontendUrl -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -like "*<title>Adaptive Character</title>*"
    }
    catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Python environment not found. Create .venv by following README.md."
}

if (-not (Test-Path -LiteralPath (Join-Path $frontendPath "node_modules"))) {
    throw "Frontend dependencies not found. Run npm install in frontend."
}

New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null

$backendListenerIds = Get-ListenerProcessIds -Port 8000
$frontendListenerIds = Get-ListenerProcessIds -Port 5173

if ($frontendListenerIds.Count -gt 0) {
    $backendIsReady = $backendListenerIds.Count -eq 1 -and (Test-AdaptiveBackend -ProcessId $backendListenerIds[0])
    if ($frontendListenerIds.Count -eq 1 -and (Test-AdaptiveFrontend) -and $backendIsReady) {
        Write-Host "Adaptive Character Lab is already running." -ForegroundColor Green
        Write-Host "Demo: $frontendUrl" -ForegroundColor Cyan
        exit 0
    }

    $frontendPids = $frontendListenerIds -join ", "
    throw "Port 5173 is already in use by PID(s): $frontendPids. Stop that process and retry."
}

$backendProcess = $null
$reusedBackend = $false

if ($backendListenerIds.Count -gt 0) {
    if ($backendListenerIds.Count -ne 1 -or -not (Test-AdaptiveBackend -ProcessId $backendListenerIds[0])) {
        $backendPids = $backendListenerIds -join ", "
        throw "Port 8000 is already in use by an unrecognized process (PID(s): $backendPids)."
    }

    $backendProcess = Get-Process -Id $backendListenerIds[0]
    $reusedBackend = $true
    Write-Host "Reusing the existing Adaptive Character Lab backend (PID $($backendProcess.Id))." -ForegroundColor DarkYellow
}
else {
    $backendProcess = Start-Process `
        -FilePath $pythonPath `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000") `
        -WorkingDirectory $backendPath `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendOutput `
        -RedirectStandardError $backendError `
        -PassThru
}

[System.IO.File]::WriteAllText($backendPidFile, [string]$backendProcess.Id)

try {
    $health = $null
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($backendProcess.HasExited) {
            $errorText = Get-Content -LiteralPath $backendError -Raw -ErrorAction SilentlyContinue
            throw "Backend failed to start.`n$errorText"
        }

        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
            break
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }

    if (-not $health) {
        throw "Backend health check timed out. See logs in backend/.runtime."
    }

    Write-Host "Backend: $($health.provider) / $($health.model)" -ForegroundColor Cyan
    if ($reusedBackend) {
        Write-Host "Recovered a backend left by an earlier launch." -ForegroundColor DarkYellow
    }
    Write-Host "Demo: $frontendUrl" -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to stop both servers." -ForegroundColor DarkGray

    Set-Location -LiteralPath $frontendPath
    npm run dev
}
finally {
    if ($backendProcess) {
        Stop-ProcessTree -RootProcessId $backendProcess.Id
    }
    Remove-Item -LiteralPath $backendPidFile -Force -ErrorAction SilentlyContinue
}
