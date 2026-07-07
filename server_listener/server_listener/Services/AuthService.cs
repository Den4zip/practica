using System.Collections.Concurrent;

namespace ServerListener.Services;

public class AuthService
{
    private readonly ConcurrentDictionary<string, DateTime> _sessions = new();
    private readonly string _validLogin;
    private readonly string _validPassword;

    public AuthService(IConfiguration configuration)
    {
        var sec = configuration.GetSection("Security");
        _validLogin = sec["Login"] ?? "admin";
        _validPassword = sec["Password"] ?? "admin123";
    }

    public string? Login(string login, string password)
    {
        if (login != _validLogin || password != _validPassword)
            return null;

        var token = Guid.NewGuid().ToString("N");
        _sessions[token] = DateTime.UtcNow.AddHours(24);
        return token;
    }

    public void Logout(string token)
    {
        _sessions.TryRemove(token, out _);
    }

    public bool IsValid(string token)
    {
        return _sessions.TryGetValue(token, out var expires) && expires >= DateTime.UtcNow;
    }
}
