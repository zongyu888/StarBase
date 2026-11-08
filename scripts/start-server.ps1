# 以独立进程启动 StarBase 服务端（WMI 启动，脱离当前终端会话）
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$exe = Join-Path $root 'starbase-server.exe'
if (-not (Test-Path $exe)) {
  Write-Error "找不到 $exe，请先运行 scripts\build-release.sh 或复制服务端程序到项目根目录。"
  exit 1
}

$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine      = '"' + $exe + '"'
  CurrentDirectory = $root
}

if ($result.ReturnValue -eq 0) {
  Write-Output ("StarBase 已启动，PID=" + $result.ProcessId + "，地址 http://127.0.0.1:8620")
} else {
  Write-Error ("启动失败，ReturnValue=" + $result.ReturnValue)
  exit 1
}