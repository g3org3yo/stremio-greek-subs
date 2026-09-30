# Φτιάχνει τις συντομεύσεις: μία στην Επιφάνεια Εργασίας (διπλό κλικ = άνοιξε)
# και μία στην Αυτόματη Εκκίνηση (ο server ξεκινά μόνος του με τα Windows).
$ErrorActionPreference = 'Stop'
$project = 'D:\Hermes Agent\Projects\stremio-greek-subs'
$cmd = Join-Path $project 'Start-Addon.cmd'
$icon = 'D:\Hermes Agent\Tools\node\node.exe,0'
if (-not (Test-Path $cmd)) { throw "Λείπει το $cmd" }
$shell = New-Object -ComObject WScript.Shell

$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Ελληνικοί Υπότιτλοι.lnk'
$s = $shell.CreateShortcut($desktop)
$s.TargetPath = $cmd
$s.WorkingDirectory = $project
$s.IconLocation = $icon
$s.Description = 'Ελληνικοί υπότιτλοι για το Stremio'
$s.WindowStyle = 1
$s.Save()

$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Ελληνικοί Υπότιτλοι.lnk'
$a = $shell.CreateShortcut($startup)
$a.TargetPath = $cmd
$a.Arguments = 'quiet'
$a.WorkingDirectory = $project
$a.IconLocation = $icon
$a.Description = 'Ελληνικοί υπότιτλοι — ο server ξεκινά με τα Windows'
$a.WindowStyle = 7
$a.Save()

Write-Output "DESKTOP=$desktop"
Write-Output "STARTUP=$startup"
