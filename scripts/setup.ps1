<#
.SYNOPSIS
    Первоначальная настройка проекта Messenger на Windows: виртуальное окружение,
    зависимости, PostgreSQL в Docker и схема базы из init.sql.

.DESCRIPTION
    Скрипт идемпотентен: его можно запускать повторно, он ничего не ломает.
    Проверяет, что уже сделано, и доделывает только недостающее.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#>

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

# Реквизиты базы. Те же имена, что и переменные окружения в backend\database.py.
$DbUser     = if ($env:DB_USER)     { $env:DB_USER }     else { "messenger_user" }
$DbPassword = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "pass" }
$DbName     = if ($env:DB_NAME)     { $env:DB_NAME }     else { "messenger_db" }
$DbPort     = if ($env:DB_PORT)     { $env:DB_PORT }     else { "5432" }
$Container  = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { "messenger-pg" }
$Image      = if ($env:PG_IMAGE)     { $env:PG_IMAGE }     else { "postgres:16" }

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "    [ok] $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "    $text" -ForegroundColor Gray }

# ---------------------------------------------------------------
# 1. Python и виртуальное окружение
# ---------------------------------------------------------------
Write-Step "Проверяю Python"
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    throw "Python не найден. Установи Python 3.10+ с python.org и поставь галочку 'Add Python to PATH'."
}
Write-Ok "$(& python --version) ($($python.Source))"

$venvPython = Join-Path $ProjectDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Step "Создаю .venv"
    & python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Не удалось создать .venv" }
    Write-Ok "окружение создано"
} else {
    Write-Ok ".venv уже существует"
}

# ---------------------------------------------------------------
# 2. Зависимости
# ---------------------------------------------------------------
Write-Step "Ставлю зависимости из backend\requirements.txt"
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r backend\requirements.txt --quiet
if ($LASTEXITCODE -ne 0) { throw "Не удалось поставить зависимости" }
Write-Ok "зависимости установлены"

# ---------------------------------------------------------------
# 3. PostgreSQL в Docker
# ---------------------------------------------------------------
Write-Step "Проверяю Docker"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker не найден. Установи Docker Desktop: https://www.docker.com/products/docker-desktop/"
}
& docker info --format "{{.ServerVersion}}" *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker не запущен. Запусти Docker Desktop и повтори скрипт."
}
Write-Ok "Docker работает"

Write-Step "Поднимаю PostgreSQL в контейнере '$Container'"
$exists = (& docker ps -a --filter "name=^/$Container$" --format "{{.Names}}") -contains $Container
if ($exists) {
    Write-Info "контейнер уже есть, просто запускаю"
    & docker start $Container *> $null
} else {
    & docker run -d --name $Container `
        -e POSTGRES_USER=$DbUser `
        -e POSTGRES_PASSWORD=$DbPassword `
        -e POSTGRES_DB=$DbName `
        -p "${DbPort}:5432" `
        $Image *> $null
    if ($LASTEXITCODE -ne 0) { throw "Не удалось создать контейнер $Container" }
    Write-Ok "контейнер создан"
}

# Ждём, пока сервер внутри контейнера примет соединения
Write-Step "Жду готовности базы"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    & docker exec $Container pg_isready -U $DbUser -d $DbName *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw "PostgreSQL не поднялся. Смотри: docker logs $Container" }
Write-Ok "база отвечает"

# ---------------------------------------------------------------
# 4. Схема из init.sql
# ---------------------------------------------------------------
# init.sql — единственный источник правды. Создаём таблицы только через него.
# Если таблицы уже есть, повторный прогон падает на CREATE TABLE, поэтому
# сначала проверяем, есть ли хоть одна таблица.
$tableCount = (& docker exec $Container psql -U $DbUser -d $DbName -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';") -join ""
Write-Step "Применяю схему из init.sql"
if ([int]$tableCount -gt 0) {
    Write-Ok "схема уже применена ($tableCount таблиц), пропускаю"
} else {
    Get-Content init.sql -Raw | & docker exec -i $Container psql -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -q
    if ($LASTEXITCODE -ne 0) { throw "Не удалось применить init.sql" }
    Write-Ok "схема применена"
}

Write-Host ""
Write-Host "Настройка закончена." -ForegroundColor Green
Write-Host "Запуск сервера:  powershell -ExecutionPolicy Bypass -File scripts\run.ps1" -ForegroundColor Gray
Write-Host "Затем открой:    http://localhost:8000" -ForegroundColor Gray
