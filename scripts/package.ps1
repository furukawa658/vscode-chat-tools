$r = "C:\Kanko-AX-Foundation\vscode-chat-tools"
Set-Location $r
New-Item -ItemType Directory -Force "$r\dist" | Out-Null
foreach ($e in "tsugi", "eien", "ne-memory", "pack") {
  Copy-Item "$r\LICENSE" "$r\extensions\$e\LICENSE" -Force
  Push-Location "$r\extensions\$e"
  & "$r\node_modules\.bin\vsce.exe" package --no-dependencies --skip-license -o "$r\dist\$e.vsix" 2>&1 | Select-Object -Last 4
  Pop-Location
}
Get-ChildItem "$r\dist" | Select-Object Name, Length

