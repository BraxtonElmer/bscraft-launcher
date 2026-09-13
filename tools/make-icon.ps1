param([string]$outDir)
# BSCraft logo: a Minecraft grass block (a 16x16 texture, grass dripping over dirt) with
# pixel "BSC" on the dirt. Every size is drawn texel by texel so it stays crisp, and the
# small sizes are packed into a multi-size .ico. Also prints the texture rows for the app.
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $outDir | Out-Null

$palette = @{
  a = '#9ad65f'; g = '#7cbd4a'; h = '#62a13b'; k = '#4a7f2e'
  d = '#8b5a3b'; e = '#6e4630'; f = '#a2714b'; p = '#8d8a88'
}

# Grass reaches down this many rows in each column, ending in a darker edge
$drip = 5, 4, 5, 6, 4, 5, 4, 7, 5, 4, 5, 6, 4, 5, 6, 4
$seed = 7
function Next { $script:seed = ($script:seed * 1103515245 + 12345) % 2147483648; return $script:seed / 2147483648 }
$rows = @()
for ($y = 0; $y -lt 16; $y++) {
  $row = ''
  for ($x = 0; $x -lt 16; $x++) {
    $r = Next
    if ($y -lt $drip[$x] - 1) { $row += if ($r -lt 0.22) { 'a' } elseif ($r -lt 0.8) { 'g' } else { 'h' } }
    elseif ($y -eq $drip[$x] - 1) { $row += if ($r -lt 0.5) { 'h' } else { 'k' } }
    else { $row += if ($r -lt 0.58) { 'd' } elseif ($r -lt 0.8) { 'e' } elseif ($r -lt 0.95) { 'f' } else { 'p' } }
  }
  $rows += $row
}
"TEXTURE:"; $rows | ForEach-Object { "  '$_'," }

$glyphs = @{
  B = @('####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.')
  S = @('.####', '#....', '#....', '.###.', '....#', '....#', '####.')
  C = @('.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.')
}
function Hex([string]$h, [int]$a = 255) { [Drawing.Color]::FromArgb($a, [Convert]::ToInt32($h.Substring(1, 2), 16), [Convert]::ToInt32($h.Substring(3, 2), 16), [Convert]::ToInt32($h.Substring(5, 2), 16)) }

function Render([int]$size, [string]$path) {
  # 1. The block face, texel by texel (edges at floor(i * size / 16) so nothing gaps)
  $face = New-Object Drawing.Bitmap $size, $size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($face)
  for ($y = 0; $y -lt 16; $y++) {
    for ($x = 0; $x -lt 16; $x++) {
      $x0 = [Math]::Floor($x * $size / 16); $x1 = [Math]::Floor(($x + 1) * $size / 16)
      $y0 = [Math]::Floor($y * $size / 16); $y1 = [Math]::Floor(($y + 1) * $size / 16)
      $g.FillRectangle((New-Object Drawing.SolidBrush (Hex $palette["$($rows[$y][$x])"])), $x0, $y0, $x1 - $x0, $y1 - $y0)
    }
  }
  # Soft light from above, a little shade below
  $light = New-Object Drawing.Drawing2D.LinearGradientBrush (New-Object Drawing.Rectangle 0, 0, $size, $size), (Hex '#ffffff' 40), (Hex '#000000' 55), 90.0
  $blend = New-Object Drawing.Drawing2D.ColorBlend 3
  $blend.Colors = @((Hex '#ffffff' 40), (Hex '#ffffff' 0), (Hex '#000000' 55))
  $blend.Positions = @(0.0, 0.45, 1.0)
  $light.InterpolationColors = $blend
  $g.FillRectangle($light, 0, 0, $size, $size)

  # 2. "BSC" on the dirt, cream with a dark shadow (only where it fits)
  if ($size -ge 32) {
    $cells = @(); $x = 0
    foreach ($ch in 'BSC'.ToCharArray()) {
      $gl = $glyphs["$ch"]
      for ($r = 0; $r -lt 7; $r++) { for ($c = 0; $c -lt 5; $c++) { if ($gl[$r][$c] -eq '#') { $cells += , @(($x + $c), $r) } } }
      $x += 6
    }
    $k = [Math]::Max(1, [Math]::Floor($size * 0.78 / 18))
    $ox = [Math]::Floor(($size - 18 * $k) / 2)
    $oy = [Math]::Round($size * 0.66 - 4 * $k)
    $shadow = New-Object Drawing.SolidBrush (Hex '#2e1b10' 210)
    $cream = New-Object Drawing.SolidBrush (Hex '#fff6e0')
    foreach ($c in $cells) { $g.FillRectangle($shadow, $ox + ($c[0] + 1) * $k, $oy + ($c[1] + 1) * $k, $k, $k) }
    foreach ($c in $cells) { $g.FillRectangle($cream, $ox + $c[0] * $k, $oy + $c[1] * $k, $k, $k) }
  }
  $g.Dispose()

  # 3. Rounded corners and a thin dark rim so it reads on light and dark taskbars
  $bmp = New-Object Drawing.Bitmap $size, $size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.Clear([Drawing.Color]::Transparent)
  $g.SmoothingMode = 'AntiAlias'
  $rad = $size * 0.16; $d = 2 * $rad; $e = $size - 0.5
  $shape = New-Object Drawing.Drawing2D.GraphicsPath
  $shape.AddArc(0, 0, $d, $d, 180, 90); $shape.AddArc($e - $d, 0, $d, $d, 270, 90)
  $shape.AddArc($e - $d, $e - $d, $d, $d, 0, 90); $shape.AddArc(0, $e - $d, $d, $d, 90, 90)
  $shape.CloseFigure()
  $g.FillPath((New-Object Drawing.TextureBrush $face), $shape)
  $rim = New-Object Drawing.Pen (Hex '#2b1a10' 150), ([Math]::Max(1, $size / 64))
  $g.DrawPath($rim, $shape)
  $g.Dispose(); $face.Dispose()
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$sizes = 16, 24, 32, 48, 64, 96, 128, 256, 512, 1024
foreach ($z in $sizes) { Render $z (Join-Path $outDir "icon-$z.png") }

# Multi-size .ico. The Windows resource compiler only takes PNG data for the 256px image;
# smaller ones must be classic 32-bit bitmaps (bottom-up BGRA plus an empty AND mask).
function Dib([string]$pngPath) {
  $bmp = [Drawing.Bitmap]::FromFile($pngPath)
  $w = $bmp.Width; $h = $bmp.Height
  $ms2 = New-Object IO.MemoryStream
  $bw = New-Object IO.BinaryWriter $ms2
  $maskRow = [Math]::Floor(($w + 31) / 32) * 4
  $bw.Write([UInt32]40); $bw.Write([Int32]$w); $bw.Write([Int32]($h * 2))
  $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]0)
  $bw.Write([UInt32]($w * $h * 4 + $maskRow * $h)); $bw.Write([Int32]0); $bw.Write([Int32]0); $bw.Write([UInt32]0); $bw.Write([UInt32]0)
  for ($y = $h - 1; $y -ge 0; $y--) {
    for ($x = 0; $x -lt $w; $x++) {
      $c = $bmp.GetPixel($x, $y)
      $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]$c.A)
    }
  }
  $bw.Write((New-Object byte[] ($maskRow * $h)))
  $bw.Flush(); $bmp.Dispose()
  return ,$ms2.ToArray()
}
$icoSizes = 16, 24, 32, 48, 64, 128, 256
$pngs = $icoSizes | ForEach-Object {
  $p = Join-Path $outDir "icon-$_.png"
  if ($_ -ge 256) { ,[IO.File]::ReadAllBytes($p) } else { ,(Dib $p) }
}
$ms = New-Object IO.MemoryStream
$w = New-Object IO.BinaryWriter $ms
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$icoSizes.Count)
$offset = 6 + 16 * $icoSizes.Count
for ($i = 0; $i -lt $icoSizes.Count; $i++) {
  $z = $icoSizes[$i]
  $dim = if ($z -ge 256) { 0 } else { $z }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$pngs[$i].Length); $w.Write([UInt32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Flush()
[IO.File]::WriteAllBytes((Join-Path $outDir 'icon.ico'), $ms.ToArray())
"-> $outDir"
