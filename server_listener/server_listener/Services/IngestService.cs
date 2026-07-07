using System.Text;
using MySqlConnector;

namespace ServerListener.Services;

public class IngestService
{
    private readonly ILogger<IngestService> _logger;
    private readonly IWebHostEnvironment _env;

    public IngestService(ILogger<IngestService> logger, IWebHostEnvironment env)
    {
        _logger = logger;
        _env = env;
    }

    public async Task<IResult> ExecuteInsertAsync(HttpContext context, MySqlConnection dbConnection)
    {
        using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
        var sqlQuery = await reader.ReadToEndAsync();

        if (string.IsNullOrWhiteSpace(sqlQuery) ||
            !sqlQuery.Trim().StartsWith("INSERT INTO", StringComparison.OrdinalIgnoreCase))
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
            _logger.LogError(ex, "Error executing insert query.");
            if (_env.IsDevelopment())
            {
                return Results.Problem(ex.ToString());
            }
            return Results.Problem("An error occurred while processing your request.");
        }
    }
}
