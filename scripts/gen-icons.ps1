# 生成 dsh-manager 图标(应用图标 + 托盘绿/灰状态图标)
# 注意:统一用 MemoryStream + WriteAllBytes 落盘(bmp.Save 在本环境会被拦截丢失)
Add-Type -AssemblyName System.Drawing

$dir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\assets'))
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Save-Png($bmp, $out) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [System.IO.File]::WriteAllBytes($out, $ms.ToArray())
  $ms.Dispose()
}

function New-RoundedIcon($size, $bg, $fg, $text, $out) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush($bg)
  $r = [math]::Floor($size * 0.22)
  $g.FillEllipse($brush, 0, 0, $size, $size)
  if ($text) {
    $font = New-Object System.Drawing.Font('Segoe UI', [math]::Floor($size * 0.3), [System.Drawing.FontStyle]::Bold)
    $sb = New-Object System.Drawing.SolidBrush($fg)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString($text, $font, $sb, $rect, $sf)
    $font.Dispose(); $sb.Dispose(); $sf.Dispose()
  }
  Save-Png $bmp $out
  $g.Dispose(); $bmp.Dispose(); $brush.Dispose()
}

New-RoundedIcon 256 ([System.Drawing.Color]::FromArgb(79, 140, 255)) ([System.Drawing.Color]::White) 'DSH' (Join-Path $dir 'icon.png')
New-RoundedIcon 32 ([System.Drawing.Color]::FromArgb(52, 201, 142)) ([System.Drawing.Color]::White) $null (Join-Path $dir 'tray-green.png')
New-RoundedIcon 32 ([System.Drawing.Color]::FromArgb(90, 100, 120)) ([System.Drawing.Color]::White) $null (Join-Path $dir 'tray-gray.png')

Write-Output 'icons generated:'
Get-ChildItem $dir | Select-Object Name, Length
