//! Generic HTTP fetch command exposed to spaces and frontend code.
//!
//! Allows arbitrary cross-origin GET/POST without browser CORS restrictions
//! by performing the request in Rust via reqwest.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct HttpFetchArgs {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub body: Option<String>,
    /// Base64-encoded binary body. Mutually exclusive with `body`. Decoded
    /// to raw bytes before being handed to reqwest, so callers can upload
    /// non-UTF-8 payloads (multipart form-data, raw audio/video, etc).
    #[serde(default)]
    pub body_b64: Option<String>,
    /// Response decoding mode. `"text"` (default) returns the body as a
    /// UTF-8 string in `body`. `"bytes"` returns the raw response bytes
    /// base64-encoded in `body_b64`, for binary downloads (audio, etc).
    #[serde(default)]
    pub response_type: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct HttpFetchResponse {
    pub status: u16,
    pub ok: bool,
    pub headers: HashMap<String, String>,
    pub body: String,
    /// Populated when the request was made with `response_type: "bytes"`.
    /// Base64-encoded raw response bytes — use this for binary downloads.
    pub body_b64: Option<String>,
}

/// True if `ip` is a range a space/frontend has no business reaching: the
/// internal network behind the user's machine, the cloud-metadata endpoint,
/// and other non-routable space. Loopback is deliberately NOT blocked —
/// local dev servers (LM Studio :1234, Ollama :11434) are a legitimate,
/// common target, and the loopback services that matter (brain, bridge,
/// LSP) are token-gated independently.
fn is_blocked_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_loopback() {
                return false;
            }
            // 100.64.0.0/10 — carrier-grade NAT.
            let o = v4.octets();
            let cgnat = o[0] == 100 && (o[1] & 0xc0) == 64;
            v4.is_private()
                || v4.is_link_local() // 169.254/16 incl. 169.254.169.254 metadata
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified() // 0.0.0.0
                || v4.is_multicast()
                || cgnat
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() {
                return false;
            }
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(mapped));
            }
            let seg0 = v6.segments()[0];
            v6.is_unspecified()
                || v6.is_multicast()
                || (seg0 & 0xffc0) == 0xfe80 // fe80::/10 link-local
                || (seg0 & 0xfe00) == 0xfc00 // fc00::/7 unique-local
        }
    }
}

/// Validate an http_fetch target against SSRF. Returns the host plus the
/// validated socket addresses to *pin* the connection to. Pinning is what
/// defeats DNS rebinding: we resolve once, check every answer, then force
/// reqwest to dial exactly those addresses so a hostile resolver can't swap
/// in an internal IP between our check and the actual connect.
///
/// For an IP-literal host there's nothing to pin (reqwest dials it directly),
/// so the returned vec is empty after the literal itself is checked.
async fn validate_fetch_target(url: &str) -> Result<(String, Vec<std::net::SocketAddr>), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("invalid url: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("scheme '{}' not allowed", other)),
    }
    let host = parsed
        .host()
        .ok_or_else(|| "url has no host".to_string())?;
    let port = parsed.port_or_known_default().unwrap_or(443);

    match host {
        url::Host::Ipv4(ip) => {
            if is_blocked_ip(std::net::IpAddr::V4(ip)) {
                return Err("refusing to fetch internal/non-routable address (SSRF guard)".into());
            }
            Ok((ip.to_string(), Vec::new()))
        }
        url::Host::Ipv6(ip) => {
            if is_blocked_ip(std::net::IpAddr::V6(ip)) {
                return Err("refusing to fetch internal/non-routable address (SSRF guard)".into());
            }
            Ok((ip.to_string(), Vec::new()))
        }
        url::Host::Domain(domain) => {
            let domain = domain.to_string();
            let addrs: Vec<std::net::SocketAddr> =
                tokio::net::lookup_host((domain.as_str(), port))
                    .await
                    .map_err(|e| format!("dns resolution failed for {}: {}", domain, e))?
                    .collect();
            if addrs.is_empty() {
                return Err(format!("{} did not resolve to any address", domain));
            }
            // Conservative: a single blocked answer fails the whole request,
            // so a domain with mixed public/internal A records can't be used
            // to smuggle a request to the internal one.
            if let Some(bad) = addrs.iter().find(|a| is_blocked_ip(a.ip())) {
                return Err(format!(
                    "{} resolves to internal/non-routable address {} (SSRF guard)",
                    domain,
                    bad.ip()
                ));
            }
            Ok((domain, addrs))
        }
    }
}

#[tauri::command]
pub async fn http_fetch(args: HttpFetchArgs) -> Result<HttpFetchResponse, String> {
    let (pin_host, pin_addrs) = validate_fetch_target(&args.url).await?;
    let method = args.method.as_deref().unwrap_or("GET").to_uppercase();

    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(15_000));

    let mut builder = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        );
    // Pin the resolved addresses so the connect can't rebind to an IP we
    // didn't validate. Only set for hostnames (IP literals dial directly).
    if !pin_addrs.is_empty() {
        builder = builder.resolve_to_addrs(&pin_host, &pin_addrs);
    }
    let client = builder
        .build()
        .map_err(|e| format!("client build: {}", e))?;

    let parsed_method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| format!("bad method: {}", e))?;

    let mut req = client.request(parsed_method, &args.url);

    if let Some(headers) = args.headers {
        for (k, v) in headers {
            req = req.header(k, v);
        }
    }

    if let Some(b64) = args.body_b64 {
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &b64)
            .map_err(|e| format!("invalid body_b64: {}", e))?;
        req = req.body(bytes);
    } else if let Some(body) = args.body {
        req = req.body(body);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;

    let status = res.status().as_u16();
    let ok = res.status().is_success();
    let mut header_map: HashMap<String, String> = HashMap::new();
    for (k, v) in res.headers().iter() {
        if let Ok(s) = v.to_str() {
            header_map.insert(k.to_string(), s.to_string());
        }
    }

    let want_bytes = matches!(args.response_type.as_deref(), Some("bytes"));
    let (body, body_b64) = if want_bytes {
        let bytes = res
            .bytes()
            .await
            .map_err(|e| format!("body read failed: {}", e))?;
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        (String::new(), Some(encoded))
    } else {
        let text = res
            .text()
            .await
            .map_err(|e| format!("body read failed: {}", e))?;
        (text, None)
    };

    Ok(HttpFetchResponse {
        status,
        ok,
        headers: header_map,
        body,
        body_b64,
    })
}

/// Download a URL to a file using reqwest (rustls TLS).
///
/// Used by the space installer instead of shelling out to the OS `curl`: the
/// system curl on older Windows uses the schannel TLS backend, which fails the
/// handshake against our TLS 1.2/1.3 ECDSA endpoints with SEC_E_ILLEGAL_MESSAGE.
/// reqwest carries its own rustls stack, so this works regardless of the OS TLS
/// version, and (being a non-browser client) it isn't subject to CORS either.
#[tauri::command]
pub async fn download_file(url: String, dest: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .user_agent("ConstructDesktop")
        .build()
        .map_err(|e| format!("client build: {}", e))?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("body read failed: {}", e))?;
    std::fs::write(&dest, &bytes).map_err(|e| format!("write failed: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod ssrf_tests {
    use super::is_blocked_ip;
    use std::net::IpAddr;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn loopback_is_allowed() {
        assert!(!is_blocked_ip(ip("127.0.0.1")));
        assert!(!is_blocked_ip(ip("127.0.0.53")));
        assert!(!is_blocked_ip(ip("::1")));
    }

    #[test]
    fn public_is_allowed() {
        assert!(!is_blocked_ip(ip("1.1.1.1")));
        assert!(!is_blocked_ip(ip("140.82.112.3"))); // github
        assert!(!is_blocked_ip(ip("2606:4700:4700::1111")));
    }

    #[test]
    fn private_and_internal_blocked() {
        assert!(is_blocked_ip(ip("10.0.0.5")));
        assert!(is_blocked_ip(ip("192.168.1.1")));
        assert!(is_blocked_ip(ip("172.16.0.1")));
        assert!(is_blocked_ip(ip("169.254.169.254"))); // cloud metadata
        assert!(is_blocked_ip(ip("100.64.0.1"))); // CGNAT
        assert!(is_blocked_ip(ip("0.0.0.0")));
    }

    #[test]
    fn ipv6_internal_blocked() {
        assert!(is_blocked_ip(ip("fe80::1"))); // link-local
        assert!(is_blocked_ip(ip("fc00::1"))); // unique-local
        assert!(is_blocked_ip(ip("fd12:3456::1"))); // unique-local
        assert!(is_blocked_ip(ip("::"))); // unspecified
    }

    #[test]
    fn ipv4_mapped_ipv6_is_unwrapped_and_checked() {
        assert!(is_blocked_ip(ip("::ffff:10.0.0.1")));
        assert!(!is_blocked_ip(ip("::ffff:1.1.1.1")));
    }
}
