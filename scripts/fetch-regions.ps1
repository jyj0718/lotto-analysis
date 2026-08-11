# Fetch 1st-prize winning store data for every round (StartRound to EndRound)
# and append rows to data\stores-raw.csv (resumable: rounds already present are skipped).
# Source: https://github.com/smok95/lotto winning-stores endpoint (GitHub Pages).
param(
    [int]$StartRound = 262,
    [int]$EndRound = 1235
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$csvFile = Join-Path $root "data\stores-raw.csv"

# City codes are matched before province codes so an address like "전남광주"
# (legacy prefix meaning Gwangju) resolves to Gwangju (24), not Jeonnam (36).
$regionMap = @(
    @{ code = '11'; keys = @('서울') },
    @{ code = '21'; keys = @('부산') },
    @{ code = '22'; keys = @('대구') },
    @{ code = '23'; keys = @('인천') },
    @{ code = '24'; keys = @('광주') },
    @{ code = '25'; keys = @('대전') },
    @{ code = '26'; keys = @('울산') },
    @{ code = '29'; keys = @('세종') },
    @{ code = '31'; keys = @('경기') },
    @{ code = '32'; keys = @('강원') },
    @{ code = '33'; keys = @('충북', '충청북도') },
    @{ code = '34'; keys = @('충남', '충청남도') },
    @{ code = '35'; keys = @('전북', '전라북도') },
    @{ code = '36'; keys = @('전남', '전라남도') },
    @{ code = '37'; keys = @('경북', '경상북도') },
    @{ code = '38'; keys = @('경남', '경상남도') },
    @{ code = '39'; keys = @('제주') }
)

function Get-RegionCode([string]$address) {
    if ([string]::IsNullOrWhiteSpace($address)) { return '' }
    $head = $address.Substring(0, [Math]::Min(8, $address.Length))
    foreach ($m in $regionMap) {
        foreach ($k in $m.keys) {
            if ($head.Contains($k)) { return $m.code }
        }
    }
    return ''
}

$doneRounds = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $csvFile) {
    Import-Csv $csvFile | ForEach-Object { [void]$doneRounds.Add($_.round) }
    Write-Host "Resuming: $($doneRounds.Count) rounds already recorded."
} else {
    "round,name,address,region,lat,lng" | Set-Content -Path $csvFile -Encoding UTF8
}

$missing = @()
$buffer = New-Object System.Collections.Generic.List[object]

for ($n = $StartRound; $n -le $EndRound; $n++) {
    if ($doneRounds.Contains("$n")) { continue }

    $url = "https://smok95.github.io/lotto/winning-stores/$n.json"
    $attempt = 0
    $ok = $false
    $stores = @()
    while (-not $ok -and $attempt -lt 3) {
        $attempt++
        try {
            $resp = Invoke-WebRequest -Uri $url -TimeoutSec 15 -UseBasicParsing
            $stores = $resp.Content | ConvertFrom-Json
            if ($null -eq $stores) { $stores = @() }
            $ok = $true
        } catch {
            if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 404) {
                $stores = @()
                $ok = $true
            } else {
                Start-Sleep -Milliseconds 400
            }
        }
    }
    if (-not $ok) { $missing += $n; continue }

    if ($stores.Count -eq 0) {
        $buffer.Add([PSCustomObject]@{ round = $n; name = ''; address = ''; region = ''; lat = ''; lng = '' })
    } else {
        foreach ($s in $stores) {
            $buffer.Add([PSCustomObject]@{
                round   = $n
                name    = $s.name
                address = $s.address
                region  = Get-RegionCode $s.address
                lat     = $s.lat
                lng     = $s.lng
            })
        }
    }

    if ($n % 50 -eq 0 -or $n -eq $EndRound) {
        $buffer | Export-Csv -Path $csvFile -Append -NoTypeInformation -Encoding UTF8
        Write-Host "Progress: round $n done, wrote $($buffer.Count) rows."
        $buffer.Clear()
    }
}

if ($buffer.Count -gt 0) {
    $buffer | Export-Csv -Path $csvFile -Append -NoTypeInformation -Encoding UTF8
}

if ($missing.Count -gt 0) {
    Write-Host "Missing rounds after retries: $($missing -join ', ')"
} else {
    Write-Host "All rounds in range fetched successfully."
}
Write-Host "Raw data saved to $csvFile"
