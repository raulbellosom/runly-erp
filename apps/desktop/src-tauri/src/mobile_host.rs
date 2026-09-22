//! Mobile-only remote host. Native checks supplement the command ACL, never replace it.
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

// Seeds HostState.origin at startup for internal QA builds (staging/development,
// and pinned production builds) that still compile with a fixed origin. A
// `--universal` production build (see native-host.mjs) omits this entirely,
// so HostState.origin starts empty and the local shell prompts the user.
const COMPILED_ORIGIN: Option<&str> = option_env!("ATLAS_NATIVE_ORIGIN");
const VERSION: &str = match option_env!("ATLAS_NATIVE_VERSION") {
    Some(value) => value,
    None => "1.0.0",
};
const USER_AGENT: &str = "Mozilla/5.0 RunlyNativeHost/1.0";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEvent {
    id: u64,
    kind: String,
    target_id: String,
}

#[derive(Default)]
pub struct HostState {
    events: Mutex<VecDeque<NativeEvent>>,
    next_id: AtomicU64,
    generation: AtomicU64,
    fallback: Mutex<Option<Url>>,
    // The currently trusted server origin, if any. `None` means the local
    // shell must prompt the user to connect before any remote page can load.
    origin: Mutex<Option<String>>,
    // A candidate origin that passed preflight but hasn't been confirmed by
    // the user yet. Lives only in memory — lost if the app is killed before
    // confirmation, by design (see spec's error-handling section).
    pending_origin: Mutex<Option<String>>,
}

pub fn allowed_remote(url: &Url, origin: &str) -> bool {
    url.origin().ascii_serialization() == origin
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with("/app/")
}

// Validates a candidate server origin before it's ever trusted: HTTPS only,
// no credentials/port/path/query/fragment. Returns the normalized origin
// (scheme://host, no trailing slash) on success.
pub fn validate_origin_format(input: &str) -> Result<String, &'static str> {
    let url = Url::parse(input).map_err(|_| "INVALID_ORIGIN")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !(url.path().is_empty() || url.path() == "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("INVALID_ORIGIN");
    }
    Ok(url.origin().ascii_serialization())
}

fn local_shell(url: &Url) -> bool {
    ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (["http", "https"].contains(&url.scheme()) && url.host_str() == Some("tauri.localhost")))
        && ["/", "/index.html"].contains(&url.path())
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}

pub(crate) fn check_remote(window: &WebviewWindow) -> Result<(), String> {
    let state = window.state::<Arc<HostState>>();
    let origin = state
        .origin
        .lock()
        .unwrap()
        .clone()
        .ok_or("NO_ORIGIN_CONFIGURED")?;
    if window.label() == "main"
        && allowed_remote(&window.url().map_err(|_| "URL_UNAVAILABLE")?, &origin)
    {
        Ok(())
    } else {
        Err("UNTRUSTED_CONTEXT".into())
    }
}

pub fn parse_deep_link(url: &Url) -> Option<(String, String)> {
    if url.scheme() != "runly"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let kind = url.host_str()?;
    if !["chat", "call"].contains(&kind) {
        return None;
    }
    let id = url.path().strip_prefix('/')?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return None;
    }
    Some((kind.into(), id.into()))
}

impl HostState {
    fn enqueue(&self, url: &Url) {
        if let Some((kind, target_id)) = parse_deep_link(url) {
            let mut events = self.events.lock().unwrap();
            if events
                .iter()
                .any(|e| e.kind == kind && e.target_id == target_id)
            {
                return;
            }
            if events.len() >= 64 {
                events.pop_front();
            }
            events.push_back(NativeEvent {
                id: self.next_id.fetch_add(1, Ordering::SeqCst) + 1,
                kind,
                target_id,
            });
        }
    }
}

#[tauri::command]
pub fn host_info(window: WebviewWindow) -> Result<serde_json::Value, String> {
    let url = window.url().map_err(|_| "URL_UNAVAILABLE")?;
    let state = window.state::<Arc<HostState>>();
    let origin = state.origin.lock().unwrap().clone();
    let is_allowed_remote = origin
        .as_deref()
        .map(|o| allowed_remote(&url, o))
        .unwrap_or(false);
    if window.label() != "main" || !(local_shell(&url) || is_allowed_remote) {
        return Err("UNTRUSTED_CONTEXT".into());
    }
    let mut capabilities = vec![
        "host-info",
        "haptics",
        "local-notifications",
        "deep-links",
        "external-links",
    ];
    if cfg!(target_os = "android") {
        capabilities.push("notification-actions");
        capabilities.push("screen-share");
    }
    Ok(serde_json::json!({
        "platform": std::env::consts::OS, "nativeHostVersion": VERSION,
        "osVersion": os_info::get().version().to_string(), "bridgeVersion": 1,
        "frontendUrl": origin.map(|o| format!("{o}/app/")),
        "capabilities": capabilities
    }))
}

fn arm_watchdog(window: WebviewWindow, state: Arc<HostState>) {
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        if state
            .generation
            .compare_exchange(
                generation,
                generation + 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
        {
            if let Some(mut fallback) = state.fallback.lock().unwrap().clone() {
                fallback.set_fragment(Some("failed"));
                let _ = window.navigate(fallback);
            }
        }
    });
}

pub fn has_frame_policy(csp: &str) -> bool {
    // CSP uses the first occurrence of a directive, not the most restrictive duplicate.
    let directive = |name: &str| {
        csp.split(';')
            .map(|d| d.split_whitespace().collect::<Vec<_>>())
            .find(|parts| parts.first().copied() == Some(name))
    };
    directive("frame-src") == Some(vec!["frame-src", "'none'"])
        && directive("object-src") == Some(vec!["object-src", "'none'"])
}

async fn preflight(origin: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| "NETWORK_INIT")?;
    let target = format!("{origin}/app/");
    let response = client
        .get(&target)
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|_| "NETWORK_TLS_OR_TIMEOUT")?;
    if !response.status().is_success() {
        return Err(format!("HTTP_{}", response.status().as_u16()));
    }
    let protected = response
        .headers()
        .get_all("content-security-policy")
        .iter()
        .any(|h| h.to_str().map(has_frame_policy).unwrap_or(false));
    if !protected {
        return Err("MISSING_NATIVE_FRAME_POLICY".into());
    }
    Ok(())
}

fn navigate_to_origin(
    window: &WebviewWindow,
    state: &Arc<HostState>,
    origin: &str,
) -> Result<(), String> {
    arm_watchdog(window.clone(), state.clone());
    let target = format!("{origin}/app/");
    window
        .navigate(Url::parse(&target).map_err(|_| "INVALID_FRONTEND")?)
        .map_err(|_| "NAVIGATION_FAILED".into())
}

#[cfg(target_os = "android")]
async fn persist_origin(app: tauri::AppHandle, origin: Option<String>) -> Result<(), String> {
    super::mobile_media::set_origin(app, origin).await
}

#[cfg(not(target_os = "android"))]
async fn persist_origin(_app: tauri::AppHandle, _origin: Option<String>) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
fn load_persisted_origin(app: tauri::AppHandle) -> Option<String> {
    tauri::async_runtime::block_on(super::mobile_media::get_origin(app))
        .ok()
        .flatten()
        .or_else(|| COMPILED_ORIGIN.map(String::from))
}

#[cfg(not(target_os = "android"))]
fn load_persisted_origin(_app: tauri::AppHandle) -> Option<String> {
    COMPILED_ORIGIN.map(String::from)
}

#[tauri::command]
pub async fn host_connect(
    window: WebviewWindow,
    state: State<'_, Arc<HostState>>,
    origin: Option<String>,
) -> Result<serde_json::Value, String> {
    let local = window.url().map_err(|_| "URL_UNAVAILABLE")?;
    if window.label() != "main" || !local_shell(&local) {
        return Err("LOCAL_ONLY".into());
    }
    *state.fallback.lock().unwrap() = Some(local);

    let candidate = match origin {
        Some(value) => validate_origin_format(&value)?,
        None => state
            .origin
            .lock()
            .unwrap()
            .clone()
            .ok_or("NO_ORIGIN_CONFIGURED")?,
    };

    preflight(&candidate).await?;

    let already_trusted = state.origin.lock().unwrap().as_deref() == Some(candidate.as_str());
    if !already_trusted {
        *state.pending_origin.lock().unwrap() = Some(candidate.clone());
        return Ok(serde_json::json!({ "status": "pending_confirmation", "origin": candidate }));
    }

    navigate_to_origin(&window, state.inner(), &candidate)?;
    Ok(serde_json::json!({ "status": "connected" }))
}

#[tauri::command]
pub async fn host_confirm_origin(
    window: WebviewWindow,
    state: State<'_, Arc<HostState>>,
) -> Result<(), String> {
    let local = window.url().map_err(|_| "URL_UNAVAILABLE")?;
    if window.label() != "main" || !local_shell(&local) {
        return Err("LOCAL_ONLY".into());
    }
    let origin = state
        .pending_origin
        .lock()
        .unwrap()
        .take()
        .ok_or("NO_PENDING_ORIGIN")?;
    persist_origin(window.app_handle().clone(), Some(origin.clone())).await?;
    *state.origin.lock().unwrap() = Some(origin.clone());
    navigate_to_origin(&window, state.inner(), &origin)
}

#[tauri::command]
pub async fn host_forget_origin(
    window: WebviewWindow,
    state: State<'_, Arc<HostState>>,
) -> Result<(), String> {
    let local = window.url().map_err(|_| "URL_UNAVAILABLE")?;
    if window.label() != "main" || !local_shell(&local) {
        return Err("LOCAL_ONLY".into());
    }
    persist_origin(window.app_handle().clone(), None).await?;
    *state.origin.lock().unwrap() = None;
    *state.pending_origin.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn host_ready(window: WebviewWindow, state: State<'_, Arc<HostState>>) -> Result<(), String> {
    check_remote(&window)?;
    state.generation.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn host_events(
    window: WebviewWindow,
    state: State<'_, Arc<HostState>>,
) -> Result<Vec<NativeEvent>, String> {
    check_remote(&window)?;
    Ok(state.events.lock().unwrap().iter().cloned().collect())
}

#[tauri::command]
pub fn host_ack_events(
    window: WebviewWindow,
    state: State<'_, Arc<HostState>>,
    ids: Vec<u64>,
) -> Result<(), String> {
    check_remote(&window)?;
    if ids.len() > 64 {
        return Err("TOO_MANY_EVENTS".into());
    }
    state
        .events
        .lock()
        .unwrap()
        .retain(|event| !ids.contains(&event.id));
    Ok(())
}

#[tauri::command]
pub fn host_open_external(window: WebviewWindow, url: String) -> Result<(), String> {
    check_remote(&window)?;
    let parsed = Url::parse(&url).map_err(|_| "INVALID_URL")?;
    if !["http", "https"].contains(&parsed.scheme())
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("INVALID_EXTERNAL_URL".into());
    }
    window
        .opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|_| "OPEN_FAILED".into())
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(HostState::default());
    *state.origin.lock().unwrap() = load_persisted_origin(app.handle().clone());
    app.manage(state.clone());
    let events = state.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            events.enqueue(&url);
        }
    });
    if let Some(urls) = app.deep_link().get_current()? {
        for url in urls {
            state.enqueue(&url);
        }
    }
    let handle = app.handle().clone();
    let metadata = serde_json::json!({ "platform": std::env::consts::OS, "bridgeVersion": 1 });
    let init = format!("Object.defineProperty(window, '__RUNLY_NATIVE_HOST__', {{value: Object.freeze({metadata}), writable:false}});");
    let nav_state = state.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Runly ERP")
        .user_agent(USER_AGENT)
        .initialization_script(init)
        .on_navigation(move |url| {
            let trusted = nav_state.origin.lock().unwrap().clone();
            if local_shell(url)
                || trusted
                    .as_deref()
                    .map(|o| allowed_remote(url, o))
                    .unwrap_or(false)
            {
                return true;
            }
            if ["http", "https"].contains(&url.scheme())
                && url.username().is_empty()
                && url.password().is_none()
            {
                let _ = handle.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .on_page_load(move |window, payload| {
            #[cfg(target_os = "android")]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                super::mobile_media::stop_on_navigation(window.app_handle().clone());
            }
            let trusted = state.origin.lock().unwrap().clone();
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
                && trusted
                    .as_deref()
                    .map(|o| allowed_remote(payload.url(), o))
                    .unwrap_or(false)
            {
                arm_watchdog(window, state.clone());
            }
        })
        .build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_origin_and_app_path() {
        for value in [
            "https://atlas.example.com.evil/app/",
            "http://atlas.example.com/app/",
            "https://atlas.example.com:444/app/",
            "https://user@atlas.example.com/app/",
            "https://atlas.example.com/public/file",
        ] {
            assert!(!allowed_remote(
                &Url::parse(value).unwrap(),
                "https://atlas.example.com"
            ));
        }
        assert!(allowed_remote(
            &Url::parse("https://atlas.example.com/app/login").unwrap(),
            "https://atlas.example.com"
        ));
    }
    #[test]
    fn events_survive_reads_and_deduplicate() {
        let state = HostState::default();
        let url = Url::parse("runly://call/abc-123").unwrap();
        state.enqueue(&url);
        state.enqueue(&url);
        assert_eq!(state.events.lock().unwrap().len(), 1);
        assert!(parse_deep_link(&Url::parse("runly://call/abc?token=secret").unwrap()).is_none());
        assert!(parse_deep_link(&Url::parse("runly://chat/a%2Fb").unwrap()).is_none());
    }
    #[test]
    fn require_real_frame_directive() {
        assert!(!has_frame_policy(
            "frame-src *; frame-src 'none'; object-src 'none'"
        ));
        assert!(has_frame_policy("frame-src 'none'; object-src 'none';"));
        assert!(!has_frame_policy(
            "frame-src 'none' https:; object-src 'none'"
        ));
        assert!(!has_frame_policy(
            "report-uri /frame-src 'none'; object-src 'none'"
        ));
    }

    #[test]
    fn validate_origin_format_accepts_bare_https_origin() {
        assert_eq!(
            validate_origin_format("https://runly.example.com").unwrap(),
            "https://runly.example.com"
        );
        assert_eq!(
            validate_origin_format("https://runly.example.com/").unwrap(),
            "https://runly.example.com"
        );
    }

    #[test]
    fn validate_origin_format_rejects_unsafe_variants() {
        for input in [
            "http://runly.example.com",
            "https://user@runly.example.com",
            "https://runly.example.com:8443",
            "https://runly.example.com/app",
            "https://runly.example.com?x=1",
            "https://runly.example.com#frag",
            "not a url",
        ] {
            assert!(
                validate_origin_format(input).is_err(),
                "expected {input} to be rejected"
            );
        }
    }
}
