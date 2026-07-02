document.addEventListener('DOMContentLoaded', function() {
    const logNameFilter = document.getElementById('logNameFilter');
    const sortOrder = document.getElementById('sortOrder');
    
    let currentPage = 1;
    const pageSize = 20;

    function fetchLogs() {
        const logName = logNameFilter.value;
        const sort = sortOrder.value;
        
        let url = `/api/logs?page=${currentPage}&pageSize=${pageSize}&sortOrder=${sort}`;
        if (logName) {
            url += `&logName=${logName}`;
        }

        fetch(url)
            .then(response => response.json())
            .then(data => {
                renderTable(data.logs);
                renderPagination(data.totalPages);
            })
            .catch(error => console.error('Ошибка при загрузке логов:', error));
    }

    function renderTable(logs) {
        const tbody = document.getElementById('logs-table-body');
        tbody.innerHTML = '';
        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">Записи не найдены</td></tr>';
            return;
        }
        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${log.id}</td>
                <td>${new Date(log.timeCreated).toLocaleString()}</td>
                <td>${log.machineName}</td>
                <td>${log.source}</td>
                <td>${log.logName}</td>
                <td class="message-cell">${log.message}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderPagination(totalPages) {
        const paginationControls = document.getElementById('pagination-controls');
        paginationControls.innerHTML = '';

        for (let i = 1; i <= totalPages; i++) {
            const li = document.createElement('li');
            li.className = `page-item ${i === currentPage ? 'active' : ''}`;
            const a = document.createElement('a');
            a.className = 'page-link';
            a.href = '#';
            a.innerText = i;
            a.addEventListener('click', (e) => {
                e.preventDefault();
                currentPage = i;
                fetchLogs();
            });
            li.appendChild(a);
            paginationControls.appendChild(li);
        }
    }

    logNameFilter.addEventListener('change', () => { currentPage = 1; fetchLogs(); });
    sortOrder.addEventListener('change', () => { currentPage = 1; fetchLogs(); });

    fetchLogs();
});
