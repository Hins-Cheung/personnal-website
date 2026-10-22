# Fetch official F1 calendar and generate assets/f1calendar.js
# Usage: powershell -File tools/build-calendar.ps1 [year]
# NOTE: keep this file pure ASCII. PowerShell 5.1 reads .ps1 as ANSI unless a BOM is present.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = 'Stop'
$year = if ($args.Count -ge 1) { $args[0] } else { '2026' }

# slug => circuit name, lat, lon
$circuits = @{
  'australia'            = @('Albert Park Circuit',           -37.8497,  144.9680)
  'china'                = @('Shanghai International Circuit', 31.3389,  121.2200)
  'japan'                = @('Suzuka International Circuit',   34.8431,  136.5410)
  'bahrain'              = @('Sepang International Circuit',     2.7608,  101.7383)
  'saudi-arabia'         = @('Jeddah Corniche Circuit',        21.6319,   39.1044)
  'miami'                = @('Miami International Autodrome',  25.9581,  -80.2389)
  'canada'               = @('Circuit Gilles-Villeneuve',      45.5000,  -73.5220)
  'monaco'               = @('Circuit de Monaco',              43.7347,    7.4206)
  'barcelona-catalunya'  = @('Circuit de Barcelona-Catalunya', 41.5700,    2.2611)
  'austria'              = @('Red Bull Ring',                  47.2197,   14.7647)
  'great-britain'        = @('Silverstone Circuit',            52.0786,   -1.0169)
  'belgium'              = @('Circuit de Spa-Francorchamps',   50.4372,    5.9714)
  'hungary'              = @('Hungaroring',                    47.5789,   19.2486)
  'netherlands'          = @('Circuit Zandvoort',              52.3888,    4.5409)
  'italy'                = @('Autodromo Nazionale Monza',      45.6156,    9.2811)
  'spain'                = @('Circuito de Jarama',             40.6171,   -3.5856)
  'azerbaijan'           = @('Baku City Circuit',              40.3725,   49.8533)
  'singapore'            = @('Marina Bay Street Circuit',       1.2914,  103.8640)
  'united-states'        = @('Circuit of the Americas',        30.1328,  -97.6411)
  'mexico'               = @('Autodromo Hermanos Rodriguez',   19.4042,  -99.0907)
  'brazil'               = @('Autodromo Jose Carlos Pace',     -23.7036,  -46.6997)
  'las-vegas'            = @('Las Vegas Strip Circuit',         36.1147, -115.1730)
  'qatar'                = @('Lusail International Circuit',    25.4900,   51.4542)
  'united-arab-emirates' = @('Yas Marina Circuit',              24.4672,   54.6031)
}

$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36'

function Get-Page($url) {
  for ($i = 0; $i -lt 3; $i++) {
    try {
      return (Invoke-WebRequest -Uri $url -UseBasicParsing -UserAgent $ua -TimeoutSec 40).Content
    } catch {
      Write-Output ("  retry " + $i + " " + $url)
      Start-Sleep -Seconds 2
    }
  }
  return $null
}

Write-Output "=== fetching calendar $year ==="
$cal = Get-Page "https://www.formula1.com/en/racing/$year"
if (-not $cal) { Write-Output "calendar fetch failed"; exit 1 }

$ordered = New-Object System.Collections.Generic.List[string]
foreach ($m in [regex]::Matches($cal, '/en/racing/' + $year + '/([a-z0-9-]+)')) {
  $s = $m.Groups[1].Value
  if ($s -like 'pre-season-testing*') { continue }
  if (-not $ordered.Contains($s)) { $ordered.Add($s) }
}
# The calendar page does not link every round (some cards are client-rendered),
# so make sure every known slug is probed.
foreach ($extra in $circuits.Keys) {
  if (-not $ordered.Contains($extra)) { $ordered.Add($extra) }
}
Write-Output ("rounds found: " + $ordered.Count + " -> " + ($ordered -join ', '))

$rounds = New-Object System.Collections.Generic.List[object]
foreach ($slug in $ordered) {
  $url = "https://www.formula1.com/en/racing/$year/$slug"
  $html = Get-Page $url
  if (-not $html) { Write-Output ("FAIL " + $slug); continue }

  $ld = [regex]::Match($html, '<script type="application/ld\+json">([\s\S]*?)</script>')
  if (-not $ld.Success) { Write-Output ("no ld+json " + $slug); continue }
  $obj = $ld.Groups[1].Value | ConvertFrom-Json

  $city = ''
  $country = ''
  if ($obj.location) {
    $city = $obj.location.name
    if ($obj.location.address) { $country = $obj.location.address }
  }

  $raceDate = ''
  $sessions = @()
  foreach ($se in $obj.subEvent) {
    $sd = $se.startDate
    if (-not $sd) { continue }
    $d = ([DateTime]::Parse($sd)).ToUniversalTime().ToString('yyyy-MM-dd')
    if ($se.name -like 'Race -*') { $raceDate = $d }
    if ($sessions -notcontains $d) { $sessions += $d }
  }
  $sessions = @($sessions | Sort-Object)

  $c = $circuits[$slug]
  if (-not $c) {
    Write-Output ("NO CIRCUIT MAPPING for " + $slug + " (city=" + $city + ")")
    continue
  }
  if (-not $raceDate) {
    Write-Output ("SKIP " + $slug + " - no sessions scheduled (round removed or postponed)")
    continue
  }

  $rounds.Add([pscustomobject]@{
    round = 0
    slug  = $slug
    name  = $obj.name
    city  = $city
    country = $country
    circuit = $c[0]
    lat = $c[1]
    lon = $c[2]
    raceDate = $raceDate
    sessions = $sessions
  })
  Write-Output ("   " + $slug + " | " + $city + " | " + $c[0] + " | race=" + $raceDate + " | " + ($sessions -join ','))
}

# Number the rounds by race date
$sorted = @($rounds | Sort-Object { $_.raceDate })
$n = 1
foreach ($r in $sorted) { $r.round = $n; $n++ }
foreach ($r in $sorted) {
  Write-Output ("R" + $r.round + " " + $r.slug + " race=" + $r.raceDate)
}
$rounds = New-Object System.Collections.Generic.List[object]
foreach ($r in $sorted) { $rounds.Add($r) }

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("// Auto-generated from the official F1 calendar. Do not edit by hand.")
[void]$sb.AppendLine("// Regenerate: powershell -File tools/build-calendar.ps1 2026")
[void]$sb.AppendLine("window.F1_CALENDAR = {")
[void]$sb.AppendLine("  year: $year,")
[void]$sb.AppendLine("  rounds: [")
foreach ($r in $rounds) {
  $ses = ($r.sessions | ForEach-Object { "'" + $_ + "'" }) -join ', '
  $line = "    { round: $($r.round), slug: '$($r.slug)', name: '$($r.name)', city: '$($r.city)', country: '$($r.country)', circuit: '$($r.circuit)', lat: $($r.lat), lon: $($r.lon), raceDate: '$($r.raceDate)', sessions: [$ses] },"
  [void]$sb.AppendLine($line)
}
[void]$sb.AppendLine("  ]")
[void]$sb.AppendLine("};")
$out = Join-Path $PSScriptRoot '..\assets\f1calendar.js'
[System.IO.File]::WriteAllText($out, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("written: " + $out + "  rounds=" + $rounds.Count)
