document.addEventListener('DOMContentLoaded', function() {
    // Элементы управления
    const logNameFilter = document.getElementById('logNameFilter');
    const sourceFilter = document.getElementById('sourceFilter');
    const searchFilter = document.getElementById('searchFilter');
    const sortOrder = document.getElementById('sortOrder');
    const applyFilters = document.getElementById('applyFilters');
    const autoUpdate = document.getElementById('autoUpdate');
    
    // Переменные состояния
    let currentPage = 1;
    const pageSize = 30; // Увеличим размер страницы для наглядности
    let autoUpdateInterval;

    // --- Инициализация ---

    // Загружаем источники для фильтра
    fetchSources();
    // Загружаем первые логи
    fetchLogs();

    // --- Обработчики событий ---

    applyFilters.addEventListener('click', () => {
        currentPage = 1;
        fetchLogs();
    });
    
    searchFilter.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            currentPage = 1;
            fetchLogs();
        }
    });

    autoUpdate.addEventListener('change', function() {
        if (this.checked) {
            autoUpdateInterval = setInterval(fetchLogs, 15000); // 15 секунд
        } else {
            clearInterval(autoUpdateInterval);
        }
    });

    // --- Функции ---

    /**
     * Загружает уникальные источники логов и заполняет выпадающий список.
     */
    function fetchSources() {
        fetch('/api/logs/sources')
            .then(response => response.json())
            .then(sources => {
                sources.forEach(source => {
                    const option = document.createElement('option');
                    option.value = source;
                    option.textContent = source;
                    sourceFilter.appendChild(option);
                });
            })
            .catch(error => console.error('Ошибка при загрузке источников:', error));
    }

    /**
     * Загружает и отображает логи в соответствии с текущими фильтрами.
     */
    function fetchLogs() {
        const logName = logNameFilter.value;
        const source = sourceFilter.value;
        const search = searchFilter.value;
        const sort = sortOrder.value;
        
        let url = new URL('/api/logs', window.location.origin);
        url.searchParams.append('page', currentPage);
        url.searchParams.append('pageSize', pageSize);
        url.searchParams.append('sortOrder', sort);
        if (logName) url.searchParams.append('logName', logName);
        if (source) url.searchParams.append('source', source);
        if (search) url.searchParams.append('search', search);

        fetch(url)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then(data => {
                renderTable(data.logs);
                renderPagination(data.totalPages);
            })
            .catch(error => console.error('Ошибка при загрузке логов:', error));
    }

    /**
     * Определяет CSS-класс для строки таблицы на основе уровня лога.
     * @param {object} log - Объект лога.
     * @returns {string} CSS-класс.
     */
    function getLogLevelClass(log) {
        const level = log.levelDisplayName.toLowerCase();
        if (level.includes('error')) return 'table-row-error';
        if (level.includes('warning')) return 'table-row-warning';
        
        const message = log.message.toLowerCase();
        if (message.includes('security audit') || log.logName.toLowerCase() === 'security') return 'table-row-security';
        if (message.includes('free space') || message.includes('disk metric')) return 'table-row-metric';

        return 'table-row-info';
    }

    /**
     * Отображает данные логов в таблице.
     * @param {Array} logs - Массив объектов логов.
     */
    function renderTable(logs) {
        const tbody = document.getElementById('logs-table-body');
        tbody.innerHTML = ''; // Очищаем перед обновлением

        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">Записи не найдены</td></tr>';
            return;
        }

        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.className = getLogLevelClass(log);

            tr.innerHTML = `
                <td>${log.id}</td>
                <td>${new Date(log.timeCreated).toLocaleString()}</td>
                <td><span class="badge ${getBadgeClass(log.levelDisplayName)}">${log.levelDisplayName}</span></td>
                <td>${log.machineName}</td>
                <td>${log.source}</td>
                <td>${log.logName}</td>
                <td class="message-cell">${escapeHtml(log.message)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    /**
     * Создает соответствующий класс для значка (badge) Bootstrap.
     */
    function getBadgeClass(level) {
        const l = level.toLowerCase();
        if (l.includes('error')) return 'bg-danger';
        if (l.includes('warning')) return 'bg-warning text-dark';
        if (l.includes('information')) return 'bg-info text-dark';
        return 'bg-secondary';
    }

    /**
     * Экранирует HTML для безопасного отображения.
     */
    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    /**
     * Отображает элементы управления пагинацией.
     * @param {number} totalPages - Общее количество страниц.
     */
    function renderPagination(totalPages) {
        const paginationControls = document.getElementById('pagination-controls');
        paginationControls.innerHTML = '';

        // Ограничим количество отображаемых страниц для больших списков
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, currentPage + 2);

        if (currentPage > 3) {
            addPageLink(1, '1');
            if(currentPage > 4) paginationControls.appendChild(createEllipsis());
        }

        for (let i = startPage; i <= endPage; i++) {
            addPageLink(i, i);
        }

        if (currentPage < totalPages - 2) {
             if(currentPage < totalPages - 3) paginationControls.appendChild(createEllipsis());
            addPageLink(totalPages, totalPages);
        }
    }
    
    function addPageLink(pageNumber, text) {
        const li = document.createElement('li');
        li.className = `page-item ${pageNumber === currentPage ? 'active' : ''}`;
        const a = document.createElement('a');
        a.className = 'page-link';
        a.href = '#';
        a.innerText = text;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            currentPage = pageNumber;
            fetchLogs();
        });
        li.appendChild(a);
        paginationControls.appendChild(li);
    }
    
    function createEllipsis() {
        const li = document.createElement('li');
        li.className = 'page-item disabled';
        li.innerHTML = `<span class="page-link">…</span>`;
        return li;
    }
});
