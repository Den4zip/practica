using MySqlConnector;
using ServerListener.Services;

namespace ServerListener.Endpoints;

public static class IngestEndpoints
{
    public static void MapIngestEndpoints(this WebApplication app)
    {
        app.MapPost("/query", async (HttpContext context, MySqlConnection dbConnection, IngestService ingestService) =>
        {
            return await ingestService.ExecuteInsertAsync(context, dbConnection);
        })
        .RequireHost("*:8080")
        .RequireRateLimiting("ingest");
    }
}
