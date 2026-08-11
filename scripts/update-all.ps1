# Refresh all site data: draw numbers, newly-available winning-store rows, and
# the aggregated region counts. Safe to run repeatedly (incremental / idempotent).
# Intended to be run on a schedule (see scripts/register-schedule.ps1).
$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$root = Split-Path -Parent $scriptDir
$logFile = Join-Path $root "data\update-log.txt"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

try {
    Log "Update started."

    $latestResp = Invoke-WebRequest -Uri "https://smok95.github.io/lotto/results/latest.json" -TimeoutSec 30 -UseBasicParsing
    $latest = ($latestResp.Content | ConvertFrom-Json).draw_no
    Log "Latest round on source: $latest"

    & (Join-Path $scriptDir "fetch-draws.ps1")

    & (Join-Path $scriptDir "fetch-regions.ps1") -StartRound 262 -EndRound $latest

    & (Join-Path $scriptDir "build-regions.ps1")

    Log "Update finished successfully (latest round: $latest)."
} catch {
    Log "ERROR: $($_.Exception.Message)"
    throw
}
