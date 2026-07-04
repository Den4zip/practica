using MySqlConnector;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Primitives;

var builder = WebApplication.CreateBuilder(args);

// --- 1. Конфигурация сервисов ---

builder.Services.AddRateLimiter(options =>
{
    var rateLimiterSettings = builder.Configuration.GetSection("RateLimiter");
    var permitLimit = rateLimiterSettings.GetValue<int>("PermitLimit", 100);
    var window = rateLimiterSettings.GetValue<int>("Window", 60);

    options.AddFixedWindowLimiter("ingest", opt =>
    {
        opt.PermitLimit = permitLimit;
        opt.Window = TimeSpan.FromSeconds(window);
        opt.QueueLimit = 0;
    });
});

builder.Services.AddTransient<MySqlConnection>(_ => 
    new MySqlConnection(builder.Configuration.GetConnectionString("DefaultConnection")));

var app = builder.Build();

// --- 2. Настройка конвейера обработки запросов (Middleware) ---

app.UseRateLimiter();

app.Use(async (context, next) =>
{
    if (context.Request.Path == "/query" && context.Request.Host.Port == 8080)
    {
        if (!context.Request.Headers.TryGetValue("X-Api-Key", out StringValues extractedApiKey))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsync("API Key was not provided.");
            return;
        }

        var apiKey = app.Configuration.GetValue<string>("Security:ApiKey");
        if (apiKey != null && !apiKey.Equals(extractedApiKey))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsync("Unauthorized client.");
            return;
        }
    }

    await next(context);
});

app.UseDefaultFiles();
app.UseStaticFiles();

// --- 3. Определение эндпоинтов ---

// Эндпоинт для приема SQL-запросов (порт 8080)
app.MapPost("/query", async (HttpContext context, MySqlConnection dbConnection) => {
    using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
    var sqlQuery = await reader.ReadToEndAsync();

    if (string.IsNullOrWhiteSpace(sqlQuery) || !sqlQuery.Trim().StartsWith("INSERT INTO", StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest("Invalid or non-INSERT query provided.");
    }
    
    try
    {
        await dbConnection.OpenAsync();
        var command = new MySqlCommand(sqlQuery, dbConnection);
        await command.ExecuteNonQueryAsync();
        return Results.Ok();
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Error executing insert query.");
        return Results.Problem("An error occurred while processing your request.");
    }
})
.RequireHost("*:8080")
.RequireRateLimiting("ingest");


// Эндпоинт API для получения логов (порт 80) с расширенной фильтрацией
app.MapGet("/api/logs", async (MySqlConnection dbConnection, int page = 1, int pageSize = 30, 
                                 string? eventType = null, string? logName = null, 
                                 string? machineName = null, string? source = null, 
                                 string? search = null, string sortOrder = "desc") => 
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
    
    var whereSql = whereClauses.Any() ? "WHERE " + string.Join(" AND ", whereClauses) : "";
    var orderBySql = $"ORDER BY TimeCreated {(sortOrder.ToLower() == "asc" ? "ASC" : "DESC")}";

    await dbConnection.OpenAsync();

    var countSql = $"SELECT COUNT(*) FROM SystemLogs {whereSql}";
    var countCommand = new MySqlCommand(countSql, dbConnection);
    foreach (var p in parameters) countCommand.Parameters.AddWithValue(p.Key, p.Value);
    var totalCount = Convert.ToInt32(await countCommand.ExecuteScalarAsync());

    var selectSql = $"SELECT Id, EventID, MachineName, EventType, Source, LevelDisplayName, LogName, TimeCreated, Message FROM SystemLogs {whereSql} {orderBySql} LIMIT @PageSize OFFSET @Offset";
    var selectCommand = new MySqlCommand(selectSql, dbConnection);
    foreach (var p in parameters) selectCommand.Parameters.AddWithValue(p.Key, p.Value);
    selectCommand.Parameters.AddWithValue("@PageSize", pageSize);
    selectCommand.Parameters.AddWithValue("@Offset", (page - 1) * pageSize);

    var logs = new List<object>();
    using (var reader = await selectCommand.ExecuteReaderAsync())
    {
        while (await reader.ReadAsync())
        {
            logs.Add(new {
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
    
    return Results.Ok(new {
        logs,
        totalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
    });
})
.RequireHost("*:80");

// Эндпоинт для получения уникальных источников логов
app.MapGet("/api/logs/sources", async (MySqlConnection dbConnection) => {
    await dbConnection.OpenAsync();
    var sources = new List<string>();
    var command = new MySqlCommand("SELECT DISTINCT Source FROM SystemLogs WHERE Source IS NOT NULL ORDER BY Source", dbConnection);
    using (var reader = await command.ExecuteReaderAsync())
    {
        while (await reader.ReadAsync())
        {
            sources.Add(reader.GetString("Source"));
        }
    }
    return Results.Ok(sources);
})
.RequireHost("*:80");

// Эндпоинт для получения уникальных типов событий
app.MapGet("/api/logs/eventtypes", async (MySqlConnection dbConnection) => {
    await dbConnection.OpenAsync();
    var eventTypes = new List<string>();
    var command = new MySqlCommand("SELECT DISTINCT EventType FROM SystemLogs ORDER BY EventType", dbConnection);
    using (var reader = await command.ExecuteReaderAsync())
    {
        while (await reader.ReadAsync())
        {
            eventTypes.Add(reader.GetString("EventType"));
        }
    }
    return Results.Ok(eventTypes);
})
.RequireHost("*:80");

app.Run();
