using System.Collections.Concurrent;

namespace Mise.Api.Services.AiChat;

public sealed record ChatImageEntry(
    Guid Id,
    int HouseholdId,
    int PersonId,
    string Name,
    byte[] Bytes,
    string MediaType,
    DateTimeOffset CreatedAt);

/// <summary>
/// Ephemeral in-memory store for photos attached to in-app Sous chat messages (receipts, fridge,
/// plates, cookbook pages). Every upload is decoded, resized, EXIF-stripped to JPEG, pinned to
/// (HouseholdId, PersonId), and automatically evicted after <see cref="Ttl"/> or capacity limit.
/// </summary>
public sealed class ChatImageStore
{
    public const long MaxUploadBytes = 5 * 1024 * 1024;
    public const int MaxPerTurn = 3;
    public const int MaxDimension = 1600;
    public const int JpegQuality = 82;
    public const int MaxStoredImages = 40;
    public static readonly TimeSpan Ttl = TimeSpan.FromMinutes(30);

    private readonly ConcurrentDictionary<Guid, ChatImageEntry> _items = new();
    private readonly SemaphoreSlim _encodeGate = new(2, 2);

    public async Task<ChatImageEntry> StoreAsync(int householdId, int personId, string? fileName,
        byte[] rawBytes, CancellationToken ct = default)
    {
        if (rawBytes.Length is 0 or > (int)MaxUploadBytes)
            throw new InvalidImageException("Zdjęcie musi mieć od 1 B do 5 MB.");

        byte[] jpeg;
        await _encodeGate.WaitAsync(ct);
        try
        {
            var ok = await Task.Run(() => ImageResizer.TryEncodeJpeg(rawBytes, MaxDimension, JpegQuality, out var encoded)
                ? encoded : null, ct);
            if (ok is null)
                throw new InvalidImageException("Nie udało się odczytać zdjęcia — wgraj poprawny plik JPG, PNG lub WebP.");
            jpeg = ok;
        }
        finally
        {
            _encodeGate.Release();
        }

        Prune();
        var cleanName = SanitizeName(fileName);
        var entry = new ChatImageEntry(Guid.NewGuid(), householdId, personId, cleanName, jpeg, "image/jpeg", DateTimeOffset.UtcNow);
        _items[entry.Id] = entry;
        return entry;
    }

    public ChatImageEntry? TryGet(Guid id, int householdId, int personId)
    {
        if (!_items.TryGetValue(id, out var entry)) return null;
        if (DateTimeOffset.UtcNow - entry.CreatedAt > Ttl)
        {
            _items.TryRemove(id, out _);
            return null;
        }
        return entry.HouseholdId == householdId && entry.PersonId == personId ? entry : null;
    }

    private void Prune()
    {
        var cutoff = DateTimeOffset.UtcNow - Ttl;
        foreach (var kv in _items)
        {
            if (kv.Value.CreatedAt < cutoff)
                _items.TryRemove(kv.Key, out _);
        }
        while (_items.Count >= MaxStoredImages)
        {
            var oldest = _items.Values.OrderBy(v => v.CreatedAt).FirstOrDefault();
            if (oldest is null || !_items.TryRemove(oldest.Id, out _)) break;
        }
    }

    private static string SanitizeName(string? fileName)
    {
        var baseName = Path.GetFileName((fileName ?? "").Trim());
        if (string.IsNullOrWhiteSpace(baseName)) return "zdjecie.jpg";
        return baseName.Length <= 120 ? baseName : baseName[..120];
    }
}
