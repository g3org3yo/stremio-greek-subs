# Φτιάχνει συντόμευση για το addon:
#   - πάντα: μία στην Επιφάνεια Εργασίας (διπλό κλικ = ξεκίνα ή άνοιξε)
#   - με -Startup: και μία στην Αυτόματη Εκκίνηση (ο server ξεκινά με τα Windows)
# Δουλεύει από όπου κι αν είναι ο φάκελος: όλες οι διαδρομές βγαίνουν από εδώ.
param([switch]$Startup)
$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
$cmd = Join-Path $project 'Start-Addon.cmd'
if (-not (Test-Path $cmd)) { throw "Λείπει το $cmd" }

# Εικονίδιο: το Node που έχουμε μαζί, αλλιώς όποιο βρει στο PATH.
$icon = $null
$bundled = Join-Path $project 'node\node.exe'
if (Test-Path $bundled) {
  $icon = "$bundled,0"
} else {
  $found = Get-Command node -ErrorAction SilentlyContinue
  if ($found) { $icon = "$($found.Source),0" }
}

$shell = New-Object -ComObject WScript.Shell

$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Ελληνικοί Υπότιτλοι.lnk'
$s = $shell.CreateShortcut($desktop)
$s.TargetPath = $cmd
$s.WorkingDirectory = $project
if ($icon) { $s.IconLocation = $icon }
$s.Description = 'Ελληνικοί υπότιτλοι για το Stremio'
$s.WindowStyle = 1
$s.Save()
Write-Output "DESKTOP=$desktop"

if ($Startup) {
  $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Ελληνικοί Υπότιτλοι.lnk'
  $a = $shell.CreateShortcut($startup)
  $a.TargetPath = $cmd
  $a.Arguments = 'quiet'
  $a.WorkingDirectory = $project
  if ($icon) { $a.IconLocation = $icon }
  $a.Description = 'Ελληνικοί υπότιτλοι — ο server ξεκινά με τα Windows'
  $a.WindowStyle = 7
  $a.Save()
  Write-Output "STARTUP=$startup"
}
