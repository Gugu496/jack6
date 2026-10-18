# 在桌面创建「六年之约」离线快捷方式（Windows）。
# 用法：右键“使用 PowerShell 运行”，或在终端执行
#   powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$html = Join-Path $root '六年之约.html'

if (-not (Test-Path -LiteralPath $html)) {
  Write-Host '未找到离线文件，正在构建...'
  Push-Location $root
  try { node (Join-Path $PSScriptRoot 'build-offline.js') }
  finally { Pop-Location }
}

$browsers = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
)
$browser = $browsers | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw '没有找到 Edge 或 Chrome，请先安装其中一个浏览器。' }

$uri = ([uri]$html).AbsoluteUri
$ws = New-Object -ComObject WScript.Shell
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) '六年之约.lnk'
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = $browser
$sc.Arguments = "--app=`"$uri`" --window-size=430,900"
$sc.WorkingDirectory = $root
$icon = Join-Path $root 'assets\icon.ico'
if (Test-Path -LiteralPath $icon) { $sc.IconLocation = "$icon,0" }
$sc.Description = '六年之约 · Jack（完全离线）'
$sc.Save()

Write-Host ''
Write-Host '已创建桌面快捷方式：' -NoNewline
Write-Host $lnk
Write-Host '离线文件：' -NoNewline
Write-Host $html
Write-Host '双击桌面上的「六年之约」即可打开，不需要联网，也不需要启动服务。'
