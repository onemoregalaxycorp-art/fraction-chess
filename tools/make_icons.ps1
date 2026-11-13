# Draws the app icons (icons\*.png) with System.Drawing. Run: powershell -ExecutionPolicy Bypass -File tools\make_icons.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot
$dir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $dir | Out-Null

function Draw($size, $file, $pad) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 35, 40, 56)), ([System.Drawing.Color]::FromArgb(255, 11, 13, 19)), 60
  $g.FillRectangle($bg, $rect)
  # 4x4 checker in the middle
  $inner = $size * (1 - 2 * $pad); $c = $inner / 4; $o = $size * $pad
  $light = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 120, 126, 112))
  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 24, 27, 24))
  for ($y = 0; $y -lt 4; $y++) { for ($x = 0; $x -lt 4; $x++) {
    $b = if (($x + $y) % 2) { $dark } else { $light }
    $g.FillRectangle($b, [single]($o + $x * $c), [single]($o + $y * $c), [single]($c - $size * 0.006), [single]($c - $size * 0.006))
  } }
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 251, 191, 36)), ([single]($size * 0.02))
  $g.DrawRectangle($pen, [single]($o - $size * 0.015), [single]($o - $size * 0.015), [single]($inner + $size * 0.03), [single]($inner + $size * 0.03))
  # knight glyph with glow
  $font = New-Object System.Drawing.Font 'Segoe UI Symbol', ([single]($inner * 0.62)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $tr = New-Object System.Drawing.RectangleF 0, ([single]($size * 0.02)), $size, $size
  $glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(110, 0, 0, 0))
  foreach ($d in 1..3) { $t2 = New-Object System.Drawing.RectangleF ([single]($d * $size * 0.006)), ([single]($size * 0.02 + $d * $size * 0.006)), $size, $size; $g.DrawString([string][char]0x265E, $font, $glow, $t2, $fmt) }
  $gold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 251, 191, 36))
  $g.DrawString([string][char]0x265E, $font, $gold, $tr, $fmt)
  $bmp.Save((Join-Path $dir $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Draw 192 'icon-192.png' 0.14
Draw 512 'icon-512.png' 0.14
Draw 512 'icon-maskable-512.png' 0.22
Draw 180 'apple-touch-icon.png' 0.14
Write-Host "OK: icons in $dir"
