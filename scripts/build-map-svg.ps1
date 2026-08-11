# Build data/kr-map.js: SVG path data for the 17 Korean provinces (si/do level),
# projected from KOSTAT TopoJSON (via southkorea/southkorea-maps, free-to-share license).
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outFile = Join-Path $root "data\kr-map.js"

Write-Host "Fetching topojson..."
$resp = Invoke-WebRequest -Uri "https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-provinces-2018-topo-simple.json" -TimeoutSec 60 -UseBasicParsing
$text = $resp.Content

Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.RecursionLimit = 200
$ser.MaxJsonLength = 50000000
$topo = $ser.DeserializeObject($text)

$scale = $topo["transform"]["scale"]
$translate = $topo["transform"]["translate"]
$sx = [double]$scale[0]; $sy = [double]$scale[1]
$tx = [double]$translate[0]; $ty = [double]$translate[1]

Write-Host "Decoding arcs..."
$arcsRaw = $topo["arcs"]
$decodedArcs = New-Object 'System.Collections.Generic.List[object]'
foreach ($arc in $arcsRaw) {
    $x = 0.0; $y = 0.0
    $pts = New-Object 'System.Collections.Generic.List[double[]]'
    foreach ($pt in $arc) {
        $x += [double]$pt[0]
        $y += [double]$pt[1]
        $lon = $x * $sx + $tx
        $lat = $y * $sy + $ty
        $pts.Add(@($lon, $lat))
    }
    $decodedArcs.Add($pts)
}
Write-Host "Decoded $($decodedArcs.Count) arcs."

function Get-ArcPoints($idx) {
    if ($idx -lt 0) {
        $real = (-1 - $idx)
        $pts = $decodedArcs[$real]
        $rev = New-Object 'System.Collections.Generic.List[double[]]'
        for ($i = $pts.Count - 1; $i -ge 0; $i--) { $rev.Add($pts[$i]) }
        return $rev
    } else {
        return $decodedArcs[$idx]
    }
}

function Build-Ring($arcIdxList) {
    $ring = New-Object 'System.Collections.Generic.List[double[]]'
    $first = $true
    foreach ($idx in $arcIdxList) {
        $pts = Get-ArcPoints ([int]$idx)
        if ($first) {
            foreach ($p in $pts) { $ring.Add($p) }
            $first = $false
        } else {
            for ($i = 1; $i -lt $pts.Count; $i++) { $ring.Add($pts[$i]) }
        }
    }
    return $ring
}

$objName = ($topo["objects"].Keys | Select-Object -First 1)
$geometries = $topo["objects"][$objName]["geometries"]
Write-Host "Object: $objName, geometries: $($geometries.Count)"

$features = New-Object 'System.Collections.Generic.List[object]'
$minLon = [double]::MaxValue; $maxLon = [double]::MinValue
$minLat = [double]::MaxValue; $maxLat = [double]::MinValue

foreach ($g in $geometries) {
    $props = $g["properties"]
    $rings = New-Object 'System.Collections.Generic.List[object]'
    if ($g["type"] -eq "Polygon") {
        foreach ($ring in $g["arcs"]) {
            $r = Build-Ring $ring
            $rings.Add($r)
        }
    } elseif ($g["type"] -eq "MultiPolygon") {
        foreach ($poly in $g["arcs"]) {
            foreach ($ring in $poly) {
                $r = Build-Ring $ring
                $rings.Add($r)
            }
        }
    }
    foreach ($r in $rings) {
        foreach ($p in $r) {
            if ($p[0] -lt $minLon) { $minLon = $p[0] }
            if ($p[0] -gt $maxLon) { $maxLon = $p[0] }
            if ($p[1] -lt $minLat) { $minLat = $p[1] }
            if ($p[1] -gt $maxLat) { $maxLat = $p[1] }
        }
    }
    $features.Add([PSCustomObject]@{
        code    = $props["code"]
        name    = $props["name"]
        nameEng = $props["name_eng"]
        rings   = $rings
    })
}

Write-Host "Bounds: lon $minLon..$maxLon, lat $minLat..$maxLat"

# Equirectangular projection with cos(midLat) correction, flipped Y (SVG y grows downward).
$midLatRad = (($minLat + $maxLat) / 2.0) * [Math]::PI / 180.0
$cosMid = [Math]::Cos($midLatRad)
$lonSpan = ($maxLon - $minLon) * $cosMid
$latSpan = ($maxLat - $minLat)

$targetWidth = 640.0
$scaleFactor = $targetWidth / $lonSpan
$targetHeight = $latSpan * $scaleFactor

function Project($lon, $lat) {
    $x = ($lon - $minLon) * $cosMid * $scaleFactor
    $y = ($maxLat - $lat) * $scaleFactor
    return @([Math]::Round($x, 2), [Math]::Round($y, 2))
}

Write-Host "Building SVG paths..."
$provinceList = New-Object 'System.Collections.Generic.List[object]'
foreach ($f in $features) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($r in $f.rings) {
        $first = $true
        foreach ($p in $r) {
            $xy = Project $p[0] $p[1]
            if ($first) {
                [void]$sb.Append("M$($xy[0]),$($xy[1])")
                $first = $false
            } else {
                [void]$sb.Append("L$($xy[0]),$($xy[1])")
            }
        }
        [void]$sb.Append("Z")
    }
    $provinceList.Add([PSCustomObject]@{
        code    = $f.code
        name    = $f.name
        nameEng = $f.nameEng
        d       = $sb.ToString()
    })
}

$mapObj = [PSCustomObject]@{
    width     = [Math]::Round($targetWidth, 1)
    height    = [Math]::Round($targetHeight, 1)
    provinces = $provinceList
}
$json = $mapObj | ConvertTo-Json -Compress -Depth 6
$js = "// Auto-generated by scripts/build-map-svg.ps1 from KOSTAT province boundaries (southkorea/southkorea-maps, free to share/remix).`nwindow.KR_MAP = $json;`n"
[System.IO.File]::WriteAllText($outFile, $js, (New-Object System.Text.UTF8Encoding($true)))

Write-Host "Done: $outFile ($($provinceList.Count) provinces, ${targetWidth}x$([Math]::Round($targetHeight,1)))"
