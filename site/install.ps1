# VINAC Link {{version}} installer for Windows (https://vinac.tech).
#   irm https://vinac.tech/install.ps1 | iex
# Downloads the installer from vinac.tech, checks its SHA-256 against
# https://vinac.tech/download/SHA256SUMS.txt, installs it for this user (no admin rights needed),
# and starts VINAC Link. Node.js is included.
# Source: https://github.com/vinactech/vinac-link/blob/main/site/install.ps1
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $V = '{{version}}'
  $base = 'https://vinac.tech/download'
  $file = "VINAC-Link-Setup-$V.exe"
  $tmp = Join-Path $env:TEMP ('vinac-install-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Write-Host "Downloading $file ..."
    Invoke-WebRequest "$base/SHA256SUMS.txt" -OutFile "$tmp\SHA256SUMS.txt" -UseBasicParsing
    Invoke-WebRequest "$base/$file" -OutFile "$tmp\$file" -UseBasicParsing
    $line = Get-Content "$tmp\SHA256SUMS.txt" | Where-Object { $_ -match ('  ' + [regex]::Escape($file) + '$') } | Select-Object -First 1
    $want = if ($line) { ($line -split '\s+')[0].ToLower() } else { '' }
    $got = (Get-FileHash "$tmp\$file" -Algorithm SHA256).Hash.ToLower()
    if (-not $want) { throw "No published checksum for $file; nothing installed." }
    if ($got -ne $want) { throw "Checksum mismatch for $file; nothing installed." }
    Write-Host 'Checksum OK. Installing ...'
    $p = Start-Process -FilePath "$tmp\$file" -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "The installer stopped with code $($p.ExitCode)." }
    $app = Join-Path $env:LOCALAPPDATA 'Programs\VINAC Link'
    Write-Host "Installed: $app"
    Start-Process -FilePath "$app\node\node.exe" -ArgumentList "`"$app\connector\bin\vinac.mjs`"", 'start' -WorkingDirectory $app -WindowStyle Hidden
    Write-Host ''
    Write-Host 'VINAC Link opens in its own window. Next: pair a second computer, then connect your agent: vinac setup'
  } catch {
    Write-Host "VINAC Link: $($_.Exception.Message)" -ForegroundColor Red
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
