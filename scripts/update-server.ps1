# Local server for the lotto site, built on a raw TCP socket (not HttpListener)
# so it can bind to all network interfaces without needing admin rights or a
# `netsh http add urlacl` reservation (HttpListener requires that for non-localhost
# prefixes; raw sockets don't).
#  - Serves the site's static files so a phone on the same Wi-Fi can open it over
#    http:// and install it as a PWA (file:// pages can't register a service worker).
#  - Handles /update and /status so the site's "최신회차 반영" button works.
# No persistent OS-level configuration (no scheduled task, no registry changes).
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$rootFull = (Resolve-Path $root).Path
$port = 5310

function Get-LanIp {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' }
    $wifi = $candidates | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi' } | Select-Object -First 1
    if ($wifi) { return $wifi.IPAddress }
    $any = $candidates | Select-Object -First 1
    if ($any) { return $any.IPAddress }
    return $null
}

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json; charset=utf-8"
    ".png"  = "image/png"
    ".ico"  = "image/x-icon"
    ".svg"  = "image/svg+xml"
}

function New-Response([int]$statusCode, [string]$statusText, [string]$contentType, [byte[]]$body) {
    return [PSCustomObject]@{ Code = $statusCode; Text = $statusText; ContentType = $contentType; Body = $body }
}

function Get-Response([string]$path) {
    if ($path -eq "/status") {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
        return New-Response 200 "OK" "application/json; charset=utf-8" $bytes
    }
    if ($path -eq "/update") {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 업데이트 요청 수신..."
        try {
            & (Join-Path $root "scripts\update-all.ps1") *>&1 | ForEach-Object { Write-Host $_ }
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 업데이트 완료."
            $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
            return New-Response 200 "OK" "application/json; charset=utf-8" $bytes
        } catch {
            $msg = ($_.Exception.Message -replace '"', "'")
            $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"error":"' + $msg + '"}')
            return New-Response 500 "Internal Server Error" "application/json; charset=utf-8" $bytes
        }
    }

    $relative = $path.TrimStart("/")
    if ([string]::IsNullOrEmpty($relative)) { $relative = "index.html" }
    $relative = $relative -replace "/", "\"
    $candidate = Join-Path $rootFull $relative
    $resolved = $null
    if (Test-Path $candidate -PathType Leaf) { $resolved = (Resolve-Path $candidate).Path }

    if ($resolved -and $resolved.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $ext = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()
        $contentType = $mimeTypes[$ext]
        if (-not $contentType) { $contentType = "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($resolved)
        return New-Response 200 "OK" $contentType $bytes
    }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
    return New-Response 404 "Not Found" "text/plain; charset=utf-8" $bytes
}

function Handle-Client($client) {
    try {
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
        $requestLine = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($requestLine)) { return }
        while ($true) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrEmpty($line)) { break }
        }

        $parts = $requestLine -split '\s+'
        $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
        $rawPath = ($rawPath -split '\?')[0]
        $path = [System.Uri]::UnescapeDataString($rawPath)

        $resp = Get-Response $path

        $headerText =
            "HTTP/1.1 $($resp.Code) $($resp.Text)`r`n" +
            "Content-Type: $($resp.ContentType)`r`n" +
            "Content-Length: $($resp.Body.Length)`r`n" +
            "Access-Control-Allow-Origin: *`r`n" +
            "Cache-Control: no-cache`r`n" +
            "Connection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        if ($resp.Body.Length -gt 0) { $stream.Write($resp.Body, 0, $resp.Body.Length) }
        $stream.Flush()
    } catch {
        Write-Host "요청 처리 오류: $($_.Exception.Message)"
    } finally {
        try { $client.Close() } catch { }
    }
}

$tcpListener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
try {
    $tcpListener.Start()
} catch {
    Write-Host "포트 $port 를 열 수 없습니다. 이미 서버가 실행 중인지 확인해보세요."
    Write-Host "오류: $($_.Exception.Message)"
    Read-Host "엔터를 누르면 창이 닫힙니다"
    exit 1
}

$lanIp = Get-LanIp
Write-Host "로또 사이트 서버가 실행되었습니다."
Write-Host "  - 이 PC에서: http://localhost:$port/"
if ($lanIp) {
    Write-Host "  - 같은 Wi-Fi의 휴대폰에서: http://$lanIp`:$port/"
    Write-Host "    (Chrome으로 열고 메뉴 > '홈 화면에 추가'를 하면 앱처럼 설치됩니다)"
} else {
    Write-Host "  - Wi-Fi IP를 찾지 못했습니다. 같은 네트워크에 연결되어 있는지 확인해주세요."
}
Write-Host "(처음 실행 시 Windows 방화벽이 접근을 물어보면 '허용'을 눌러주세요 — 사설망(Private)에서만 허용해도 충분합니다)"
Write-Host "이 창을 닫으면 서버가 꺼집니다. (Ctrl+C로도 종료 가능)"
Write-Host ""

while ($true) {
    $client = $tcpListener.AcceptTcpClient()
    Handle-Client $client
}
