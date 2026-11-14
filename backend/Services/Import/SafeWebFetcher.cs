using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;

namespace Mise.Api.Services.Import;

/// <summary>Bytes of one fetched URL, after redirects.</summary>
public sealed record FetchedResource(Uri FinalUrl, string? MediaType, string? Charset, byte[] Bytes);

public sealed class FetchRefusedException(string message) : Exception(message);

/// <summary>
/// Fetches a user-supplied URL for import (recipe pages, PDFs). The api runs on the home
/// server, so a URL must never reach the LAN, the docker network or loopback: every
/// connection — redirects included — resolves the host itself and refuses non-public
/// addresses at connect time (no DNS-rebinding window). http(s) on ports 80/443 only.
/// </summary>
public sealed class SafeWebFetcher : IDisposable
{
    public const int MaxBytes = 20 * 1024 * 1024;
    private readonly HttpClient _http;

    public SafeWebFetcher()
    {
        var handler = new SocketsHttpHandler
        {
            UseProxy = false,
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 5,
            AutomaticDecompression = DecompressionMethods.All,
            ConnectTimeout = TimeSpan.FromSeconds(10),
            ConnectCallback = ConnectPublicOnlyAsync,
        };
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
        // Many recipe sites serve bots a stripped page or a 403; a plain browser UA gets the real one.
        _http.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36");
        _http.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8");
        _http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("pl-PL,pl;q=0.9,en;q=0.6");
    }

    /// <summary>Throws <see cref="FetchRefusedException"/> with a Polish message the agent can relay.</summary>
    public static Uri ValidateUrl(string? url)
    {
        if (!Uri.TryCreate(url?.Trim(), UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new FetchRefusedException("Podaj pełny adres strony zaczynający się od http:// lub https://.");
        if (!string.IsNullOrEmpty(uri.UserInfo))
            throw new FetchRefusedException("Adres z loginem/hasłem nie jest obsługiwany.");
        if (!uri.IsDefaultPort)
            throw new FetchRefusedException("Obsługiwane są tylko zwykłe adresy (port 80/443).");
        if (IPAddress.TryParse(uri.IdnHost, out var ip) && !IsPublic(ip))
            throw new FetchRefusedException("Ten adres wskazuje na sieć prywatną — mogę czytać tylko publiczne strony.");
        if (uri.IdnHost.Equals("localhost", StringComparison.OrdinalIgnoreCase) || !uri.IdnHost.Contains('.'))
            throw new FetchRefusedException("Ten adres wskazuje na sieć prywatną — mogę czytać tylko publiczne strony.");
        return uri;
    }

    public async Task<FetchedResource> FetchAsync(string url, CancellationToken ct)
    {
        var uri = ValidateUrl(url);
        HttpResponseMessage res;
        try
        {
            res = await _http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (HttpRequestException e) when (e.InnerException is FetchRefusedException refused)
        {
            throw refused;
        }
        catch (HttpRequestException e)
        {
            throw new FetchRefusedException($"Nie udało się połączyć ze stroną ({e.Message}).");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new FetchRefusedException("Strona nie odpowiedziała w 30 s.");
        }

        using (res)
        {
            if (!res.IsSuccessStatusCode)
                throw new FetchRefusedException($"Strona odpowiedziała błędem {(int)res.StatusCode} {res.ReasonPhrase}"
                    + ((int)res.StatusCode is 401 or 403 ? " — pewnie blokuje automaty albo wymaga logowania." : "."));
            if (res.Content.Headers.ContentLength > MaxBytes)
                throw new FetchRefusedException("Plik jest za duży (limit 20 MB).");

            await using var stream = await res.Content.ReadAsStreamAsync(ct);
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(chunk, ct)) > 0)
            {
                if (buffer.Length + read > MaxBytes)
                    throw new FetchRefusedException("Plik jest za duży (limit 20 MB).");
                buffer.Write(chunk, 0, read);
            }

            MediaTypeHeaderValue? type = res.Content.Headers.ContentType;
            return new FetchedResource(res.RequestMessage?.RequestUri ?? uri, type?.MediaType, type?.CharSet, buffer.ToArray());
        }
    }

    private static async ValueTask<Stream> ConnectPublicOnlyAsync(SocketsHttpConnectionContext context, CancellationToken ct)
    {
        var host = context.DnsEndPoint.Host;
        var addresses = IPAddress.TryParse(host, out var literal)
            ? [literal]
            : await Dns.GetHostAddressesAsync(host, ct);
        // All of them, not just the first: a host that also resolves to a LAN address is refused.
        if (addresses.Length == 0 || addresses.Any(a => !IsPublic(a)))
            throw new FetchRefusedException("Ten adres wskazuje na sieć prywatną — mogę czytać tylko publiczne strony.");

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    /// <summary>Globally routable unicast only: no loopback, private, CGNAT, link-local, ULA, multicast or reserved ranges.</summary>
    public static bool IsPublic(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return !(b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224
                || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)      // CGNAT
                || (b[0] == 169 && b[1] == 254)                    // link-local / cloud metadata
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 192 && b[1] == 0 && b[2] is 0 or 2)     // IETF / TEST-NET-1
                || (b[0] == 198 && b[1] is 18 or 19)               // benchmarking
                || (b[0] == 198 && b[1] == 51 && b[2] == 100)
                || (b[0] == 203 && b[1] == 0 && b[2] == 113));
        }
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.IPv6None) || ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal
                || ip.IsIPv6Multicast || ip.IsIPv6UniqueLocal || ip.IsIPv6Teredo || ip.IsIPv4MappedToIPv6)
                return false;
            var b = ip.GetAddressBytes();
            if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8) return false; // documentation
            if (b[0] == 0x00 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b) return false; // NAT64
            if (b[0] == 0x20 && b[1] == 0x02) return false;                                 // 6to4
            return (b[0] & 0xE0) == 0x20; // 2000::/3 global unicast
        }
        return false;
    }

    public void Dispose() => _http.Dispose();
}
