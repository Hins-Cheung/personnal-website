param([string]$In, [string]$Out, [int]$MaxW = 1100)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($In)
$scale = [Math]::Min(1.0, $MaxW / $img.Width)
$w = [int]($img.Width * $scale)
$h = [int]($img.Height * $scale)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($img, 0, 0, $w, $h)
$g.Dispose()
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 80)
$bmp.Save($Out, $enc, $ep)
$bmp.Dispose(); $img.Dispose()
Write-Output ("$Out  " + $w + "x" + $h)
