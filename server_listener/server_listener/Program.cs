using MySqlConnector;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Primitives;

var builder = WebApplication.CreateBuilder(args);

// --- 1. Конфигурация сервисов ---

// Добавление поддержки Rate Limiting
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

// Регистрация MySqlConnection из MySqlConnector
builder.Services.AddTransient<MySqlConnection>(_ => 
    new MySqlConnection(builder.Configuration.GetConnectionString("DefaultConnection")));

var app = builder.Build();

// --- 2. Настройка конвейера обработки запросов (Middleware) ---

// Включение Rate Limiter
app.UseRateLimiter();

// Middleware для авторизации по API-ключу
app.Use(async (context, next) =>
{
    // Применяем только для эндпоинта /query на порту 8080
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
// Защищен middleware для API-ключа и встроенным Rate Limiter'ом
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
app.MapGet("/api/logs", async (MySqlConnection dbConnection, int page = 1, int pageSize = 20, 
                                 string? logName = null, string? machineName = null, 
                                 string? source = null, string? search = null, 
                                 string sortOrder = "desc") => 
{
    var whereClauses = new List<string>();
    var parameters = new Dictionary<string, object>();

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

    // Подсчет общего количества записей с учетом фильтров
    var countSql = $"SELECT COUNT(*) FROM WindowsErrors {whereSql}";
    var countCommand = new MySqlCommand(countSql, dbConnection);
    foreach (var p in parameters) countCommand.Parameters.AddWithValue(p.Key, p.Value);
    var totalCount = Convert.ToInt32(await countCommand.ExecuteScalarAsync());

    // Получение порции логов для текущей страницы
    var selectSql = $"SELECT Id, EventID, MachineName, Source, LevelDisplayName, LogName, TimeCreated, Message FROM WindowsErrors {whereSql} {orderBySql} LIMIT @PageSize OFFSET @Offset";
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
                EventID = reader.IsDBNull(reader.GetOrdinal("EventID")) ? (int?)null : reader.GetInt32("EventID"),
                MachineName = reader.GetString("MachineName"),
                Source = reader.GetString("Source"),
                LevelDisplayName = reader.GetString("LevelDisplayName"),
                LogName = reader.GetString("LogName"),
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
    var command = new MySqlCommand("SELECT DISTINCT Source FROM WindowsErrors ORDER BY Source", dbConnection);
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

app.Run();
