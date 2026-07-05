document.addEventListener('DOMContentLoaded', function () {
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
    let allLogs = [];
    let filteredLogs = [];
    let currentPage = 1;
    let autoUpdateInterval = null;

    // --- Инициализация ---
    function initialize() {
        addError('[ИНФО] Инициализация панели управления...');
        setupEventListeners();
        loadDataFromServer();
    }

    // --- Установка обработчиков событий ---
    function setupEventListeners() {
        applyFiltersBtn.addEventListener('click', applyFiltersAndRender);
        resetFiltersBtn.addEventListener('click', () => {
            document.querySelectorAll('#eventTypeFilter, #sourceFilter, #logNameFilter').forEach(el => el.value = '');
            searchFilter.value = '';
            sortOrder.value = 'desc';
            applyFiltersAndRender();
            addError('[ИНФО] Фильтры сброшены.');
        });
        searchFilter.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') applyFiltersAndRender();
        });
        itemsPerPageSelect.addEventListener('change', () => {
            currentPage = 1;
            render();
        });
        autoUpdateCheck.addEventListener('change', function () {
            if (this.checked) {
                addError('[ИНФО] Автообновление включено (15 сек).');
                autoUpdateInterval = setInterval(loadDataFromServer, 15000);
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

    // --- Загрузка и обработка данных ---
    async function loadDataFromServer() {
        try {
            setOnlineStatus(true);
            const response = await fetch('/api/logs');
            if (!response.ok) {
                throw new Error(`Ошибка сети: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();

            if (Array.isArray(data)) {
                allLogs = data;
            } else if (data && Array.isArray(data.logs)) {
                allLogs = data.logs;
            } else {
                throw new Error('API вернул данные в неожиданном формате.');
            }
            
            addError(`[ИНФО] Загружено ${allLogs.length} записей из базы данных.`);
            updateFilterDropdowns();
            applyFiltersAndRender();
        } catch (error) {
            addError(`[ОШИБКА] Не удалось получить данные: ${error.message}`);
            setOnlineStatus(false);
        }
    }

    function applyFiltersAndRender() {
        const type = eventTypeFilter.value;
        const source = sourceFilter.value;
        const logName = logNameFilter.value;
        const search = searchFilter.value.toLowerCase();
        const sort = sortOrder.value;

        filteredLogs = allLogs.filter(item => {
            const matchType = !type || item.eventType === type;
            const matchSource = !source || item.source === source;
            const matchLog = !logName || item.logName === logName;
            const matchSearch = !search ||
                (item.message && item.message.toLowerCase().includes(search)) ||
                (item.machineName && item.machineName.toLowerCase().includes(search));
            return matchType && matchSource && matchLog && matchSearch;
        });

        filteredLogs.sort((a, b) => {
            const dateA = new Date(a.timeCreated || 0);
            const dateB = new Date(b.timeCreated || 0);
            return sort === 'asc' ? dateA - dateB : dateB - dateA;
        });
        currentPage = 1;
        render();
    }
    
    function updateFilterDropdowns() {
        const populate = (select, values) => {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Все</option>';
            values.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.innerText = v;
                select.appendChild(opt);
            });
            select.value = currentValue;
        };
        populate(sourceFilter, [...new Set(allLogs.map(item => item.source).filter(Boolean))].sort());
        populate(logNameFilter, [...new Set(allLogs.map(item => item.logName).filter(Boolean))].sort());
    }

    // --- Функции для отрисовки ---
    function render() {
        updateStats();
        renderTable();
        renderPagination();
    }

    function updateStats() {
        const getCount = (filterFunc) => filteredLogs.filter(filterFunc).length;
        const getLevel = (levelStr) => (d) => (d.levelDisplayName || '').toLowerCase().includes(levelStr);
        document.getElementById('stat-total').innerText = filteredLogs.length;
        document.getElementById('stat-errors').innerText = getCount(getLevel('ошибка')) + getCount(getLevel('error'));
        document.getElementById('stat-warnings').innerText = getCount(getLevel('предупреждение')) + getCount(getLevel('warning'));
        document.getElementById('stat-infos').innerText = getCount(getLevel('инфо')) + getCount(getLevel('info'));
    }

    function renderTable() {
        logsTableBody.innerHTML = '';
        const itemsPerPage = parseInt(itemsPerPageSelect.value, 10);
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const pageData = filteredLogs.slice(start, end);

        if (pageData.length === 0) {
            logsTableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Записи не найдены</td></tr>';
            return;
        }

        pageData.forEach(log => {
            const row = document.createElement('tr');
            row.dataset.id = log.id;
            const message = log.message ? (log.message.length > 50 ? log.message.substring(0, 50) + '...' : log.message) : 'Пустое сообщение';
            row.innerHTML = `
                <td>${log.id}</td>
                <td>${new Date(log.timeCreated).toLocaleString('ru-RU')}</td>
                <td>${log.eventType || 'N/A'}</td>
                <td>${getLevelBadge(log.levelDisplayName)}</td>
                <td style="text-align: center;">${log.machineName || 'N/A'}</td>
                <td>${log.source || 'N/A'}</td>
                <td>${log.logName || 'N/A'}</td>
                <td>${escapeHtml(message)}</td>
            `;
            logsTableBody.appendChild(row);
        });
    }

    function renderPagination() {
        const itemsPerPage = parseInt(itemsPerPageSelect.value, 10);
        const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
        paginationControls.innerHTML = '';
        if (totalPages <= 1) return;

        const createPageLink = (page, text, isDisabled = false, isActive = false) => {
            const li = document.createElement('li');
            li.className = `page-item ${isDisabled ? 'disabled' : ''} ${isActive ? 'active' : ''}`;
            li.innerHTML = `<a class="page-link" href="#" data-page="${page}">${text}</a>`;
            return li;
        };

        paginationControls.appendChild(createPageLink(currentPage - 1, 'Назад', currentPage === 1));
        for (let i = 1; i <= totalPages; i++) {
             if (i === currentPage || (i >= currentPage - 2 && i <= currentPage + 2)) {
                paginationControls.appendChild(createPageLink(i, i, false, i === currentPage));
             }
        }
        paginationControls.appendChild(createPageLink(currentPage + 1, 'Вперед', currentPage === totalPages));

        paginationControls.querySelectorAll('.page-link').forEach(link => {
            if (link.parentElement.classList.contains('disabled')) return;
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = parseInt(e.target.dataset.page, 10);
                if (page) {
                    currentPage = page;
                    render();
                }
            });
        });
    }

    function getLevelBadge(level) {
        if (!level) return `<span class="badge bg-secondary">N/A</span>`;
        const l = level.toLowerCase();
        if (l.includes('ошибка') || l.includes('error')) return `<span class="badge bg-danger">${level}</span>`;
        if (l.includes('предупреждение') || l.includes('warning')) return `<span class="badge bg-warning text-dark">${level}</span>`;
        if (l.includes('инфо') || l.includes('info')) return `<span class="badge bg-success text-white">${level}</span>`;
        return `<span class="badge bg-secondary">${level}</span>`;
    }

    // --- Вспомогательные функции ---
    function exportToCSV() {
        if (filteredLogs.length === 0) return addError('[ВНИМАНИЕ] Нет данных для экспорта!');
        const headers = ['ID', 'Время', 'Тип события', 'Уровень', 'Компьютер', 'Источник', 'Журнал', 'Сообщение'];
        const rows = filteredLogs.map(row => [
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
    }
    
    function handleTableRowClick(e) {
        const row = e.target.closest('tr');
        if (!row || !row.dataset.id) return;
        const item = allLogs.find(d => d.id == row.dataset.id);
        if (!item) return;

        document.getElementById('modal-id').innerText = `ID: ${item.id}`;
        document.getElementById('modal-time').innerText = new Date(item.timeCreated).toLocaleString('ru-RU');
        document.getElementById('modal-computer').innerText = item.machineName;
        document.getElementById('modal-type').innerText = item.eventType;
        document.getElementById('modal-level').innerHTML = getLevelBadge(item.levelDisplayName);
        document.getElementById('modal-source').innerText = item.source;
        document.getElementById('modal-logname').innerText = item.logName;
        document.getElementById('modal-message').innerText = item.message;
        new bootstrap.Modal(document.getElementById('detailModal')).show();
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
