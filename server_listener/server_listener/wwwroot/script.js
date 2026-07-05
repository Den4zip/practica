document.addEventListener('DOMContentLoaded', function () {
    // --- Константы ---
    const AUTO_UPDATE_INTERVAL = 15000; // 15 секунд

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
    const detailModalElement = document.getElementById('detailModal');
    
    // --- Переменные состояния ---
    let logs = [];
    let currentPage = 1;
    let totalPages = 1;
    let autoUpdateInterval = null;
    let detailModal = null;

    // --- Инициализация ---
    function initialize() {
        addError('[ИНФО] Инициализация панели управления...');
        detailModal = new bootstrap.Modal(detailModalElement);
        setupEventListeners();
        loadInitialData();
    }

    // --- Установка обработчиков событий ---
    function setupEventListeners() {
        applyFiltersBtn.addEventListener('click', () => {
            currentPage = 1;
            fetchLogs();
        });
        resetFiltersBtn.addEventListener('click', () => {
            document.querySelectorAll('#eventTypeFilter, #sourceFilter, #logNameFilter').forEach(el => el.value = '');
            searchFilter.value = '';
            sortOrder.value = 'desc';
            currentPage = 1;
            fetchLogs();
            addError('[ИНФО] Фильтры сброшены.');
        });
        searchFilter.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                currentPage = 1;
                fetchLogs();
            }
        });
        itemsPerPageSelect.addEventListener('change', () => {
            currentPage = 1;
            fetchLogs();
        });
        autoUpdateCheck.addEventListener('change', function () {
            if (this.checked) {
                addError(`[ИНФО] Автообновление включено (${AUTO_UPDATE_INTERVAL / 1000} сек).`);
                autoUpdateInterval = setInterval(fetchLogs, AUTO_UPDATE_INTERVAL);
            } else {
                clearInterval(autoUpdateInterval);
                autoUpdateInterval = null;
                addError('[ИНФО] Автообновление отключено.');
            }
        });
        exportCSVBtn.addEventListener('click', exportToCSV); // Экспорт теперь должен учитывать фильтры
        clearErrorsBtn.addEventListener('click', clearErrorLog);
        logsTableBody.addEventListener('click', handleTableRowClick);
        paginationControls.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' && e.target.dataset.page) {
                e.preventDefault();
                const page = parseInt(e.target.dataset.page, 10);
                if (page && page !== currentPage) {
                    currentPage = page;
                    fetchLogs();
                }
            }
        });
    }

    // --- Загрузка и обработка данных ---
    async function loadInitialData() {
        await fetchLogs();
        await loadFilterOptions();
    }
    
    async function fetchLogs() {
        try {
            setOnlineStatus(true);
            const params = new URLSearchParams({
                page: currentPage,
                pageSize: itemsPerPageSelect.value,
                eventType: eventTypeFilter.value,
                source: sourceFilter.value,
                logName: logNameFilter.value,
                search: searchFilter.value,
                sortOrder: sortOrder.value
            });

            const response = await fetch(`/api/logs?${params}`);
            if (!response.ok) {
                throw new Error(`Ошибка сети: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            
            if (data && Array.isArray(data.logs)) {
                logs = data.logs;
                totalPages = data.totalPages;
                addError(`[ИНФО] Загружено ${logs.length} записей.`);
                render();
            } else {
                throw new Error('API вернул данные в неожиданном формате.');
            }
        } catch (error) {
            addError(`[ОШИБКА] Не удалось получить данные: ${error.message}`);
            setOnlineStatus(false);
            logs = [];
            totalPages = 1;
            render(); // Очищаем таблицу в случае ошибки
        }
    }
    
    async function loadFilterOptions() {
        try {
            const [sourcesRes, eventTypesRes] = await Promise.all([
                fetch('/api/logs/sources'),
                fetch('/api/logs/eventtypes')
            ]);
            if (!sourcesRes.ok || !eventTypesRes.ok) throw new Error('Failed to load filter options');
            
            const sources = await sourcesRes.json();
            const eventTypes = await eventTypesRes.json();
            
            populateDropdown(sourceFilter, sources);
            populateDropdown(eventTypeFilter, eventTypes);
            
        } catch (error) {
            addError(`[ОШИБКА] Не удалось загрузить опции фильтров: ${error.message}`);
        }
    }
    
    function populateDropdown(selectElement, options) {
        const currentValue = selectElement.value;
        selectElement.innerHTML = '<option value="">Все</option>';
        options.forEach(option => {
            const opt = document.createElement('option');
            opt.value = option;
            opt.textContent = option;
            selectElement.appendChild(opt);
        });
        selectElement.value = currentValue;
    }

    // --- Функции для отрисовки ---
    function render() {
        renderTable();
        renderPagination();
        updateStats(); // Статистика теперь будет менее точной (только для текущей страницы), можно доработать
    }

    function updateStats() {
        const getCount = (filterFunc) => logs.filter(filterFunc).length;
        const getLevel = (levelStr) => (d) => (d.levelDisplayName || '').toLowerCase().includes(levelStr);
        document.getElementById('stat-total').innerText = logs.length; // Показывает кол-во на странице
        document.getElementById('stat-errors').innerText = getCount(getLevel('ошибка')) + getCount(getLevel('error'));
        document.getElementById('stat-warnings').innerText = getCount(getLevel('предупреждение')) + getCount(getLevel('warning'));
        document.getElementById('stat-infos').innerText = getCount(getLevel('инфо')) + getCount(getLevel('info'));
    }

    function renderTable() {
        logsTableBody.innerHTML = '';
        if (logs.length === 0) {
            logsTableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Записи не найдены</td></tr>';
            return;
        }

        logs.forEach(log => {
            const row = document.createElement('tr');
            row.dataset.id = log.id;
            row.className = getTableRowClass(log);

            const message = log.message ? (log.message.length > 50 ? log.message.substring(0, 50) + '...' : log.message) : 'Пустое сообщение';
            
            row.innerHTML = `
                <td>${log.id}</td>
                <td>${new Date(log.timeCreated).toLocaleString('ru-RU')}</td>
                <td>${escapeHtml(log.eventType) || 'N/A'}</td>
                <td>${getLevelBadge(log.levelDisplayName)}</td>
                <td style="text-align: center;">${escapeHtml(log.machineName) || 'N/A'}</td>
                <td>${escapeHtml(log.source) || 'N/A'}</td>
                <td>${escapeHtml(log.logName) || 'N/A'}</td>
                <td class="message-cell">${escapeHtml(message)}</td>
            `;
            logsTableBody.appendChild(row);
        });
    }

    function renderPagination() {
        paginationControls.innerHTML = '';
        if (totalPages <= 1) return;

        const createPageLink = (page, text, isDisabled = false, isActive = false) => {
            const li = document.createElement('li');
            li.className = `page-item ${isDisabled ? 'disabled' : ''} ${isActive ? 'active' : ''}`;
            const link = document.createElement('a');
            link.className = 'page-link';
            link.href = '#';
            link.dataset.page = page;
            link.innerText = text;
            li.appendChild(link);
            return li;
        };
        
        const addPage = (page, text = page) => {
            paginationControls.appendChild(createPageLink(page, text, false, page === currentPage));
        };
        
        const addEllipsis = () => {
            const li = document.createElement('li');
            li.className = 'page-item disabled';
            li.innerHTML = `<span class="page-link">...</span>`;
            paginationControls.appendChild(li);
        };
        
        paginationControls.appendChild(createPageLink(currentPage - 1, 'Назад', currentPage === 1));

        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) addPage(i);
        } else {
            addPage(1);
            if (currentPage > 3) addEllipsis();
            if (currentPage > 2) addPage(currentPage - 1);
            if (currentPage !== 1 && currentPage !== totalPages) addPage(currentPage);
            if (currentPage < totalPages - 1) addPage(currentPage + 1);
            if (currentPage < totalPages - 2) addEllipsis();
            addPage(totalPages);
        }

        paginationControls.appendChild(createPageLink(currentPage + 1, 'Вперед', currentPage === totalPages));
    }

    function getLevelBadge(level) {
        if (!level) return `<span class="badge bg-secondary">N/A</span>`;
        const l = level.toLowerCase();
        if (l.includes('ошибка') || l.includes('error')) return `<span class="badge bg-danger">${level}</span>`;
        if (l.includes('предупреждение') || l.includes('warning')) return `<span class="badge bg-warning text-dark">${level}</span>`;
        if (l.includes('инфо') || l.includes('info')) return `<span class="badge bg-success text-white">${level}</span>`;
        return `<span class="badge bg-secondary">${level}</span>`;
    }

    function getTableRowClass(log) {
        const level = (log.levelDisplayName || '').toLowerCase();
        const type = (log.eventType || '').toLowerCase();

        if (level.includes('ошибка') || level.includes('error')) return 'table-row-error';
        if (level.includes('предупреждение') || level.includes('warning')) return 'table-row-warning';
        if (type === 'security') return 'table-row-security';
        if (type === 'metric') return 'table-row-metric';
        if (level.includes('инфо')) return 'table-row-info';
        return '';
    }

    // --- Вспомогательные функции ---
    async function exportToCSV() {
        addError('[ИНФО] Подготовка полного отчета для экспорта...');
        // Для экспорта всех данных, снимем лимиты на стороне клиента
        const params = new URLSearchParams({
            pageSize: 10000, // Увеличиваем лимит для экспорта
            eventType: eventTypeFilter.value,
            source: sourceFilter.value,
            logName: logNameFilter.value,
            search: searchFilter.value,
            sortOrder: sortOrder.value
        });

        try {
            const response = await fetch(`/api/logs?${params}`);
            if (!response.ok) throw new Error('Failed to fetch data for export');
            const data = await response.json();
            
            if (!data.logs || data.logs.length === 0) return addError('[ВНИМАНИЕ] Нет данных для экспорта!');

            const headers = ['ID', 'Время', 'Тип события', 'Уровень', 'Компьютер', 'Источник', 'Журнал', 'Сообщение'];
            const rows = data.logs.map(row => [
                row.id, `"${new Date(row.timeCreated).toLocaleString('ru-RU')}"`, row.eventType, row.levelDisplayName, row.machineName, row.source, row.logName, `"${(row.message || '').replace(/"/g, '""')}"`
            ].join(','));
            const csvContent = [headers.join(','), ...rows].join('
');
            const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `логи_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            addError(`[ИНФО] Экспорт ${data.logs.length} записей завершен.`);
        } catch(error) {
            addError(`[ОШИБКА] Экспорт не удался: ${error.message}`);
        }
    }
    
    function handleTableRowClick(e) {
        const row = e.target.closest('tr');
        if (!row || !row.dataset.id) return;
        // Найдем лог в текущем срезе данных
        const item = logs.find(d => d.id == row.dataset.id);
        if (!item) return;

        document.getElementById('modal-id').innerText = item.id;
        document.getElementById('modal-time').innerText = new Date(item.timeCreated).toLocaleString('ru-RU');
        document.getElementById('modal-computer').innerText = item.machineName || 'N/A';
        document.getElementById('modal-type').innerText = item.eventType || 'N/A';
        document.getElementById('modal-level').innerHTML = getLevelBadge(item.levelDisplayName);
        document.getElementById('modal-source').innerText = item.source || 'N/A';
        document.getElementById('modal-logname').innerText = item.logName || 'N/A';
        document.getElementById('modal-message').innerText = item.message || 'Нет сообщения.';
        
        detailModal.show();
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
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // --- Запуск ---
    initialize();
});