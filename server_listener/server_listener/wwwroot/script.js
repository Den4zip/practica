document.addEventListener('DOMContentLoaded', function() {
    // Элементы управления
    const eventTypeFilter = document.getElementById('eventTypeFilter');
    const logNameFilter = document.getElementById('logNameFilter');
    const sourceFilter = document.getElementById('sourceFilter');
    const searchFilter = document.getElementById('searchFilter');
    const sortOrder = document.getElementById('sortOrder');
    const applyFilters = document.getElementById('applyFilters');
    const autoUpdate = document.getElementById('autoUpdate');
    
    // Переменные состояния
    let currentPage = 1;
    const pageSize = 30;
    let autoUpdateInterval;

    // --- Инициализация ---
    fetchEventTypes();
    fetchSources();
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

    // --- Функции для загрузки данных ---

    function fetchDynamicOptions(url, filterElement) {
        fetch(url)
            .then(response => response.json())
            .then(options => {
                // Сохраняем текущее значение, если оно есть
                const currentValue = filterElement.value;
                // Очищаем все, кроме первого элемента ("Все")
                while (filterElement.options.length > 1) {
                    filterElement.remove(1);
                }
                options.forEach(optionText => {
                    const option = document.createElement('option');
                    option.value = optionText;
                    option.textContent = optionText;
                    filterElement.appendChild(option);
                });
                // Восстанавливаем значение
                filterElement.value = currentValue;
            })
            .catch(error => console.error(`Ошибка при загрузке для ${filterElement.id}:`, error));
    }

    function fetchEventTypes() {
        fetchDynamicOptions('/api/logs/eventtypes', eventTypeFilter);
    }
    
    function fetchSources() {
        fetchDynamicOptions('/api/logs/sources', sourceFilter);
    }

    function fetchLogs() {
        const eventType = eventTypeFilter.value;
        const logName = logNameFilter.value;
        const source = sourceFilter.value;
        const search = searchFilter.value;
        const sort = sortOrder.value;
        
        let url = new URL('/api/logs', window.location.origin);
        url.searchParams.append('page', currentPage);
        url.searchParams.append('pageSize', pageSize);
        url.searchParams.append('sortOrder', sort);
        if (eventType) url.searchParams.append('eventType', eventType);
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
                // Перезагружаем фильтры, чтобы показать только релевантные опции
                fetchEventTypes();
                fetchSources();
            })
            .catch(error => console.error('Ошибка при загрузке логов:', error));
    }

    // --- Функции для отрисовки ---

    function getRowClass(log) {
        const eventType = log.eventType?.toLowerCase();
        if (eventType === 'security') return 'table-row-security';
        if (eventType === 'metric') return 'table-row-metric';
        if (eventType === 'service') return 'table-row-warning'; // Service alerts are warnings

        const level = log.levelDisplayName?.toLowerCase();
        if (level?.includes('error') || level?.includes('critical')) return 'table-row-error';
        if (level?.includes('warning')) return 'table-row-warning';
        
        return 'table-row-info';
    }

    function renderTable(logs) {
        const tbody = document.getElementById('logs-table-body');
        tbody.innerHTML = '';

        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center">Записи не найдены</td></tr>';
            return;
        }

        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.className = getRowClass(log);

            tr.innerHTML = `
                <td>${log.id}</td>
                <td>${new Date(log.timeCreated).toLocaleString()}</td>
                <td><span class="badge ${getEventTypeBadge(log.eventType)}">${log.eventType || 'N/A'}</span></td>
                <td><span class="badge ${getLevelBadge(log.levelDisplayName)}">${log.levelDisplayName || 'N/A'}</span></td>
                <td>${log.machineName}</td>
                <td>${log.source || 'N/A'}</td>
                <td>${log.logName || 'N/A'}</td>
                <td class="message-cell">${escapeHtml(log.message)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function getLevelBadge(level) {
        if (!level) return 'bg-secondary';
        const l = level.toLowerCase();
        if (l.includes('error') || l.includes('critical')) return 'bg-danger';
        if (l.includes('warning')) return 'bg-warning text-dark';
        if (l.includes('information')) return 'bg-info text-dark';
        return 'bg-secondary';
    }

    function getEventTypeBadge(eventType) {
        if (!eventType) return 'bg-light text-dark';
        const et = eventType.toLowerCase();
        if (et === 'security') return 'bg-primary';
        if (et === 'metric') return 'bg-success';
        if (et === 'service') return 'bg-warning text-dark';
        if (et === 'windowserror') return 'bg-secondary';
        return 'bg-light text-dark';
    }

    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
    
    function renderPagination(totalPages) {
        const paginationControls = document.getElementById('pagination-controls');
        paginationControls.innerHTML = '';

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
