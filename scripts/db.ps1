<#
.SYNOPSIS
    Работа с базой Messenger на Windows: бэкапы, восстановление, пересоздание со схемой.
    Аналог scripts/db.sh, но работает через контейнер PostgreSQL, поэтому psql
    на самой машине не нужен.

.DESCRIPTION
    scripts\db.ps1 backup            сохранить текущую базу
    scripts\db.ps1 list              показать бэкапы
    scripts\db.ps1 restore [файл]    восстановить из бэкапа (по умолчанию последний)
    scripts\db.ps1 reset             пересоздать базу со свежей схемой init.sql
                                    и вернуть данные из последнего бэкапа

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\db.ps1 backup
#>

param(
    [ValidateSet("backup", "list", "restore", "reset")]
    [string]$Command = "list",
    [string]$File
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

$DbUser     = if ($env:DB_USER)     { $env:DB_USER }     else { "messenger_user" }
$DbPassword = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "pass" }
$DbName     = if ($env:DB_NAME)     { $env:DB_NAME }     else { "messenger_db" }
$Container  = if ($env:PG_CONTAINER) { $env:PG_CONTAINER } else { "messenger-pg" }
$BackupDir  = Join-Path $ProjectDir "backups"

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "    [ok] $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "    $text" -ForegroundColor Gray }

# psql в контейнере. Поток вывода в файл — чтобы байты не переписывались
# кодировкой консоли Windows.
function Invoke-Psql {
    param([string]$Sql, [string]$Database = "postgres")
    $args = @("exec", $Container, "psql", "-U", $DbUser, "-d", $Database, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", $Sql)
    $out = & docker @args
    if ($LASTEXITCODE -ne 0) { throw "psql вернул ошибку" }
    return ($out -join "").Trim()
}

function Test-DbExists {
    $result = Invoke-Psql -Sql "SELECT count(*) FROM pg_database WHERE datname = '$DbName';" -Database "postgres"
    return ($result -eq "1")
}

function Get-Counts {
    if (-not (Test-DbExists)) { return "users=0 chats=0 messages=0" }

    # Схемы может ещё не быть — тогда таблиц нет и считать нечего.
    # Проверяем наличие таблицы, а не ловим ошибку от SELECT.
    $hasUsers = Invoke-Psql -Sql @"
SELECT count(*) FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'users';
"@ -Database $DbName
    if ($hasUsers -ne "1") { return "users=0 chats=0 messages=0" }

    return Invoke-Psql -Sql @"
SELECT 'users=' || (SELECT count(*) FROM users)
    || ' chats=' || (SELECT count(*) FROM chats)
    || ' messages=' || (SELECT count(*) FROM messages);
"@ -Database $DbName
}

# Создавать и удалять базу должен суперпользователь. В контейнере
# POSTGRES_USER — суперпользователь, поэтому хватает messenger_user.
function Stop-Connections {
    Invoke-Psql -Sql @"
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = '$DbName' AND pid <> pg_backend_pid();
"@ -Database "postgres" | Out-Null
}

function Drop-And-Create {
    Stop-Connections
    Invoke-Psql -Sql "DROP DATABASE IF EXISTS $DbName;" -Database "postgres" | Out-Null
    Invoke-Psql -Sql "CREATE DATABASE $DbName OWNER $DbUser;" -Database "postgres" | Out-Null
}

# Файл с дампом живёт внутри контейнера: так кодировка и переводы строк
# остаются нетронутыми, а docker cp переносит байты как есть.
function Copy-In {
    param([string]$LocalPath, [string]$ContainerPath)
    & docker cp $LocalPath "${Container}:$ContainerPath" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Не удалось скопировать файл в контейнер" }
}

function Copy-Out {
    param([string]$ContainerPath, [string]$LocalPath)
    & docker cp "${Container}:$ContainerPath" $LocalPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Не удалось забрать файл из контейнера" }
}

function Get-LatestBackup {
    if (-not (Test-Path $BackupDir)) { return $null }
    $files = Get-ChildItem $BackupDir -Filter "$DbName-*.sql" -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -notlike "*-data.sql" } |
             Sort-Object LastWriteTime -Descending
    if ($files) { return $files[0].FullName }
    return $null
}

# ---------------------------------------------------------------
function Invoke-Backup {
    if (-not (Test-DbExists)) { throw "Базы $DbName нет." }
    if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

    $base = "$DbName-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    $fullPath  = Join-Path $BackupDir "$base.sql"
    $dataPath  = Join-Path $BackupDir "$base-data.sql"

    Write-Step "Сохраняю $DbName"
    # Полный дамп: схема + данные. Им же база восстанавливается целиком.
    & docker exec $Container pg_dump -U $DbUser -d $DbName -f "/tmp/$base.sql" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "pg_dump не отработал" }
    Copy-Out "/tmp/$base.sql" $fullPath

    # Дамп только данных: накладывается поверх изменённой схемы из init.sql.
    & docker exec $Container pg_dump -U $DbUser -d $DbName --data-only -f "/tmp/$base-data.sql" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "pg_dump --data-only не отработал" }
    Copy-Out "/tmp/$base-data.sql" $dataPath

    Write-Ok "полный: $fullPath"
    Write-Ok "данные: $dataPath"
    Write-Info (Get-Counts)
}

function Show-Backups {
    if (-not (Test-Path $BackupDir) -or -not (Get-ChildItem $BackupDir -ErrorAction SilentlyContinue)) {
        Write-Info "Бэкапов пока нет."
        return
    }
    Get-ChildItem $BackupDir | Sort-Object LastWriteTime -Descending |
        Format-Table Name, @{n="Размер";e={"{0:N0} байт" -f $_.Length}}, LastWriteTime -AutoSize
}

function Invoke-Restore {
    $path = $File
    if (-not $path) { $path = Get-LatestBackup }
    if (-not $path) { throw "Бэкапов нет, восстанавливать нечего." }
    if (-not (Test-Path $path)) { throw "Файл $path не найден." }

    Write-Step "Восстанавливаю из $path, текущие данные будут потеряны"
    Drop-And-Create
    Copy-In $path "/tmp/restore.sql"
    & docker exec $Container psql -U $DbUser -d $DbName -q -v ON_ERROR_STOP=1 -f "/tmp/restore.sql" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Не удалось восстановить базу" }
    Write-Ok "Готово."
    Write-Info (Get-Counts)
}

function Invoke-Reset {
    $backup = $null
    if (Test-DbExists) {
        Write-Step "До пересоздания:"
        Write-Info (Get-Counts)
        Invoke-Backup
        # Имя файла в бэкапе задаётся по времени, поэтому берём самый свежий data-дамп
        $backup = (Get-ChildItem $BackupDir -Filter "$DbName-*-data.sql" |
                   Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
    } else {
        Write-Info "Базы $DbName нет — просто создам её заново."
    }

    Write-Step "Пересоздаю базу со схемой из init.sql"
    Drop-And-Create
    Copy-In (Join-Path $ProjectDir "init.sql") "/tmp/init.sql"
    & docker exec $Container psql -U $DbUser -d $DbName -q -v ON_ERROR_STOP=1 -f "/tmp/init.sql" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Не удалось применить init.sql" }

    if (-not $backup) {
        Write-Info (Get-Counts)
        return
    }

    # chats.last_message_id -> messages.id и messages.chat_id -> chats.id образуют
    # цикл, из-за чего pg_dump --data-only не может залить данные сам.
    # На время загрузки снимаем одну сторону цикла и возвращаем её после.
    Write-Step "Возвращаю данные из бэкапа поверх новой схемы"
    & docker exec $Container psql -U $DbUser -d $DbName -q -c "ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_last_message_id_fkey;" | Out-Null
    Copy-In $backup "/tmp/data.sql"

    & docker exec $Container psql -U $DbUser -d $DbName -q -1 -v ON_ERROR_STOP=1 -f "/tmp/data.sql" *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Info "Данные не подошли к новой схеме — база осталась пустой и целой."
        Write-Info "Полный бэкап цел здесь: $backup"
    } else {
        Write-Ok "Данные из бэкапа возвращены поверх новой схемы."
    }

    # Ограничение возвращаем в любом случае, иначе база осталась бы без него
    & docker exec $Container psql -U $DbUser -d $DbName -q -c @"
ALTER TABLE public.chats ADD CONSTRAINT chats_last_message_id_fkey
 FOREIGN KEY (last_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;
"@ | Out-Null

    # Значение last_message_id пересчитываем: в дампе оно могло устареть,
    # а триггер при загрузке данных не сработал — он сработал бы уже после
    # восстановления ограничения.
    & docker exec $Container psql -U $DbUser -d $DbName -q -c @"
UPDATE public.chats SET last_message_id = sub.id
FROM (
    SELECT DISTINCT ON (chat_id) chat_id, id
    FROM public.messages WHERE chat_id IS NOT NULL
    ORDER BY chat_id, created_at DESC, id DESC
) sub
WHERE public.chats.id = sub.chat_id;
"@ | Out-Null

    Write-Info (Get-Counts)
}

# ---------------------------------------------------------------
switch ($Command) {
    "backup"  { Invoke-Backup }
    "list"    { Show-Backups }
    "restore" { Invoke-Restore }
    "reset"   { Invoke-Reset }
}
