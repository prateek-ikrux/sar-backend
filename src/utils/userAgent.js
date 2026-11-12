// A browser's family and system from its user agent: "Chrome on Windows".
// Versions are left out on purpose, so an update isn't a new browser.
const browserOf = (userAgent) => {
    if (!userAgent) return null;
    const browser = /Edg\//.test(userAgent)
        ? "Edge"
        : /OPR\/|Opera/.test(userAgent)
          ? "Opera"
          : /Firefox\//.test(userAgent)
            ? "Firefox"
            : /Chrome\/|CriOS\//.test(userAgent)
              ? "Chrome"
              : /Safari\//.test(userAgent)
                ? "Safari"
                : "Other browser";
    const os = /Windows/.test(userAgent)
        ? "Windows"
        : /iPhone|iPad|iPod/.test(userAgent)
          ? "iOS"
          : /Mac OS X|Macintosh/.test(userAgent)
            ? "macOS"
            : /Android/.test(userAgent)
              ? "Android"
              : /Linux/.test(userAgent)
                ? "Linux"
                : "other system";
    return `${browser} on ${os}`;
};

export { browserOf };
