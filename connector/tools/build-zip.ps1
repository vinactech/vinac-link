# Builds the connector zip for another computer: connector + the lab modem files it imports.
# Usage: powershell -File tools\build-zip.ps1 <version>   (writes ..\deploy\vinac-link-<version>.zip)
param([Parameter(Mandatory)][string]$Version)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$out = Join-Path $root "deploy\vinac-link-$Version.zip"
if (Test-Path $out) { Remove-Item $out -Confirm:$false }

$files = @()
$files += Get-ChildItem (Join-Path $root 'connector') -Recurse -File | Where-Object { $_.FullName -notmatch '\\(node_modules|tools)\\' }
$files += Get-ChildItem (Join-Path $root 'lab\js'), (Join-Path $root 'lab\worklets') -File
$executable = @('start-vinac.command', 'vinac.mjs')

$zip = [IO.Compression.ZipFile]::Open($out, 'Create')
try {
  foreach ($f in $files) {
    $rel = 'vinac-link/' + $f.FullName.Substring($root.Path.Length + 1).Replace('\', '/')
    $e = $zip.CreateEntry($rel, 'Optimal')
    # Unix mode in the high 16 bits: 0755 for scripts the Mac runs, 0644 otherwise.
    $e.ExternalAttributes = if ($executable -contains $f.Name) { 0x81ED0000 } else { 0x81A40000 }
    $s = $e.Open(); try { $bytes = [IO.File]::ReadAllBytes($f.FullName); $s.Write($bytes, 0, $bytes.Length) } finally { $s.Dispose() }
  }
} finally { $zip.Dispose() }
"{0} files -> {1} ({2} bytes)" -f $files.Count, $out, (Get-Item $out).Length
