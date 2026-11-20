# Makes every VINAC Link icon size from the one brand image, site/brand/vinac-icon.png (square).
# Windows PowerShell (uses System.Drawing). Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File connector/tools/make-icons.ps1
# Writes:
#   .claude-plugin/icon.png          512 px, square (plugin directories round it themselves; the
#                                   directory accepts 512-2048 px, and 512 keeps the npm package small)
#   connector/web/icon.png          128 px, rounded (the VINAC Link page: header and browser tab)
#   site/brand/icon-512.png         512 px, square (link previews, home-screen icon)
#   site/brand/icon-128.png         128 px, rounded (website header and footer mark)
#   site/brand/favicon-32.png        32 px, rounded (browser tab)
#   connector/tools/installers/icons/win-*.png, mac-*.png   app icons for the installers
Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$src = Join-Path $root 'site\brand\vinac-icon.png'
if (-not (Test-Path $src)) { throw "Missing $src" }
$image = [System.Drawing.Image]::FromFile($src)

function Save-Icon([int]$size, [string]$out, [bool]$rounded, [double]$margin = 0) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  if ($rounded) {
    # $margin: empty border as a share of the size (macOS app icons leave about 10% around the artwork)
    $o = [Math]::Round($size * $margin); $s = $size - 2 * $o
    $r = [Math]::Round($s * 0.225) * 2
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($o, $o, $r, $r, 180, 90); $p.AddArc($o + $s - $r, $o, $r, $r, 270, 90)
    $p.AddArc($o + $s - $r, $o + $s - $r, $r, $r, 0, 90); $p.AddArc($o, $o + $s - $r, $r, $r, 90, 90); $p.CloseFigure()
    $brush = New-Object System.Drawing.TextureBrush $image
    $scale = $s / $image.Width
    $brush.ScaleTransform($scale, $scale)
    $brush.TranslateTransform($o, $o, [System.Drawing.Drawing2D.MatrixOrder]::Append)
    $brush.WrapMode = 'Clamp'
    $g.FillPath($brush, $p)
  } else {
    $g.DrawImage($image, 0, 0, $size, $size)
  }
  $g.Dispose()
  $full = Join-Path $root $out
  $bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  '{0,-34} {1,5} px  {2,7:N0} bytes' -f $out, $size, (Get-Item $full).Length
}

Save-Icon 512 '.claude-plugin\icon.png' $false
Save-Icon 128 'connector\web\icon.png' $true
Save-Icon 512 'site\brand\icon-512.png' $false
Save-Icon 128 'site\brand\icon-128.png' $true
Save-Icon 32 'site\brand\favicon-32.png' $true
# App icons for the installers (packed into .ico and .icns by connector/tools/installers/build-installers.mjs)
$dir = Join-Path $root 'connector\tools\installers\icons'
New-Item -ItemType Directory -Force $dir | Out-Null
foreach ($n in 256, 48, 32, 16) { Save-Icon $n "connector\tools\installers\icons\win-$n.png" $true }
foreach ($n in 1024, 512, 256, 128) { Save-Icon $n "connector\tools\installers\icons\mac-$n.png" $true 0.1 }
$image.Dispose()
