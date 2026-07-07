namespace ServerListener.Models;

public class LogEntry
{
    public int Id { get; set; }
    public string MachineName { get; set; } = string.Empty;
    public string EventType { get; set; } = string.Empty;
    public string? Source { get; set; }
    public string? LevelDisplayName { get; set; }
    public string? LogName { get; set; }
    public int? EventID { get; set; }
    public DateTime TimeCreated { get; set; }
    public string Message { get; set; } = string.Empty;
}
