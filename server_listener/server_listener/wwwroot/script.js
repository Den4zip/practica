document.addEventListener('DOMContentLoaded', function() {
    // --- DOM Элементы ---
    const eventTypeFilter = document.getElementById('eventTypeFilter');
    const sourceFilter = document.getElementById('sourceFilter');
    const logNameFilter = document.getElementById('logNameFilter');
    const searchFilter = document.getElementById('searchFilter');
    const sortOrder = document.getElementById('sortOrder');
    const itemsPerPageSelect = document.getElementById('itemsPerPage');
    
    const applyFiltersBtn = document.getElementById('applyFilters');
    const resetFiltersBtn = document.getElementById('resetFilters');
    const exportCSVBtn = document.getElementById('exportCSV');
    const autoUpdateCheck = document.getElementById('autoUpdate');
    const clearErrorsBtn = document.getElementById('clearErrors');

    const logsTableBody = document.getElementById('logs-table-body');
    const paginationControls = document.getElementById('pagination-controls');
    const errorContainer = document.getElementById('error-container');

    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    // --- Переменные состояния ---
    let currentPage = 1;
    let autoUpdateInterval = null;
    let currentPageData = []; // Данные для текущей страницы

    // --- Инициализация ---
    function initialize() {
        addError('[ИНФО] Инициализация панели управления...');
        // Загрузка динамических опций для фильтров
        fetchDynamicOptions('/api/logs/eventtypes', eventTypeFilter, 'типы событий');
        fetchDynamicOptions('/api/logs/sources', sourceFilter, 'источники');
        fetchDynamicOptions('/api/logs/lognames', logNameFilter, 'имена журналов'); // Предполагаемый эндпоинт
        
        // Первоначальная загрузка логов
        fetchLogs();
        
        // Навешиваем обработчики
        setupEventListeners();
        addError('[ИНФО] Панель управления готова к работе.');
    }

    // --- Установка обработчиков событий ---
    function setupEventListeners() {
        applyFiltersBtn.addEventListener('click', () => fetchLogs(true));
        searchFilter.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') fetchLogs(true);
        });

        resetFiltersBtn.addEventListener('click', () => {
            document.querySelectorAll('#eventTypeFilter, #sourceFilter, #logNameFilter').forEach(el => el.value = '');
            searchFilter.value = '';
            sortOrder.value = 'desc';
            fetchLogs(true);
            addError('[ИНФО] Фильтры сброшены.');
        });
        
        itemsPerPageSelect.addEventListener('change', () => fetchLogs(true));

        autoUpdateCheck.addEventListener('change', function() {
            if (this.checked) {
                addError('[ИНФО] Автообновление включено (15 сек).');
                autoUpdateInterval = setInterval(() => fetchLogs(false, true), 15000); // don't reset page, suppress errors for background refresh
            } else {
                clearInterval(autoUpdateInterval);
                autoUpdateInterval = null;
                addError('[ИНФО] Автообновление отключено.');
            }
        });

        exportCSVBtn.addEventListener('click', exportToCSV);
        clearErrorsBtn.addEventListener('click', clearErrorLog);

        logsTableBody.addEventListener('click', handleTableRowClick);
    }
    
    // --- Функции для загрузки данных ---

    async function fetchLogs(resetPage = false, isBackground = false) {
        if (resetPage) {
            currentPage = 1;
        }
        
        const eventType = eventTypeFilter.value;
        const logName = logNameFilter.value;
        const source = sourceFilter.value;
        const search = searchFilter.value;
        const sort = sortOrder.value;
        const pageSize = itemsPerPageSelect.value;
        
        let url = new URL('/api/logs', window.location.origin);
        url.searchParams.append('page', currentPage);
        url.searchParams.append('pageSize', pageSize);
        url.searchParams.append('sortOrder', sort);
        if (eventType) url.searchParams.append('eventType', eventType);
        if (logName) url.searchParams.append('logName', logName);
        if (source) url.searchParams.append('source', source);
        if (search) url.searchParams.append('search', search);

        try {
            const response = await fetch(url);
            if (!response.ok) {
                 throw new Error(`Ошибка сети: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();

            if (data.Error && !isBackground) {
                throw new Error(`Ошибка API: ${data.Error}`);
            }
            
            currentPageData = data.Logs || [];
            renderTable(currentPageData);
            renderPagination(data.TotalPages);
            updateStats(data); // Передаем весь объект данных

            // Обновляем фильтры, чтобы показывать только релевантные опции
            fetchDynamicOptions('/api/logs/eventtypes', eventTypeFilter, 'типы событий', true);
            fetchDynamicOptions('/api/logs/sources', sourceFilter, 'источники', true);
            fetchDynamicOptions('/api/logs/lognames', logNameFilter, 'имена журналов', true);
            
            setOnlineStatus(true);
            if (!isBackground) {
                 addError(`[ИНФО] Загружено ${currentPageData.length} записей (Страница ${currentPage} из ${data.TotalPages || 1}).`);
            }

        } catch (error) {
            if (!isBackground) {
                addError(`[ОШИБКА] Не удалось загрузить логи: ${error.message}`);
                setOnlineStatus(false);
            }
        }
    }

    async function fetchDynamicOptions(url, filterElement, name, preserveValue = false) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Ошибка сети');
            
            const options = await response.json();
            
            const currentValue = preserveValue ? filterElement.value : '';
            
            filterElement.innerHTML = '<option value="">Все</option>'; // Очищаем старые опции

            options.forEach(optionText => {
                const option = document.createElement('option');
                option.value = optionText;
                option.textContent = optionText;
                filterElement.appendChild(option);
            });

            if (preserveValue) {
                filterElement.value = currentValue;
            }
        } catch (error) {
            addError(`[ОШИБКА] Не удалось загрузить ${name}: ${error.message}`);
        }
    }

    // --- Функции для отрисовки ---

    function renderTable(logs) {
        logsTableBody.innerHTML = '';

        if (!logs || logs.length === 0) {
            logsTableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Записи не найдены</td></tr>';
            return;
        }

        logs.forEach(log => {
            const row = document.createElement('tr');
            row.dataset.id = log.Id;
            
            const message = log.Message ? (log.Message.length > 50 ? log.Message.substring(0, 50) + '...' : log.Message) : 'Пустое сообщение';

            row.innerHTML = `
                <td>${log.Id}</td>
                <td>${new Date(log.TimeCreated).toLocaleString('ru-RU')}</td>
                <td>${log.EventType || 'N/A'}</td>
                <td>${getLevelBadge(log.LevelDisplayName)}</td>
                <td style="text-align: center;">${log.MachineName || 'N/A'}</td>
                <td>${log.Source || 'N/A'}</td>
                <td>${log.LogName || 'N/A'}</td>
                <td>${escapeHtml(message)}</td>
            `;
            logsTableBody.appendChild(row);
        });
    }
    
    function getLevelBadge(level) {
        if (!level) return `<span class="badge bg-secondary">N/A</span>`;
        const l = level.toLowerCase();
        if (l.includes('ошибка') || l.includes('error') || l === 'error') return `<span class="badge bg-danger">${level}</span>`;
        if (l.includes('предупреждение') || l.includes('warning') || l === 'warning') return `<span class="badge bg-warning text-dark">${level}</span>`;
        if (l.includes('инфо') || l.includes('info') || l === 'info') return `<span class="badge bg-success text-white">${level}</span>`;
        return `<span class="badge bg-secondary">${level}</span>`;
    }

    function renderPagination(totalPages) {
        paginationControls.innerHTML = '';
        if (totalPages <= 1) return;

        const createPageLink = (page, text, isDisabled = false, isActive = false) => {
            const li = document.createElement('li');
            li.className = `page-item ${isDisabled ? 'disabled' : ''} ${isActive ? 'active' : ''}`;
            li.innerHTML = `<a class="page-link" href="#" data-page="${page}">${text}</a>`;
            return li;
        };
        
        paginationControls.appendChild(createPageLink(currentPage - 1, 'Назад', currentPage === 1));

        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, currentPage + 2);
        
        if (currentPage > 3) {
            paginationControls.appendChild(createPageLink(1, '1'));
            if (currentPage > 4) paginationControls.appendChild(createPageLink(0, '...', true));
        }

        for (let i = startPage; i <= endPage; i++) {
            paginationControls.appendChild(createPageLink(i, i, false, i === currentPage));
        }

        if (currentPage < totalPages - 2) {
             if (currentPage < totalPages - 3) paginationControls.appendChild(createPageLink(0, '...', true));
            paginationControls.appendChild(createPageLink(totalPages, totalPages));
        }

        paginationControls.appendChild(createPageLink(currentPage + 1, 'Вперед', currentPage === totalPages));
        
        paginationControls.querySelectorAll('.page-link').forEach(link => {
            if (link.parentElement.classList.contains('disabled')) return;
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = parseInt(e.target.dataset.page, 10);
                if (page) {
                    currentPage = page;
                    fetchLogs();
                }
            });
        });
    }

    function updateStats(data) {
        if (!data) {
            document.getElementById('stat-total').innerText = 0;
            document.getElementById('stat-errors').innerText = 0;
            document.getElementById('stat-warnings').innerText = 0;
            document.getElementById('stat-infos').innerText = 0;
            return;
        }
        
        const statsSource = data.Stats || data;

        document.getElementById('stat-total').innerText = statsSource.TotalCount ?? statsSource.Total ?? 0;
        document.getElementById('stat-errors').innerText = statsSource.ErrorCount ?? statsSource.Errors ?? 0;
        document.getElementById('stat-warnings').innerText = statsSource.WarningCount ?? statsSource.Warnings ?? 0;
        document.getElementById('stat-infos').innerText = statsSource.InfoCount ?? statsSource.Infos ?? 0;
    }

    // --- Вспомогательные функции ---

    async function exportToCSV() {
        addError('[ИНФО] Подготовка данных для экспорта...');
        
        const eventType = eventTypeFilter.value;
        const logName = logNameFilter.value;
        const source = sourceFilter.value;
        const search = searchFilter.value;
        const sort = sortOrder.value;
        
        let url = new URL('/api/logs', window.location.origin);
        url.searchParams.append('page', 1);
        url.searchParams.append('pageSize', -1); // Сигнал для API, чтобы вернуть все записи
        url.searchParams.append('sortOrder', sort);
        if (eventType) url.searchParams.append('eventType', eventType);
        if (logName) url.searchParams.append('logName', logName);
        if (source) url.searchParams.append('source', source);
        if (search) url.searchParams.append('search', search);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Сетевая ошибка при экспорте');
            const data = await response.json();
            const logsToExport = data.Logs;

            if (!logsToExport || logsToExport.length === 0) {
                return addError('[ВНИМАНИЕ] Нет данных для экспорта, соответствующих текущим фильтрам!');
            }

            const headers = ['ID', 'Время', 'Тип события', 'Уровень', 'Компьютер', 'Источник', 'Журнал', 'Сообщение'];
            const rows = logsToExport.map(row => [
                row.Id, `"${new Date(row.TimeCreated).toLocaleString('ru-RU')}"`, row.EventType, row.LevelDisplayName, row.MachineName, row.Source, row.LogName, `"${(row.Message || '').replace(/"/g, '""')}"`
            ].join(','));
            
            const csvContent = [headers.join(','), ...rows].join('
');
            const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `логи_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            addError('[ИНФО] Экспорт в CSV успешно завершен.');

        } catch (error) {
             addError(`[ОШИБКА] Экспорт не удался: ${error.message}`);
        }
    }

    function addError(message) {
        errorContainer.classList.add('has-errors');
        const time = new Date().toLocaleTimeString('ru-RU');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-line';
        errorDiv.innerHTML = `<span class="error-time">[${time}]</span> ${escapeHtml(message)}`;
        errorContainer.appendChild(errorDiv);
        errorContainer.scrollTop = errorContainer.scrollHeight;
    }

    function clearErrorLog() {
        errorContainer.innerHTML = `<div class="empty-state">Нет ошибок</div>`;
        errorContainer.classList.remove('has-errors');
    }

    function handleTableRowClick(e) {
        const row = e.target.closest('tr');
        if (!row || !row.dataset.id) return;
        
        const item = currentPageData.find(d => d.Id == row.dataset.id);
        if(!item) {
            addError(`[ВНИМАНИЕ] Не удалось найти данные для ID ${row.dataset.id}`);
            return;
        }
        
        document.getElementById('modal-id').innerText = `ID: ${item.Id}`;
        document.getElementById('modal-time').innerText = new Date(item.TimeCreated).toLocaleString('ru-RU');
        document.getElementById('modal-computer').innerText = item.MachineName;
        document.getElementById('modal-type').innerText = item.EventType;
        document.getElementById('modal-level').innerHTML = getLevelBadge(item.LevelDisplayName);
        document.getElementById('modal-source').innerText = item.Source;
        document.getElementById('modal-logname').innerText = item.LogName;
        document.getElementById('modal-message').innerText = item.Message;
        
        new bootstrap.Modal(document.getElementById('detailModal')).show();
    }
    
    function setOnlineStatus(isOnline) {
        if (isOnline) {
            statusIndicator.classList.remove('offline');
            statusText.innerText = 'Онлайн';
            statusText.className = 'ms-1 fw-bold text-success';
        } else {
            statusIndicator.classList.add('offline');
            statusText.innerText = 'Офлайн';
            statusText.className = 'ms-1 fw-bold text-danger';
        }
    }

    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // --- Запуск ---
    initialize();
});
