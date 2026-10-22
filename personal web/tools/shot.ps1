# Headless Chrome via DevTools Protocol: load a URL, wait, dump DOM + console errors + screenshot.
# Usage: powershell -File tools/shot.ps1 <url> <outHtml> [waitSeconds] [outPng] [width] [height]
param(
  [string]$Url = 'http://localhost:8000/index.html',
  [string]$OutHtml = 'C:\Users\cjb33\Desktop\personal web\tools\out.html',
  [int]$WaitSeconds = 25,
  [string]$OutPng = '',
  [int]$Width = 1440,
  [int]$Height = 1000,
  [string]$Eval = ''
)

$ErrorActionPreference = 'Stop'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$port = 9333
$profile = Join-Path $env:TEMP 'cdp-profile'
if (Test-Path $profile) { Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue }

$proc = Start-Process -FilePath $chrome -PassThru -WindowStyle Hidden -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  "--remote-debugging-port=$port", "--user-data-dir=$profile",
  '--hide-scrollbars', "--window-size=$Width,$Height", 'about:blank'
)

function Send-Cdp($ws, $id, $method, $params) {
  $msg = @{ id = $id; method = $method }
  if ($params) { $msg['params'] = $params }
  $json = $msg | ConvertTo-Json -Depth 12 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object System.ArraySegment[byte] (,$bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true,
    [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
}

function Read-Cdp($ws, $timeoutMs) {
  # A pending ReceiveAsync must never be cancelled, or the socket dies.
  # Keep the task around and poll it instead.
  if ($null -eq $script:recvTask) {
    $script:recvBuf = New-Object byte[] 1048576
    $script:recvMs = New-Object System.IO.MemoryStream
    $seg = New-Object System.ArraySegment[byte] (,$script:recvBuf)
    $script:recvTask = $ws.ReceiveAsync($seg, [System.Threading.CancellationToken]::None)
  }
  if (-not $script:recvTask.Wait($timeoutMs)) { return $null }
  $res = $script:recvTask.GetAwaiter().GetResult()
  $script:recvTask = $null
  if ($res.Count -gt 0) { $script:recvMs.Write($script:recvBuf, 0, $res.Count) }
  if ($res.EndOfMessage) {
    $s = [System.Text.Encoding]::UTF8.GetString($script:recvMs.ToArray())
    $script:recvMs = New-Object System.IO.MemoryStream
    return $s
  }
  return Read-Cdp $ws $timeoutMs
}

try {
  $target = $null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $targets = Invoke-RestMethod -Uri "http://localhost:$port/json/list" -TimeoutSec 5
      $target = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
      if ($target) { break }
    } catch { }
  }
  if (-not $target) { throw 'devtools target not found' }

  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
  Write-Output ("connected: " + $target.webSocketDebuggerUrl)

  $script:id = 0
  $logs = New-Object System.Collections.Generic.List[string]

  function Invoke-Cdp($ws, $method, $params, $timeoutMs) {
    $rid = $script:id; $script:id++
    Send-Cdp $ws $rid $method $params
    while ($true) {
      $raw = Read-Cdp $ws $timeoutMs
      if (-not $raw) { return $null }
      try { $obj = $raw | ConvertFrom-Json } catch { continue }
      if ($obj.method -eq 'Runtime.consoleAPICalled') {
        $txt = ($obj.params.args | ForEach-Object { $_.value }) -join ' '
        $logs.Add("[console.$($obj.params.type)] $txt")
      }
      if ($obj.method -eq 'Runtime.exceptionThrown') {
        $d = $obj.params.exceptionDetails
        $desc = ''
        try { $desc = $d.exception.description } catch { $desc = $d.text }
        $logs.Add("[exception] $desc")
      }
      if ($obj.method -eq 'Log.entryAdded') {
        $logs.Add("[log.$($obj.params.entry.level)] $($obj.params.entry.text)")
      }
      if ($obj.id -eq $rid) { return $obj }
    }
  }

  Invoke-Cdp $ws 'Page.enable'   $null 2000 | Out-Null
  Invoke-Cdp $ws 'Runtime.enable' $null 2000 | Out-Null
  Invoke-Cdp $ws 'Log.enable'     $null 2000 | Out-Null
  Invoke-Cdp $ws 'Emulation.setDeviceMetricsOverride' @{ width = $Width; height = $Height; deviceScaleFactor = 1; mobile = $false } 3000 | Out-Null
  Invoke-Cdp $ws 'Page.navigate'  @{ url = $Url } 5000 | Out-Null

  Write-Output "waiting $WaitSeconds s..."
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  while ((Get-Date) -lt $deadline) {
    $null = Read-Cdp $ws 1500
    try {
      $obj = $null
      $raw = Read-Cdp $ws 100
      if ($raw) { $obj = $raw | ConvertFrom-Json }
      if ($obj) {
        if ($obj.method -eq 'Runtime.consoleAPICalled') {
          $txt = ($obj.params.args | ForEach-Object { $_.value }) -join ' '
          $logs.Add("[console.$($obj.params.type)] $txt")
        }
        if ($obj.method -eq 'Runtime.exceptionThrown') {
          $d = $obj.params.exceptionDetails
          $desc = ''
          try { $desc = $d.exception.description } catch { $desc = $d.text }
          $logs.Add("[exception] $desc")
        }
        if ($obj.method -eq 'Log.entryAdded') {
          $logs.Add("[log.$($obj.params.entry.level)] $($obj.params.entry.text)")
        }
      }
    } catch { }
  }

  if ($Eval) {
    $re = Invoke-Cdp $ws 'Runtime.evaluate' @{ expression = $Eval; returnByValue = $true } 8000
    if ($re) {
      $val = $re.result.result.value
      if ($null -eq $val) { Write-Output "EVAL: (undefined)" }
      else { Write-Output ("EVAL: " + ($val | ConvertTo-Json -Depth 6 -Compress)) }
    } else { Write-Output "EVAL: no response" }
  }

  $r = Invoke-Cdp $ws 'Runtime.evaluate' @{ expression = 'document.documentElement.outerHTML'; returnByValue = $true } 8000
  $dom = $null
  if ($r) { $dom = $r.result.result.value }
  if ($dom) { [System.IO.File]::WriteAllText($OutHtml, $dom, (New-Object System.Text.UTF8Encoding($false))) }

  if ($OutPng) {
    $r2 = Invoke-Cdp $ws 'Page.captureScreenshot' @{ format = 'png' } 20000
    if ($r2 -and $r2.result -and $r2.result.data) {
      [System.IO.File]::WriteAllBytes($OutPng, [Convert]::FromBase64String($r2.result.data))
      Write-Output ("screenshot: " + $OutPng + " (" + (Get-Item $OutPng).Length + " bytes)")
    } else {
      Write-Output "screenshot failed"
      if ($r2) { Write-Output ($r2 | ConvertTo-Json -Depth 4 -Compress | ForEach-Object { $_.Substring(0, [Math]::Min(600, $_.Length)) }) }
    }
  }

  Write-Output "--- console ---"
  if ($logs.Count -eq 0) { Write-Output "(no console output)" }
  $logs | Select-Object -First 40 | ForEach-Object { Write-Output $_ }
  Write-Output ("--- dom bytes: " + $(if ($dom) { $dom.Length } else { 0 }))

  $ws.Dispose()
} finally {
  try { $proc | Stop-Process -Force } catch { }
}
