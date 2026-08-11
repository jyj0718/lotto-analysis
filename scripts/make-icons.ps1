# Generate simple PWA icon PNGs (a lotto-ball style icon) using GDI+.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$iconsDir = Join-Path $root "icons"
if (-not (Test-Path $iconsDir)) { New-Item -ItemType Directory -Path $iconsDir | Out-Null }

function New-Icon([int]$size, [string]$outPath) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    # background: rounded-ish square in accent blue
    $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 47, 111, 237))
    $g.FillRectangle($bg, 0, 0, $size, $size)

    # white lotto ball circle
    $margin = [int]($size * 0.14)
    $ballBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.FillEllipse($ballBrush, $margin, $margin, $size - 2 * $margin, $size - 2 * $margin)

    # number text "45" in accent color
    $fontSize = [int]($size * 0.34)
    $font = New-Object System.Drawing.Font("Segoe UI", [single]$fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 47, 111, 237))
    $text = "45"
    $textSize = $g.MeasureString($text, $font)
    $x = ($size - $textSize.Width) / 2
    $y = ($size - $textSize.Height) / 2
    $g.DrawString($text, $font, $textBrush, $x, $y)

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

New-Icon 192 (Join-Path $iconsDir "icon-192.png")
New-Icon 512 (Join-Path $iconsDir "icon-512.png")

Write-Host "Icons created in $iconsDir"
