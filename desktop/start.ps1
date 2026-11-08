$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $projectRoot '.env'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Missing desktop/.env. Copy .env.example to .env and fill in private values.'
}

Get-Content -LiteralPath $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#')) {
    $parts = $line -split '=', 2
    if ($parts.Count -eq 2 -and $parts[0].Trim()) {
      Set-Item -Path ('Env:' + $parts[0].Trim()) -Value $parts[1].Trim()
    }
  }
}

Set-Location -LiteralPath $projectRoot
node .\bin\codex-pocket.mjs
