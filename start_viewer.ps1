$ErrorActionPreference = "Stop"
$frontendPath = Join-Path $PSScriptRoot "frontend"

if (-not (Test-Path -LiteralPath (Join-Path $frontendPath "node_modules"))) {
    throw "依存関係がありません。frontend で npm install を実行してください。"
}

Set-Location -LiteralPath $frontendPath
npm run dev
