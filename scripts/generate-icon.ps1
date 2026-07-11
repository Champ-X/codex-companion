Add-Type -AssemblyName System.Drawing

$size = 512
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

function New-RoundedPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

$backgroundPath = New-RoundedPath 24 24 464 464 124
$backgroundBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.PointF]::new(56, 40),
  [System.Drawing.PointF]::new(456, 472),
  [System.Drawing.Color]::FromArgb(255, 128, 103, 232),
  [System.Drawing.Color]::FromArgb(255, 92, 70, 197)
)
$graphics.FillPath($backgroundBrush, $backgroundPath)
$graphics.FillEllipse([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(28, 255, 255, 255)), 72, 76, 368, 368)

$furBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.PointF]::new(138, 130),
  [System.Drawing.PointF]::new(383, 391),
  [System.Drawing.Color]::FromArgb(255, 255, 181, 126),
  [System.Drawing.Color]::FromArgb(255, 255, 121, 110)
)
$creamBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 247, 240))
$muzzleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 241, 223))
$inkBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 49, 38, 78))
$purpleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 125, 91, 211))

$leftEarOuter = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(118, 218), [System.Drawing.PointF]::new(145, 94), [System.Drawing.PointF]::new(239, 179)
)
$rightEarOuter = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(394, 218), [System.Drawing.PointF]::new(367, 94), [System.Drawing.PointF]::new(273, 179)
)
$graphics.FillPolygon($creamBrush, $leftEarOuter)
$graphics.FillPolygon($creamBrush, $rightEarOuter)

$leftEar = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(137, 202), [System.Drawing.PointF]::new(153, 121), [System.Drawing.PointF]::new(218, 180)
)
$rightEar = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(375, 202), [System.Drawing.PointF]::new(359, 121), [System.Drawing.PointF]::new(294, 180)
)
$graphics.FillPolygon($furBrush, $leftEar)
$graphics.FillPolygon($furBrush, $rightEar)

$leftInner = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(153, 178), [System.Drawing.PointF]::new(160, 139), [System.Drawing.PointF]::new(196, 174)
)
$rightInner = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(359, 178), [System.Drawing.PointF]::new(352, 139), [System.Drawing.PointF]::new(316, 174)
)
$graphics.FillPolygon($purpleBrush, $leftInner)
$graphics.FillPolygon($purpleBrush, $rightInner)

$outerHead = New-RoundedPath 91 153 330 285 137
$innerHead = New-RoundedPath 108 170 296 251 120
$graphics.FillPath($creamBrush, $outerHead)
$graphics.FillPath($furBrush, $innerHead)
$graphics.FillEllipse($muzzleBrush, 151, 282, 210, 154)

$graphics.FillEllipse($inkBrush, 172, 251, 32, 44)
$graphics.FillEllipse($inkBrush, 308, 251, 32, 44)
$cheekBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(86, 255, 109, 131))
$graphics.FillEllipse($cheekBrush, 139, 306, 38, 38)
$graphics.FillEllipse($cheekBrush, 335, 306, 38, 38)

$mouthPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 49, 38, 78), 12)
$mouthPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$mouthPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawArc($mouthPen, 219, 311, 74, 58, 20, 140)

$badgePath = New-RoundedPath 185 180 142 76 36
$graphics.FillPath([System.Drawing.Brushes]::White, $badgePath)
$codePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 114, 85, 210), 10)
$codePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$codePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLines($codePen, [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(228, 204), [System.Drawing.PointF]::new(211, 218), [System.Drawing.PointF]::new(228, 232)
))
$graphics.DrawLines($codePen, [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(284, 204), [System.Drawing.PointF]::new(301, 218), [System.Drawing.PointF]::new(284, 232)
))
$graphics.DrawLine($codePen, 260, 199, 250, 237)

$output = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets\icon.png'
$bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)

$codePen.Dispose()
$mouthPen.Dispose()
$backgroundBrush.Dispose()
$furBrush.Dispose()
$creamBrush.Dispose()
$muzzleBrush.Dispose()
$inkBrush.Dispose()
$purpleBrush.Dispose()
$cheekBrush.Dispose()
$backgroundPath.Dispose()
$outerHead.Dispose()
$innerHead.Dispose()
$badgePath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Generated $output"
