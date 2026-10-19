<#
.SYNOPSIS
    Запускает проект Messenger: поднимает PostgreSQL и стартует сервер FastAPI.

.DESCRIPTION
    Сервер раздаёт и API, и фронтенд, поэтому одного uvicorn достаточно.
    Открывать нужно http://localhost:8000

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\run.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\run.ps1 -Port 8080
#>

param(
    [int]$Port = 8000,
    # $Host — зарезервированное имя в PowerShell, поэтому другое
    [string]$ListenHost = "0.0.0.0"
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

$DbUser     = if ($env:DB_USER)     { $env:DB_USER }     else { "messenger_user" }
$DbName     = if ($env:DB_NAME)     { $env:DB_NAME }     else { "messenger_db" }
$Container  = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { "messenger-pg" }
$venvPython = Join-Path $ProjectDir ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    throw "Нет виртуального окружения. Сначала выполни: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1"
}

# ---------------------------------------------------------------
# 1. PostgreSQL
# ---------------------------------------------------------------
Write-Host "==> Поднимаю PostgreSQL" -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker не найден. Установи Docker Desktop."
}
& docker info --format "{{.ServerVersion}}" *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker не запущен. Запусти Docker Desktop и повтори."
}

$running = (& docker ps --filter "name=^/$Container$" --format "{{.Names}}") -contains $Container
if (-not $running) {
    & docker start $Container *> $null
    if ($LASTEXITCODE -ne 0) { throw "Не удалось запустить контейнер $Container" }
}

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    & docker exec $Container pg_isready -U $DbUser -d $DbName *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw "PostgreSQL не поднялся. Смотри: docker logs $Container" }
Write-Host "    [ok] база отвечает" -ForegroundColor Green

# ---------------------------------------------------------------
# 2. Сервер
# ---------------------------------------------------------------
Write-Host "==> Запускаю сервер на порту $Port" -ForegroundColor Cyan
Write-Host ("    Слушаю: {0}:{1}" -f $ListenHost, $Port) -ForegroundColor Gray
Write-Host "    Открой http://localhost:$Port" -ForegroundColor Gray
Write-Host "    Остановить: Ctrl+C" -ForegroundColor Gray
Write-Host ""

Set-Location (Join-Path $ProjectDir "backend")
& $venvPython -m uvicorn main:app --reload --host $ListenHost --port $Port
