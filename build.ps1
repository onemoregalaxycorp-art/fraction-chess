# Build dist\FractionChess.exe using the C# compiler that ships with Windows (.NET Framework 4).
# Run:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64\v4*\csc.exe" | Select-Object -Last 1
if (-not $csc) { throw 'csc.exe (.NET Framework 4) not found' }

$files = @('index.html', 'index3d.html', 'index-gl.html', 'ANALYSIS.md', 'css\style.css', 'css\style3d.css', 'css\gl.css', 'css\hud.css', 'css\mobile.css', 'manifest.webmanifest') +
  (Get-ChildItem "$root\icons" -Filter *.png | ForEach-Object { $_.FullName.Substring($root.Length + 1) }) +
  (Get-ChildItem "$root\js" -Recurse -Filter *.js | ForEach-Object { $_.FullName.Substring($root.Length + 1) }) +
  (Get-ChildItem "$root\models" -Recurse -Filter *.glb | ForEach-Object { $_.FullName.Substring($root.Length + 1) })
$res = foreach ($f in $files) { "/resource:$root\$f,app/$($f -replace '\\','/')" }

New-Item -ItemType Directory -Force "$root\dist" | Out-Null
$cargs = @('/nologo', '/target:winexe', '/optimize+', '/codepage:65001', "/out:$root\dist\FractionChess.exe", '/reference:System.Windows.Forms.dll') + $res + "$root\launcher\Launcher.cs"
& $csc.FullName @cargs
if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }
Write-Host "OK: $root\dist\FractionChess.exe ($($files.Count) game files embedded)"
