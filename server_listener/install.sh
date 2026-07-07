#!/usr/bin/env bash
set -euo pipefail

APP_NAME="BEACON Server"
SERVICE_NAME="beacon-server"
INSTALL_DIR="/var/www/$SERVICE_NAME"
PUBLISH_DIR="/tmp/${SERVICE_NAME}_pub"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/server_listener"
DOTNET_VERSION="10.0"

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
NC='\033[0m'

info()  { echo -e "${GREEN}✔${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✖${NC} $1"; }
header(){ echo -e "\n${CYAN}═══ $1 ═══${NC}\n"; }

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN} Установка $APP_NAME${NC}"
echo -e "${CYAN}========================================${NC}${NC}"

# ---- 1. Проверка .NET SDK ----
header "Проверка зависимостей"

if ! command -v dotnet &>/dev/null; then
    error ".NET SDK не найден. Установите: https://dotnet.microsoft.com/download/dotnet/$DOTNET_VERSION"
    exit 1
fi

installed_version=$(dotnet --version | cut -d. -f1)
if [ "$installed_version" -lt "${DOTNET_VERSION%%.*}" ] 2>/dev/null; then
    warn "Версия .NET SDK: $(dotnet --version). Требуется $DOTNET_VERSION"
fi

info ".NET SDK: $(dotnet --version)"

# ---- 2. Публикация ----
header "Сборка проекта"

if [ ! -f "$PROJECT_DIR/server_listener.csproj" ]; then
    error "Проект не найден: $PROJECT_DIR"
    exit 1
fi

echo "Публикую проект..."
dotnet publish "$PROJECT_DIR" -c Release -r linux-x64 --self-contained true -o "$PUBLISH_DIR" -p:PublishSingleFile=true 2>&1
info "Проект собран: $PUBLISH_DIR"

# ---- 3. Ввод конфигурации ----
header "Конфигурация"

# MySQL
echo -e "${GRAY}--- Подключение к MySQL ---${NC}"
read -r -p "Хост MySQL [localhost]: " MYSQL_HOST
[ -z "$MYSQL_HOST" ] && MYSQL_HOST="localhost"

read -r -p "Порт MySQL [3306]: " MYSQL_PORT
[ -z "$MYSQL_PORT" ] && MYSQL_PORT="3306"

read -r -p "База данных [ErrorLogsDB]: " MYSQL_DB
[ -z "$MYSQL_DB" ] && MYSQL_DB="ErrorLogsDB"

read -r -p "Пользователь MySQL: " MYSQL_USER
while [ -z "$MYSQL_USER" ]; do
    read -r -p "Пользователь MySQL (обязательно): " MYSQL_USER
done

read -r -s -p "Пароль MySQL: " MYSQL_PASSWORD
echo
while [ -z "$MYSQL_PASSWORD" ]; do
    read -r -s -p "Пароль MySQL (обязательно): " MYSQL_PASSWORD
    echo
done

# Экранируем спецсимволы в пароле для JSON
MYSQL_PASSWORD_ESCAPED=$(printf '%s' "$MYSQL_PASSWORD" | sed 's/[&/\]/\\&/g; s/"/\\"/g')
CONNECTION_STRING="Server=$MYSQL_HOST;Port=$MYSQL_PORT;Database=$MYSQL_DB;User=$MYSQL_USER;Password=$MYSQL_PASSWORD_ESCAPED;"

echo
# Security
echo -e "${GRAY}--- Безопасность ---${NC}"
read -r -p "API-ключ для приёма логов (ingest) [SuperSecretKey123]: " API_KEY
[ -z "$API_KEY" ] && API_KEY="SuperSecretKey123"

read -r -p "Логин для панели мониторинга [admin]: " ADMIN_LOGIN
[ -z "$ADMIN_LOGIN" ] && ADMIN_LOGIN="admin"

read -r -s -p "Пароль для панели мониторинга [admin123]: " ADMIN_PASSWORD
echo
[ -z "$ADMIN_PASSWORD" ] && ADMIN_PASSWORD="admin123"

# Порты
echo -e "${GRAY}--- Порты ---${NC}"
read -r -p "Порт API и панели [80]: " API_PORT
[ -z "$API_PORT" ] && API_PORT="80"

read -r -p "Порт приёма логов (ingest) [8080]: " INGEST_PORT
[ -z "$INGEST_PORT" ] && INGEST_PORT="8080"

echo

# ---- 4. Создание папки установки ----
header "Установка файлов"

sudo mkdir -p "$INSTALL_DIR"
sudo cp "$PUBLISH_DIR/server_listener" "$INSTALL_DIR/"
if [ -d "$PUBLISH_DIR/wwwroot" ]; then
    sudo cp -r "$PUBLISH_DIR/wwwroot" "$INSTALL_DIR/wwwroot"
    info "Скопирована папка wwwroot (HTML, JS, CSS)"
fi
sudo cp "$PUBLISH_DIR/appsettings.json" "$INSTALL_DIR/appsettings.json.orig" 2>/dev/null || true
info "Скопирован исполняемый файл: $INSTALL_DIR/server_listener"

# ---- 5. Создание appsettings.json ----
sudo tee "$INSTALL_DIR/appsettings.json" > /dev/null <<EOF
{
  "ConnectionStrings": {
    "DefaultConnection": "$CONNECTION_STRING"
  },
  "Kestrel": {
    "Endpoints": {
      "HttpApi": {
        "Url": "http://*:$API_PORT"
      },
      "HttpIngest": {
        "Url": "http://*:$INGEST_PORT"
      }
    }
  },
  "Security": {
    "ApiKey": "$API_KEY",
    "Login": "$ADMIN_LOGIN",
    "Password": "$ADMIN_PASSWORD"
  },
  "RateLimiter": {
    "PermitLimit": 100,
    "Window": 60
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
EOF
info "Создан: $INSTALL_DIR/appsettings.json"

# ---- 6. Инициализация БД (опционально) ----
if [ -f "$SCRIPT_DIR/server_listener/init.sql" ]; then
    echo
    read -r -p "Выполнить init.sql для создания таблицы? (y/N): " RUN_INIT
    if [[ "$RUN_INIT" =~ ^[YyДд]$ ]]; then
        if command -v mysql &>/dev/null; then
            mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" < "$SCRIPT_DIR/server_listener/init.sql" && \
                info "init.sql выполнен" || \
                warn "Ошибка при выполнении init.sql (возможно, БД или таблица уже существует)"
        else
            warn "mysql client не найден. Выполните init.sql вручную:"
            echo "  mysql -h $MYSQL_HOST -P $MYSQL_PORT -u $MYSQL_USER -p < $SCRIPT_DIR/server_listener/init.sql"
        fi
    fi
fi

# ---- 7. Создание systemd unit ----
header "Настройка systemd"

SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=$APP_NAME — сервер сбора и мониторинга системных логов
After=network.target mysql.service mariadb.service
Wants=mysql.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/server_listener
Restart=on-failure
RestartSec=5
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=ASPNETCORE_URLS=
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF
info "Создан: $SERVICE_FILE"

sudo systemctl daemon-reload
info "systemd перечитал конфигурацию"

sudo systemctl enable "$SERVICE_NAME"
info "Служба добавлена в автозагрузку"

sudo systemctl start "$SERVICE_NAME"
info "Служба запущена"

# ---- 8. Проверка ----
sleep 3
if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo
    echo -e "${GREEN}✅ Установка завершена успешно!${NC}"
    echo -e "  Служба:       ${GRAY}$SERVICE_NAME${NC}"
    echo -e "  Папка:        ${GRAY}$INSTALL_DIR${NC}"
    echo -e "  Панель:       ${GRAY}http://<ip>:$API_PORT${NC}"
    echo -e "  Ingest:       ${GRAY}http://<ip>:$INGEST_PORT/query${NC}"
    echo
    echo -e "  Статус:       ${GRAY}$(sudo systemctl status "$SERVICE_NAME" --no-pager --lines=0 | head -3)${NC}"
else
    warn "Служба не запустилась. Проверьте логи:"
    echo "  sudo journalctl -u $SERVICE_NAME -f"
fi

# ---- 9. Очистка временных файлов ----
rm -rf "$PUBLISH_DIR"

echo
