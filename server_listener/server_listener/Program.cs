using MySql.Data.MySqlClient;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// Добавление сервисов
builder.Services.AddTransient<MySqlConnection>(_ => 
    new MySqlConnection(builder.Configuration.GetConnectionString("DefaultConnection")));

var app = builder.Build();

// Настройка конвейера HTTP-запросов
app.UseDefaultFiles();
app.UseStaticFiles();

// Эндпоинт для приема SQL-запросов (порт 8080)
app.MapPost("/query", async (HttpContext context, MySqlConnection dbConnection) => {
    if (!context.Request.Host.Port.HasValue || context.Request.Host.Port != 8080)
    {
        return Results.StatusCode(403); // Запрет доступа не с того порта
    }

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
        return Results.Problem(ex.Message);
    }
})
.RequireHost("*:8080");


// Эндпоинт API для получения логов (порт 80)
app.MapGet("/api/logs", async (MySqlConnection dbConnection, int page = 1, int pageSize = 20, string? logName = null, string sortOrder = "desc") => {
    
    var sb = new StringBuilder("SELECT Id, EventID, MachineName, Source, LevelDisplayName, LogName, TimeCreated, Message FROM WindowsErrors WHERE 1=1 ");
    if (!string.IsNullOrEmpty(logName))
    {
        sb.Append("AND LogName = @LogName ");
    }
    
    sb.Append($"ORDER BY TimeCreated {(sortOrder.ToLower() == "asc" ? "ASC" : "DESC")} ");

    var logs = new List<object>();
    await dbConnection.OpenAsync();

    var totalCount = 0;
    using (var countCommand = new MySqlCommand("SELECT COUNT(*) FROM WindowsErrors WHERE 1=1 " + (string.IsNullOrEmpty(logName) ? "" : "AND LogName = @LogName"), dbConnection))
    {
        if (!string.IsNullOrEmpty(logName))
        {
            countCommand.Parameters.AddWithValue("@LogName", logName);
        }
        totalCount = Convert.ToInt32(await countCommand.ExecuteScalarAsync());
    }
    
    sb.Append("LIMIT @PageSize OFFSET @Offset"); // Добавляем LIMIT и OFFSET после подсчета общего количества

    var command = new MySqlCommand(sb.ToString(), dbConnection);
    if (!string.IsNullOrEmpty(logName))
    {
        command.Parameters.AddWithValue("@LogName", logName);
    }
    command.Parameters.AddWithValue("@PageSize", pageSize);
    command.Parameters.AddWithValue("@Offset", (page - 1) * pageSize);


    using (var reader = await command.ExecuteReaderAsync())
    {
        while (await reader.ReadAsync())
        {
            logs.Add(new {
                Id = reader.GetInt32("Id"),
                EventID = reader.IsDBNull(reader.GetOrdinal("EventID")) ? (int?)null : reader.GetInt32("EventID"),
                MachineName = reader.GetString("MachineName"),
                Source = reader.GetString("Source"),
                LevelDisplayName = reader.GetString("LevelDisplayName"), // Добавлено LevelDisplayName
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

app.Run();
