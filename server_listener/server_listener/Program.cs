using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using MySqlConnector;
using ServerListener.Endpoints;
using ServerListener.Middleware;
using ServerListener.Services;

var builder = WebApplication.CreateBuilder(args);

// --- Services ---

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

builder.Services.AddSingleton<AuthService>();
builder.Services.AddTransient<LogService>();
builder.Services.AddTransient<IngestService>();

var app = builder.Build();

// --- Middleware pipeline ---

app.UseRateLimiter();
app.UseMiddleware<ApiKeyMiddleware>();
app.UseMiddleware<SessionAuthMiddleware>();

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        if (ctx.File.Name.EndsWith(".js", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Context.Response.ContentType = "application/javascript; charset=utf-8";
        }
    }
});

// --- Endpoints ---

app.MapIngestEndpoints();
app.MapLogEndpoints();
app.MapAuthEndpoints();

app.Run();
