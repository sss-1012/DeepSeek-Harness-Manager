# 生成多尺寸 icon.ico(16/24/32/48/64/128/256,PNG 压缩条目)
Add-Type -AssemblyName System.Drawing

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = @()

foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(79, 140, 255))
  $g.FillEllipse($brush, 0, 0, $size, $size)
  $font = New-Object System.Drawing.Font('Segoe UI', [math]::Floor($size * 0.3), [System.Drawing.FontStyle]::Bold)
  $sb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $g.DrawString('DSH', $font, $sb, $rect, $sf)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += ,$ms.ToArray()
  $ms.Dispose()
  $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $font.Dispose(); $sb.Dispose(); $sf.Dispose()
}

# ICONDIR + ICONDIRENTRY 打包
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([UInt16]0)          # reserved
$bw.Write([UInt16]1)          # type: icon
$bw.Write([UInt16]$pngs.Count)
$offset = 6 + 16 * $pngs.Count
for ($i = 0; $i -lt $pngs.Count; $i++) {
  $size = $sizes[$i]
  $bw.Write([Byte]$(if ($size -ge 256) { 0 } else { $size }))
  $bw.Write([Byte]$(if ($size -ge 256) { 0 } else { $size }))
  $bw.Write([Byte]0)          # colors
  $bw.Write([Byte]0)          # reserved
  $bw.Write([UInt16]1)        # planes
  $bw.Write([UInt16]32)       # bitcount
  $bw.Write([UInt32]$pngs[$i].Length)
  $bw.Write([UInt32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Flush()
$icoPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets\icon.ico'))
[System.IO.File]::WriteAllBytes($icoPath, $out.ToArray())
$bw.Dispose(); $out.Dispose()
Write-Output "icon.ico generated: $icoPath"
Get-Item $icoPath | Select-Object Name, Length
