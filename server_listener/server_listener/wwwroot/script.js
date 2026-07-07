document.addEventListener('DOMContentLoaded', function () {

    const $ = (id) => document.getElementById(id);
    const eventTypeFilter = $('eventTypeFilter');
    const sourceFilter = $('sourceFilter');
    const logNameFilter = $('logNameFilter');
    const levelFilter = $('levelFilter');
    const searchFilter = $('searchFilter');
    const sortOrder = $('sortOrder');
    const applyFilters = $('applyFilters');
    const refreshBtn = $('refreshBtn');
    const autoUpdate = $('autoUpdate');
    const exportCsvBtn = $('exportCsvBtn');
    const clearBtn = $('clearBtn');
    const logoutBtn = $('logoutBtn');
    const logsBody = $('logs-table-body');
    const paginationControls = $('pagination-controls');
    const pageSizeSelect = $('pageSizeSelect');
    const loginOverlay = $('loginOverlay');
    const loginForm = $('loginForm');
    const loginError = $('loginError');
    const loginUsername = $('loginUsername');
    const loginPassword = $('loginPassword');
    const dashboardContent = $('dashboardContent');

    const statTotal = $('stat-total');
    const statErrors = $('stat-errors');
    const statWarnings = $('stat-warnings');
    const statInformation = $('stat-information');
    const statErrorsCount = $('stat-errors-count');
    const statWarningsCount = $('stat-warnings-count');
    const statInformationCount = $('stat-information-count');

    const detailOverlay = $('detailOverlay');
    const detailClose = $('detailClose');
    const detailCloseBtn = $('detailCloseBtn');

    let currentPage = 1;
    let pageSize = 10;
    let autoUpdateInterval = null;

    checkAuth();

    detailClose.addEventListener('click', closeDetail);
    detailCloseBtn.addEventListener('click', closeDetail);
    detailOverlay.addEventListener('click', (e) => {
        if (e.target === detailOverlay) closeDetail();
    });

    function closeDetail() {
        detailOverlay.classList.add('hidden');
    }

    applyFilters.addEventListener('click', () => {
        currentPage = 1;
        fetchLogs();
    });

    refreshBtn.addEventListener('click', () => {
        fetchStats();
        fetchLogs();
    });

    searchFilter.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            currentPage = 1;
            fetchLogs();
        }
    });

    pageSizeSelect.addEventListener('change', function () {
        pageSize = parseInt(this.value, 10);
        currentPage = 1;
        fetchLogs();
    });

    autoUpdate.addEventListener('change', function () {
        if (this.checked) {
            autoUpdateInterval = setInterval(() => {
                fetchStats();
                fetchLogs(true);
            }, 15000);
        } else {
            clearInterval(autoUpdateInterval);
            autoUpdateInterval = null;
        }
    });

    clearBtn.addEventListener('click', function () {
        logsBody.innerHTML = `
            <tr>
                <td colspan="8" class="px-3 py-16 text-center">
                    <p class="text-gray-400 text-sm">Нет записей</p>
                </td>
            </tr>`;
        statTotal.textContent = '0';
        statErrors.textContent = '0';
        statWarnings.textContent = '0';
        statInformation.textContent = '0';
        paginationControls.innerHTML = '';
    });

    exportCsvBtn.addEventListener('click', exportToCsv);

    logoutBtn.addEventListener('click', logout);

    loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        loginError.classList.add('hidden');
        const username = loginUsername.value.trim();
        const password = loginPassword.value;
        if (!username || !password) return;
        fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: username, password: password })
        })
            .then(r => {
                if (r.ok) return r.json();
                if (r.status === 401) throw new Error('Неверный логин или пароль');
                throw new Error('Ошибка сервера');
            })
            .then(() => {
                loginOverlay.classList.add('hidden');
                loginPassword.value = '';
                initDashboard();
            })
            .catch(err => {
                loginError.textContent = err.message;
                loginError.classList.remove('hidden');
            });
    });

    function initDashboard() {
        dashboardContent.classList.remove('hidden');
        loginOverlay.classList.add('hidden');
        fetchStats();
        fetchEventTypes();
        fetchSources();
        fetchLogs();
    }

    function checkAuth() {
        fetch('/api/auth/status')
            .then(r => {
                if (r.ok) {
                    loginOverlay.classList.add('hidden');
                    dashboardContent.classList.remove('hidden');
                    initDashboard();
                } else {
                    dashboardContent.classList.add('hidden');
                    loginOverlay.classList.remove('hidden');
                }
            })
            .catch(() => {
                dashboardContent.classList.add('hidden');
                loginOverlay.classList.remove('hidden');
            });
    }

    function logout() {
        fetch('/api/auth/logout', { method: 'POST' })
            .then(() => {
                dashboardContent.classList.add('hidden');
                loginOverlay.classList.remove('hidden');
                loginUsername.value = '';
                loginPassword.value = '';
                if (autoUpdateInterval) {
                    clearInterval(autoUpdateInterval);
                    autoUpdateInterval = null;
                    autoUpdate.checked = false;
                }
            })
            .catch(() => {});
    }

    function fetchStats() {
        fetch('/api/logs/stats')
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(data => {
                const total = data.total ?? 0;
                const errors = data.errors ?? 0;
                const warnings = data.warnings ?? 0;
                const info = data.information ?? 0;
                statTotal.textContent = total;
                statErrors.textContent = errors;
                statWarnings.textContent = warnings;
                statInformation.textContent = info;
                statErrorsCount.textContent = errors;
                statWarningsCount.textContent = warnings;
                statInformationCount.textContent = info;
            })
            .catch(() => {});
    }

    function fetchDynamicOptions(url, filterEl) {
        fetch(url)
            .then(r => r.ok ? r.json() : [])
            .then(options => {
                const val = filterEl.value;
                while (filterEl.options.length > 1) filterEl.remove(1);
                options.forEach(opt => {
                    const o = document.createElement('option');
                    o.value = opt;
                    o.textContent = opt;
                    filterEl.appendChild(o);
                });
                filterEl.value = val;
            })
            .catch(() => {});
    }

    function fetchEventTypes() {
        fetchDynamicOptions('/api/logs/eventtypes', eventTypeFilter);
    }

    function fetchSources() {
        fetchDynamicOptions('/api/logs/sources', sourceFilter);
    }

    function fetchLogs(silent) {
        const params = new URLSearchParams();
        params.set('page', currentPage);
        params.set('pageSize', pageSize);
        params.set('sortOrder', sortOrder.value);
        if (eventTypeFilter.value) params.set('eventType', eventTypeFilter.value);
        if (logNameFilter.value) params.set('logName', logNameFilter.value);
        if (levelFilter.value) params.set('level', levelFilter.value);
        if (sourceFilter.value) params.set('source', sourceFilter.value);
        if (searchFilter.value) params.set('search', searchFilter.value);

        fetch('/api/logs?' + params.toString())
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(data => {
                renderTable(data.logs || []);
                renderPagination(data.totalPages || 1);
                if (!silent) {
                    fetchEventTypes();
                    fetchSources();
                }
            })
            .catch(err => {
                if (!silent) console.error('fetchLogs error:', err);
            });
    }

    function renderTable(logs) {
        if (!logs || logs.length === 0) {
            logsBody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-3 py-16 text-center">
                        <p class="text-gray-400 text-sm">Нет ошибок</p>
                    </td>
                </tr>`;
            return;
        }

        logsBody.innerHTML = logs.map(log => {
            const rowClass = getRowClass(log);
            const levelBadge = getLevelBadge(log.levelDisplayName);
            const eventBadge = getEventTypeBadge(log.eventType);
            const time = new Date(log.timeCreated).toLocaleString('ru-RU');
            const msg = escapeHtml(log.message || '');
            return `
                <tr class="${rowClass} cursor-pointer detail-row" data-log='${escapeAttr(JSON.stringify({
                    id: log.id,
                    timeCreated: log.timeCreated,
                    eventType: log.eventType,
                    levelDisplayName: log.levelDisplayName,
                    machineName: log.machineName,
                    source: log.source,
                    logName: log.logName,
                    message: log.message
                }))}'>
                    <td class="font-medium text-gray-700">${log.id}</td>
                    <td class="whitespace-nowrap text-gray-600">${time}</td>
                    <td><span class="badge-event ${eventBadge}">${log.eventType || 'N/A'}</span></td>
                    <td><span class="badge-level ${levelBadge}">${log.levelDisplayName || 'N/A'}</span></td>
                    <td class="text-gray-700">${escapeHtml(log.machineName)}</td>
                    <td class="text-gray-600">${escapeHtml(log.source || 'N/A')}</td>
                    <td class="text-gray-600">${escapeHtml(log.logName || 'N/A')}</td>
                    <td class="message-cell text-gray-700">${msg}</td>
                </tr>`;
        }).join('');

        logsBody.querySelectorAll('.detail-row').forEach(row => {
            row.addEventListener('click', () => {
                try {
                    const log = JSON.parse(row.dataset.log);
                    openDetail(log);
                } catch(e) {}
            });
        });
    }

    function escapeAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function openDetail(log) {
        $('detail-id').textContent = '#' + log.id;
        $('detail-time').textContent = new Date(log.timeCreated).toLocaleString('ru-RU');
        $('detail-computer').textContent = log.machineName || '—';
        $('detail-type').textContent = log.eventType || '—';
        $('detail-level').textContent = log.levelDisplayName || '—';
        $('detail-source').textContent = log.source || '—';
        $('detail-logname').textContent = log.logName || '—';
        $('detail-message').textContent = log.message || '—';
        detailOverlay.classList.remove('hidden');
    }

    function getRowClass(log) {
        const et = (log.eventType || '').toLowerCase();
        if (et === 'security') return 'table-row-security';
        if (et === 'metric') return 'table-row-metric';
        const lv = (log.levelDisplayName || '').toLowerCase();
        if (lv.includes('error') || lv.includes('critical') || lv.includes('ошибк') || lv.includes('критическ')) return 'table-row-error';
        if (lv.includes('warning') || lv.includes('предупрежден')) return 'table-row-warning';
        return 'table-row-info';
    }

    function getLevelBadge(level) {
        if (!level) return 'badge-level-default';
        const l = level.toLowerCase();
        if (l.includes('critical') || l.includes('критическ')) return 'badge-level-critical';
        if (l.includes('error') || l.includes('ошибк')) return 'badge-level-error';
        if (l.includes('warning') || l.includes('предупрежден')) return 'badge-level-warning';
        if (l.includes('information') || l.includes('информац')) return 'badge-level-info';
        return 'badge-level-default';
    }

    function getEventTypeBadge(eventType) {
        if (!eventType) return 'badge-event-default';
        const et = eventType.toLowerCase();
        if (et === 'windowserror') return 'badge-event-error';
        if (et === 'security') return 'badge-event-security';
        if (et === 'metric') return 'badge-event-metric';
        if (et === 'service') return 'badge-event-service';
        return 'badge-event-default';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function renderPagination(totalPages) {
        paginationControls.innerHTML = '';

        const prevBtn = createPageBtn('←', currentPage > 1, () => {
            if (currentPage > 1) { currentPage--; fetchLogs(); }
        });
        paginationControls.appendChild(prevBtn);

        let start = Math.max(1, currentPage - 2);
        let end = Math.min(totalPages, currentPage + 2);

        if (start > 1) {
            paginationControls.appendChild(createPageBtn('1', true, () => { currentPage = 1; fetchLogs(); }));
            if (start > 2) paginationControls.appendChild(createEllipsis());
        }

        for (let i = start; i <= end; i++) {
            paginationControls.appendChild(createPageBtn(i, true, () => {
                currentPage = i;
                fetchLogs();
            }, i === currentPage));
        }

        if (end < totalPages) {
            if (end < totalPages - 1) paginationControls.appendChild(createEllipsis());
            paginationControls.appendChild(createPageBtn(totalPages, true, () => {
                currentPage = totalPages;
                fetchLogs();
            }));
        }

        const nextBtn = createPageBtn('→', currentPage < totalPages, () => {
            if (currentPage < totalPages) { currentPage++; fetchLogs(); }
        });
        paginationControls.appendChild(nextBtn);
    }

    function createPageBtn(label, enabled, onClick, isActive) {
        const btn = document.createElement('button');
        btn.className = 'pagination-btn';
        if (isActive) btn.classList.add('active');
        if (!enabled) btn.classList.add('disabled');
        btn.textContent = label;
        if (enabled) btn.addEventListener('click', onClick);
        return btn;
    }

    function createEllipsis() {
        const span = document.createElement('span');
        span.className = 'px-1 text-gray-400 select-none';
        span.textContent = '…';
        return span;
    }

    function exportToCsv() {
        const params = new URLSearchParams();
        params.set('page', 1);
        params.set('pageSize', 100000);
        params.set('sortOrder', sortOrder.value);
        if (eventTypeFilter.value) params.set('eventType', eventTypeFilter.value);
        if (logNameFilter.value) params.set('logName', logNameFilter.value);
        if (levelFilter.value) params.set('level', levelFilter.value);
        if (sourceFilter.value) params.set('source', sourceFilter.value);
        if (searchFilter.value) params.set('search', searchFilter.value);

        fetch('/api/logs?' + params.toString())
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(data => {
                const logs = data.logs || [];
                if (!logs.length) return;

                const headers = ['ID', 'Время', 'Тип события', 'Уровень', 'Компьютер', 'Источник', 'Журнал', 'Сообщение'];
                const rows = logs.map(log => [
                    log.id,
                    new Date(log.timeCreated).toISOString(),
                    log.eventType || '',
                    log.levelDisplayName || '',
                    log.machineName,
                    log.source || '',
                    log.logName || '',
                    (log.message || '').replace(/"/g, '""')
                ].map(v => `"${v}"`).join(','));

                const bom = '\uFEFF';
                const csv = bom + headers.join(',') + '\n' + rows.join('\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'beacon_logs_' + new Date().toISOString().slice(0, 19).replace(/[:-]/g, '') + '.csv';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            })
            .catch(() => {});
    }

});
