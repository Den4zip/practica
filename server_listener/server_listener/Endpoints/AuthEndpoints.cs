using ServerListener.Models;
using ServerListener.Services;

namespace ServerListener.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/api/auth/login", (LoginRequest req, HttpContext context, AuthService authService) =>
        {
            var token = authService.Login(req.Login, req.Password);
            if (token == null)
                return Results.Unauthorized();

            context.Response.Cookies.Append("beacon_session", token, new CookieOptions
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Lax,
                MaxAge = TimeSpan.FromHours(24),
                Path = "/"
            });
            return Results.Ok(new { token });
        })
        .RequireHost("*:80");

        app.MapPost("/api/auth/logout", (HttpContext context, AuthService authService) =>
        {
            if (context.Request.Cookies.TryGetValue("beacon_session", out var token))
            {
                authService.Logout(token);
                context.Response.Cookies.Delete("beacon_session", new CookieOptions { Path = "/" });
            }
            return Results.Ok();
        })
        .RequireHost("*:80");

        app.MapGet("/api/auth/status", (HttpContext context, AuthService authService) =>
        {
            if (context.Request.Cookies.TryGetValue("beacon_session", out var token) &&
                authService.IsValid(token))
            {
                return Results.Ok(new { authenticated = true });
            }
            return Results.Unauthorized();
        })
        .RequireHost("*:80");
    }
}
