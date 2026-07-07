using MySqlConnector;
using ServerListener.Models;

namespace ServerListener.Services;

public class LogService
{
    private readonly MySqlConnection _connection;

    public LogService(MySqlConnection connection)
    {
        _connection = connection;
    }

    public async Task<(List<LogEntry> Logs, int TotalPages)> GetLogsAsync(
        int page, int pageSize, string? eventType, string? logName,
        string? machineName, string? source, string? search,
        string sortOrder, string? level)
    {
        var whereClauses = new List<string>();
        var parameters = new Dictionary<string, object>();

        if (!string.IsNullOrEmpty(eventType))
        {
            whereClauses.Add("EventType = @EventType");
            parameters["@EventType"] = eventType;
        }
        if (!string.IsNullOrEmpty(logName))
        {
            whereClauses.Add("LogName = @LogName");
            parameters["@LogName"] = logName;
        }
        if (!string.IsNullOrEmpty(machineName))
        {
            whereClauses.Add("MachineName = @MachineName");
            parameters["@MachineName"] = machineName;
        }
        if (!string.IsNullOrEmpty(source))
        {
            whereClauses.Add("Source = @Source");
            parameters["@Source"] = source;
        }
        if (!string.IsNullOrEmpty(search))
        {
            whereClauses.Add("Message LIKE @Search");
            parameters["@Search"] = $"%{search}%";
        }
        if (!string.IsNullOrEmpty(level))
        {
            whereClauses.Add("LevelDisplayName LIKE @Level");
            parameters["@Level"] = $"%{level}%";
        }

        var whereSql = whereClauses.Count > 0 ? "WHERE " + string.Join(" AND ", whereClauses) : "";
        var orderBySql = $"ORDER BY TimeCreated {(sortOrder.ToLower() == "asc" ? "ASC" : "DESC")}";

        await _connection.OpenAsync();

        var countSql = $"SELECT COUNT(*) FROM SystemLogs {whereSql}";
        var countCommand = new MySqlCommand(countSql, _connection);
        foreach (var p in parameters)
            countCommand.Parameters.AddWithValue(p.Key, p.Value);
        var totalCount = Convert.ToInt32(await countCommand.ExecuteScalarAsync());

        var selectSql = $"SELECT Id, EventID, MachineName, EventType, Source, LevelDisplayName, LogName, TimeCreated, Message FROM SystemLogs {whereSql} {orderBySql} LIMIT @PageSize OFFSET @Offset";
        var selectCommand = new MySqlCommand(selectSql, _connection);
        foreach (var p in parameters)
            selectCommand.Parameters.AddWithValue(p.Key, p.Value);
        selectCommand.Parameters.AddWithValue("@PageSize", pageSize);
        selectCommand.Parameters.AddWithValue("@Offset", (page - 1) * pageSize);

        var logs = new List<LogEntry>();
        using (var reader = await selectCommand.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                logs.Add(new LogEntry
                {
                    Id = reader.GetInt32("Id"),
                    MachineName = reader.GetString("MachineName"),
                    EventType = reader.GetString("EventType"),
                    Source = reader.IsDBNull(reader.GetOrdinal("Source")) ? null : reader.GetString("Source"),
                    LevelDisplayName = reader.IsDBNull(reader.GetOrdinal("LevelDisplayName")) ? null : reader.GetString("LevelDisplayName"),
                    LogName = reader.IsDBNull(reader.GetOrdinal("LogName")) ? null : reader.GetString("LogName"),
                    EventID = reader.IsDBNull(reader.GetOrdinal("EventID")) ? (int?)null : reader.GetInt32("EventID"),
                    TimeCreated = reader.GetDateTime("TimeCreated"),
                    Message = reader.GetString("Message")
                });
            }
        }

        return (logs, (int)Math.Ceiling(totalCount / (double)pageSize));
    }

    public async Task<LogStats> GetStatsAsync()
    {
        await _connection.OpenAsync();

        var totalCmd = new MySqlCommand("SELECT COUNT(*) FROM SystemLogs", _connection);
        var totalCount = Convert.ToInt32(await totalCmd.ExecuteScalarAsync());

        var errorsCmd = new MySqlCommand("SELECT COUNT(*) FROM SystemLogs WHERE LevelDisplayName LIKE '%Error%' OR LevelDisplayName LIKE '%Critical%' OR LevelDisplayName LIKE '%Ошибка%' OR LevelDisplayName LIKE '%Критическ%' OR LevelDisplayName LIKE '%Fatal%'", _connection);
        var errorsCount = Convert.ToInt32(await errorsCmd.ExecuteScalarAsync());

        var warningsCmd = new MySqlCommand("SELECT COUNT(*) FROM SystemLogs WHERE LevelDisplayName LIKE '%Warn%' OR LevelDisplayName LIKE '%Предупреждени%'", _connection);
        var warningsCount = Convert.ToInt32(await warningsCmd.ExecuteScalarAsync());

        var infoCmd = new MySqlCommand("SELECT COUNT(*) FROM SystemLogs WHERE LevelDisplayName LIKE '%Information%' OR LevelDisplayName LIKE '%Info%' OR LevelDisplayName LIKE '%Информац%' OR (LevelDisplayName IS NULL AND EventType NOT IN ('WindowsError','Service'))", _connection);
        var infoCount = Convert.ToInt32(await infoCmd.ExecuteScalarAsync());

        return new LogStats
        {
            Total = totalCount,
            Errors = errorsCount,
            Warnings = warningsCount,
            Information = infoCount
        };
    }

    public async Task<List<string>> GetSourcesAsync()
    {
        await _connection.OpenAsync();
        var sources = new List<string>();
        var command = new MySqlCommand("SELECT DISTINCT Source FROM SystemLogs WHERE Source IS NOT NULL ORDER BY Source", _connection);
        using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                sources.Add(reader.GetString("Source"));
            }
        }
        return sources;
    }

    public async Task<List<string>> GetEventTypesAsync()
    {
        await _connection.OpenAsync();
        var eventTypes = new List<string>();
        var command = new MySqlCommand("SELECT DISTINCT EventType FROM SystemLogs ORDER BY EventType", _connection);
        using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                eventTypes.Add(reader.GetString("EventType"));
            }
        }
        return eventTypes;
    }
}
