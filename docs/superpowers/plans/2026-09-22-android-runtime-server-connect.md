# Android Runtime Server Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single, universally-distributable Android APK connect to any self-hosted Runly server chosen by the user at runtime (matching what the Windows desktop build already does), instead of the server origin being fixed at compile time.

**Architecture:** Move the trusted server origin from a Rust compile-time constant (`const ORIGIN`, baked in via `option_env!`) into `HostState`, a piece of Tauri-managed runtime state already used for other native-host bookkeeping. The existing `host_connect` preflight (HTTPS + CSP validation, already built) is reused for a user-supplied candidate origin instead of only the compiled one. A new explicit-confirmation step (`host_confirm_origin`) gates persisting/trusting a new origin, and `host_forget_origin` lets the user switch servers. Internal QA builds (`staging`/`development`) keep working exactly as today by seeding `HostState.origin` from the same compile-time constant as a *default*, not a hard requirement — only `production` builds can now omit it entirely (`--universal` flag), which is what makes the public APK possible.

**Tech Stack:** Rust/Tauri 2 (mobile_host.rs, mobile_media.rs), Kotlin (Android plugin), plain JS/HTML (native host local shell), Node.js (build wrapper script).

**Spec:** `docs/superpowers/specs/2026-09-22-android-runtime-server-connect-design.md`

**Design refinement made during planning (not a spec change, an implementation detail):** the spec described `check_remote` gaining a `state` parameter threaded through every command that calls it. Tracing the actual call sites found `check_remote(&window)` is called from **9 different commands across two files** (`mobile_host.rs` and `mobile_media.rs`). Threading a new parameter through all of them is unnecessary churn — `WebviewWindow` already implements Tauri's `Manager` trait, so `check_remote` can fetch `HostState` itself via `window.state::<Arc<HostState>>()` internally, keeping its own signature (`fn check_remote(window: &WebviewWindow) -> Result<(), String>`) and every caller completely unchanged. Same trick applies to `host_info`. This achieves everything the spec asks for with a much smaller, lower-risk diff.

---

### Task 1: `mobile_host.rs` — origin becomes runtime state

**Files:**
- Modify: `apps/desktop/src-tauri/src/mobile_host.rs`

- [ ] **Step 1: Write the failing tests first**

Add to the `#[cfg(test)] mod tests { ... }` block at the end of the file (after the existing `require_real_frame_directive` test):

```rust
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
```

- [ ] **Step 2: Run to verify these fail**

Run: `cd apps/desktop/src-tauri && cargo test validate_origin_format`
Expected: FAIL — `validate_origin_format` doesn't exist yet (compile error).

- [ ] **Step 3: Remove the compile-time-only `ORIGIN` constant, keep a compile-time default**

Replace (near the top of the file):

```rust
const ORIGIN: &str = match option_env!("ATLAS_NATIVE_ORIGIN") {
    Some(value) => value,
    None => "https://app.example.invalid",
};
const VERSION: &str = match option_env!("ATLAS_NATIVE_VERSION") {
    Some(value) => value,
    None => "1.0.0",
};
```

with:

```rust
// Seeds HostState.origin at startup for internal QA builds (staging/development,
// and pinned production builds) that still compile with a fixed origin. A
// `--universal` production build (see native-host.mjs) omits this entirely,
// so HostState.origin starts empty and the local shell prompts the user.
const COMPILED_ORIGIN: Option<&str> = option_env!("ATLAS_NATIVE_ORIGIN");
const VERSION: &str = match option_env!("ATLAS_NATIVE_VERSION") {
    Some(value) => value,
    None => "1.0.0",
};
```

- [ ] **Step 4: Add origin fields to `HostState`**

Replace:

```rust
#[derive(Default)]
pub struct HostState {
    events: Mutex<VecDeque<NativeEvent>>,
    next_id: AtomicU64,
    generation: AtomicU64,
    fallback: Mutex<Option<Url>>,
}
```

with:

```rust
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
```

- [ ] **Step 5: Add `validate_origin_format`**

Add this function right after `allowed_remote` (before `fn local_shell`):

```rust
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test validate_origin_format`
Expected: PASS, both new tests.

- [ ] **Step 7: Update `check_remote` to read the runtime origin**

Replace:

```rust
pub(crate) fn check_remote(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main"
        && allowed_remote(&window.url().map_err(|_| "URL_UNAVAILABLE")?, ORIGIN)
    {
        Ok(())
    } else {
        Err("UNTRUSTED_CONTEXT".into())
    }
}
```

with:

```rust
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
```

This does **not** change `check_remote`'s signature — every existing caller (`host_ready`, `host_events`, `host_ack_events`, `host_open_external` in this file, and `host_notification_show`/`host_screen_start`/`host_screen_stop`/`host_screen_status`/`host_fcm_token` in `mobile_media.rs`) keeps calling `check_remote(&window)?` exactly as before. `Manager` (needed for `.state::<T>()`) is already imported at the top of this file.

- [ ] **Step 8: Update `host_info` to read the runtime origin**

Replace:

```rust
#[tauri::command]
pub fn host_info(window: WebviewWindow) -> Result<serde_json::Value, String> {
    let url = window.url().map_err(|_| "URL_UNAVAILABLE")?;
    if window.label() != "main" || !(local_shell(&url) || allowed_remote(&url, ORIGIN)) {
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
        "frontendUrl": format!("{ORIGIN}/app/"),
        "capabilities": capabilities
    }))
}
```

with:

```rust
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
```

`frontendUrl` is now `null` in the JSON response when no origin is trusted yet — the shell's diagnostics display already handles a missing value gracefully once Task 6 updates it.

- [ ] **Step 9: Add the preflight and navigation helpers**

Add these right after `has_frame_policy` (before `#[tauri::command] pub async fn host_connect`):

```rust
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
```

`persist_origin`/`load_persisted_origin` reference `super::mobile_media::{set_origin, get_origin}`, which don't exist until Task 4 — this compiles fine on this host (Windows desktop) regardless, because the `#[cfg(target_os = "android")]` variants are stripped entirely before name resolution on a non-Android target; only the `#[cfg(not(target_os = "android"))]` variants (which don't reference `mobile_media` at all) are actually compiled by `cargo check`/`cargo test` here. Don't be alarmed that `mobile_media::set_origin`/`get_origin` "don't exist yet" — this task's own verification (Step 12) doesn't need them to.

- [ ] **Step 10: Rewrite `host_connect`, add `host_confirm_origin` and `host_forget_origin`**

Replace the entire existing `host_connect` function:

```rust
#[tauri::command]
pub async fn host_connect(
    window: WebviewWindow,
    state: State<'_, Arc<HostState>>,
) -> Result<(), String> {
    let local = window.url().map_err(|_| "URL_UNAVAILABLE")?;
    if window.label() != "main" || !local_shell(&local) {
        return Err("LOCAL_ONLY".into());
    }
    *state.fallback.lock().unwrap() = Some(local);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| "NETWORK_INIT")?;
    let target = format!("{ORIGIN}/app/");
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
    arm_watchdog(window.clone(), state.inner().clone());
    window
        .navigate(Url::parse(&target).map_err(|_| "INVALID_FRONTEND")?)
        .map_err(|_| "NAVIGATION_FAILED".into())
}
```

with:

```rust
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
```

`host_ready`, `host_events`, `host_ack_events`, `host_open_external` are unchanged — leave them exactly as they are in the file today.

- [ ] **Step 11: Update `setup()` to seed and dynamically read the origin**

Replace:

```rust
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(HostState::default());
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
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Runly ERP")
        .user_agent(USER_AGENT)
        .initialization_script(init)
        .on_navigation(move |url| {
            if local_shell(url) || allowed_remote(url, ORIGIN) {
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
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
                && allowed_remote(payload.url(), ORIGIN)
            {
                arm_watchdog(window, state.clone());
            }
        })
        .build()?;
    Ok(())
}
```

with:

```rust
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
```

- [ ] **Step 12: Run the full test suite and a syntax/compile check**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all tests pass (the 3 pre-existing tests, unaffected since `allowed_remote`'s own signature never changed, plus the 2 new ones from Step 1).

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: compiles clean (this exercises the `#[cfg(not(target_os = "android"))]` branches of `persist_origin`/`load_persisted_origin` on this Windows host; the Android branches are verified in Task 4/8).

- [ ] **Step 13: Commit**

```bash
git add apps/desktop/src-tauri/src/mobile_host.rs
git commit -m "feat: make the native host's trusted server origin runtime state"
```

---

### Task 2: Register `host_confirm_origin`/`host_forget_origin` across the command manifest

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/build.rs`
- Modify: `apps/desktop/src-tauri/permissions/native-host.toml`
- Modify: `apps/desktop/scripts/native-host.mjs`

- [ ] **Step 1: Register in `lib.rs`'s invoke handler**

In `apps/desktop/src-tauri/src/lib.rs`, the `generate_handler!` list currently reads (after the earlier FCM work added `host_fcm_token`):

```rust
        .invoke_handler(tauri::generate_handler![
            mobile_host::host_info,
            mobile_host::host_connect,
            mobile_host::host_ready,
            mobile_host::host_events,
            mobile_host::host_ack_events,
            mobile_host::host_open_external,
            #[cfg(target_os = "android")]
            mobile_media::host_notification_show,
            #[cfg(target_os = "android")]
            mobile_media::host_screen_start,
            #[cfg(target_os = "android")]
            mobile_media::host_screen_stop,
            #[cfg(target_os = "android")]
            mobile_media::host_screen_status,
            #[cfg(target_os = "android")]
            mobile_media::host_fcm_token
        ])
```

Change it to:

```rust
        .invoke_handler(tauri::generate_handler![
            mobile_host::host_info,
            mobile_host::host_connect,
            mobile_host::host_confirm_origin,
            mobile_host::host_forget_origin,
            mobile_host::host_ready,
            mobile_host::host_events,
            mobile_host::host_ack_events,
            mobile_host::host_open_external,
            #[cfg(target_os = "android")]
            mobile_media::host_notification_show,
            #[cfg(target_os = "android")]
            mobile_media::host_screen_start,
            #[cfg(target_os = "android")]
            mobile_media::host_screen_stop,
            #[cfg(target_os = "android")]
            mobile_media::host_screen_status,
            #[cfg(target_os = "android")]
            mobile_media::host_fcm_token
        ])
```

(`host_confirm_origin`/`host_forget_origin` are not `#[cfg(target_os = "android")]`-gated — `mobile_host.rs` compiles for `any(mobile, test)`, i.e. Android and iOS both, matching `host_connect`'s own lack of a cfg gate.)

- [ ] **Step 2: Register in `build.rs`'s `AppManifest`**

In `apps/desktop/src-tauri/build.rs`, the commands list currently reads (after the earlier FCM fix):

```rust
        tauri_build::AppManifest::new().commands(&[
            "host_info",
            "host_connect",
            "host_ready",
            "host_events",
            "host_ack_events",
            "host_open_external",
            "host_screen_start",
            "host_notification_show",
            "host_screen_stop",
            "host_screen_status",
            "host_fcm_token",
        ]),
```

Change it to:

```rust
        tauri_build::AppManifest::new().commands(&[
            "host_info",
            "host_connect",
            "host_confirm_origin",
            "host_forget_origin",
            "host_ready",
            "host_events",
            "host_ack_events",
            "host_open_external",
            "host_screen_start",
            "host_notification_show",
            "host_screen_stop",
            "host_screen_status",
            "host_fcm_token",
        ]),
```

- [ ] **Step 3: Update the hand-written permission descriptions**

In `apps/desktop/src-tauri/permissions/native-host.toml`, replace the `host_connect` entry (its behavior changed — it no longer just retries a fixed frontend):

```toml
[[permission]]
identifier = "allow-host-connect"
description = "Retry the compiled frontend from the bundled recovery page."
commands.allow = ["host_connect"]
```

with:

```toml
[[permission]]
identifier = "allow-host-connect"
description = "Preflight and connect to the currently configured or a candidate server origin."
commands.allow = ["host_connect"]
```

Then add two new entries at the end of the file:

```toml

[[permission]]
identifier = "allow-host-confirm-origin"
description = "Persist and navigate to a server origin that already passed preflight."
commands.allow = ["host_confirm_origin"]

[[permission]]
identifier = "allow-host-forget-origin"
description = "Clear the currently trusted server origin."
commands.allow = ["host_forget_origin"]
```

- [ ] **Step 4: Grant the new permissions to the local shell capability only**

In `apps/desktop/scripts/native-host.mjs`'s `makeConfig(origin)`, the `native-shell` capability currently reads:

```js
          { identifier: 'native-shell', windows: ['main'], platforms: ['android', 'iOS'], local: true,
            permissions: ['allow-host-info', 'allow-host-connect'] },
```

Change it to:

```js
          { identifier: 'native-shell', windows: ['main'], platforms: ['android', 'iOS'], local: true,
            permissions: ['allow-host-info', 'allow-host-connect', 'allow-host-confirm-origin', 'allow-host-forget-origin'] },
```

Do **not** add these to the `native-remote` capability below it — `host_confirm_origin`/`host_forget_origin` must only ever be callable from the trusted local shell (`local: true`), matching `host_connect`'s existing restriction and the security property described in the spec ("una vez conectado a un servidor, ese servidor no puede auto-reconectar la app a otro dominio distinto").

- [ ] **Step 5: Verify**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: compiles clean, and regenerates `permissions/autogenerated/host_confirm_origin.toml` and `permissions/autogenerated/host_forget_origin.toml` (gitignored, not committed).

Run: `node --check apps/desktop/scripts/native-host.mjs`
Expected: no output (pass).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/build.rs apps/desktop/src-tauri/permissions/native-host.toml apps/desktop/scripts/native-host.mjs
git commit -m "feat: register host_confirm_origin/host_forget_origin as local-shell-only commands"
```

---

### Task 3: `--universal` build mode

**Files:**
- Modify: `apps/desktop/src-tauri/build.rs`
- Modify: `apps/desktop/scripts/native-host.mjs`

- [ ] **Step 1: Let `build.rs` accept a production build with no origin**

Replace the `if target == "android" || target == "ios" { ... }` block in `apps/desktop/src-tauri/build.rs` (this is the block already touched in Task 2 Step 2 for the commands list — that edit is inside the same function but a different statement; this step edits the origin-validation `match`, further up in `main()`):

```rust
    if target == "android" || target == "ios" {
        let environment = std::env::var("RUNLY_NATIVE_ENV")
            .or_else(|_| std::env::var("ATLAS_NATIVE_ENV"))
            .expect("Use scripts/native-host.mjs to build Mobile");
        let origin = std::env::var("RUNLY_NATIVE_ORIGIN")
            .or_else(|_| std::env::var("ATLAS_NATIVE_ORIGIN"))
            .expect("Missing compiled native origin");
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../native-host/environments.json")).unwrap();
        match environment.as_str() {
            "production" | "staging" => {
                assert_eq!(Some(origin.as_str()), config[&environment].as_str())
            }
            "development" => {
                assert_ne!(
                    std::env::var("PROFILE").unwrap(),
                    "release",
                    "Development origin forbidden in release"
                );
                assert!(origin.starts_with("http://") || origin.starts_with("https://"));
            }
            _ => panic!("Unknown native environment"),
        }
        println!("cargo:rustc-env=ATLAS_NATIVE_ORIGIN={origin}");
        println!(
            "cargo:rustc-env=ATLAS_NATIVE_VERSION={}",
            config["nativeHostVersion"].as_str().unwrap()
        );
    }
```

with:

```rust
    if target == "android" || target == "ios" {
        let environment = std::env::var("RUNLY_NATIVE_ENV")
            .or_else(|_| std::env::var("ATLAS_NATIVE_ENV"))
            .expect("Use scripts/native-host.mjs to build Mobile");
        // Absent only for a `--universal` production build — every other
        // environment still requires a compiled-in origin.
        let origin = std::env::var("RUNLY_NATIVE_ORIGIN")
            .or_else(|_| std::env::var("ATLAS_NATIVE_ORIGIN"))
            .ok();
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../native-host/environments.json")).unwrap();
        match environment.as_str() {
            "production" => {
                if let Some(value) = &origin {
                    assert_eq!(Some(value.as_str()), config["production"].as_str())
                }
                // No origin: universal build, resolved by the user at runtime.
            }
            "staging" => {
                let value = origin
                    .as_deref()
                    .expect("Missing compiled native origin for staging");
                assert_eq!(Some(value), config["staging"].as_str())
            }
            "development" => {
                let value = origin
                    .as_deref()
                    .expect("Missing compiled native origin for development");
                assert_ne!(
                    std::env::var("PROFILE").unwrap(),
                    "release",
                    "Development origin forbidden in release"
                );
                assert!(value.starts_with("http://") || value.starts_with("https://"));
            }
            _ => panic!("Unknown native environment"),
        }
        if let Some(value) = &origin {
            println!("cargo:rustc-env=ATLAS_NATIVE_ORIGIN={value}");
        }
        println!(
            "cargo:rustc-env=ATLAS_NATIVE_VERSION={}",
            config["nativeHostVersion"].as_str().unwrap()
        );
    }
```

- [ ] **Step 2: Let `native-host.mjs` accept and thread through `--universal`**

In `apps/desktop/scripts/native-host.mjs`, the CLI entry point currently reads:

```js
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform = 'android', action = 'dev', environment = process.env.RUNLY_NATIVE_ENV || 'staging'] = process.argv.slice(2)
  if (!['android', 'ios'].includes(platform) || !['init', 'dev', 'build', 'config'].includes(action)) throw new Error('Usage: native-host.mjs android|ios init|dev|build|config development|staging|production')
  const origin = resolveEnvironment(environment, process.env.RUNLY_NATIVE_DEV_ORIGIN, action, process.argv.slice(5).includes('--debug'))
  if (platform === 'android' && action !== 'init') {
    prepareAndroidFirebase(resolve(desktop, '../..'), resolve(desktop, 'src-tauri/gen/android/app'))
  }
  const configPath = resolve(desktop, 'src-tauri/tauri.native.generated.json')
  writeFileSync(configPath, `${JSON.stringify(makeConfig(origin), null, 2)}\n`)
  if (action === 'config') console.log(configPath)
  else {
    const extra = process.argv.slice(5)
    if (extra.some((arg) => !['--debug', '--apk', '--aab'].includes(arg))) throw new Error('Only --debug/--apk/--aab supported; use RUNLY_NATIVE_TARGET for ABI')
    const target = process.env.RUNLY_NATIVE_TARGET || 'aarch64'
    if (!['aarch64', 'armv7', 'i686', 'x86_64'].includes(target)) throw new Error('Invalid Android target')
    const cli = resolve(desktop, 'node_modules/@tauri-apps/cli/tauri.js')
    // A stable remote host must bootstrap from bundled assets even during development.
    // `tauri dev` can replace App URLs with its development asset server, so dev here
    // builds a debug host. Web edits still appear remotely without rebuilding it.
    const tauriAction = action === 'dev' ? 'build' : action
    if (tauriAction === 'build') buildNativeBrandAssets()
    const args = [cli, platform, tauriAction, '--config', configPath, ...(action === 'init' ? ['--ci'] : [])]
    if (action === 'dev') args.push('--debug')
    if (platform === 'android' && tauriAction === 'build') args.push('--target', target)
    if (platform === 'ios' && extra.some((arg) => ['--apk', '--aab'].includes(arg))) throw new Error('APK/AAB apply only to Android')
    if (tauriAction === 'build') args.push(...extra)
    const result = spawnSync(process.execPath, args, {
      cwd: desktop, stdio: 'inherit', env: { ...process.env, RUNLY_NATIVE_ENV: environment, RUNLY_NATIVE_ORIGIN: origin },
    })
    if (result.error) throw result.error
    if (action === 'init' && result.status === 0) buildNativeBrandAssets()
    process.exitCode = result.status ?? 1
  }
}
```

Change it to:

```js
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform = 'android', action = 'dev', environment = process.env.RUNLY_NATIVE_ENV || 'staging'] = process.argv.slice(2)
  if (!['android', 'ios'].includes(platform) || !['init', 'dev', 'build', 'config'].includes(action)) throw new Error('Usage: native-host.mjs android|ios init|dev|build|config development|staging|production')
  const extra = process.argv.slice(5)
  if (extra.some((arg) => !['--debug', '--apk', '--aab', '--universal'].includes(arg))) throw new Error('Only --debug/--apk/--aab/--universal supported; use RUNLY_NATIVE_TARGET for ABI')
  const universal = extra.includes('--universal')
  if (universal && (platform !== 'android' || action !== 'build')) throw new Error('--universal only applies to `android build`')
  if (universal && environment !== 'production') throw new Error('--universal builds must use the production environment')
  const origin = universal ? null : resolveEnvironment(environment, process.env.RUNLY_NATIVE_DEV_ORIGIN, action, extra.includes('--debug'))
  if (platform === 'android' && action !== 'init') {
    prepareAndroidFirebase(resolve(desktop, '../..'), resolve(desktop, 'src-tauri/gen/android/app'))
  }
  const configPath = resolve(desktop, 'src-tauri/tauri.native.generated.json')
  writeFileSync(configPath, `${JSON.stringify(makeConfig(origin), null, 2)}\n`)
  if (action === 'config') console.log(configPath)
  else {
    const target = process.env.RUNLY_NATIVE_TARGET || 'aarch64'
    if (!['aarch64', 'armv7', 'i686', 'x86_64'].includes(target)) throw new Error('Invalid Android target')
    const cli = resolve(desktop, 'node_modules/@tauri-apps/cli/tauri.js')
    // A stable remote host must bootstrap from bundled assets even during development.
    // `tauri dev` can replace App URLs with its development asset server, so dev here
    // builds a debug host. Web edits still appear remotely without rebuilding it.
    const tauriAction = action === 'dev' ? 'build' : action
    if (tauriAction === 'build') buildNativeBrandAssets()
    const args = [cli, platform, tauriAction, '--config', configPath, ...(action === 'init' ? ['--ci'] : [])]
    if (action === 'dev') args.push('--debug')
    if (platform === 'android' && tauriAction === 'build') args.push('--target', target)
    if (platform === 'ios' && extra.some((arg) => ['--apk', '--aab'].includes(arg))) throw new Error('APK/AAB apply only to Android')
    if (tauriAction === 'build') args.push(...extra.filter((arg) => arg !== '--universal'))
    const result = spawnSync(process.execPath, args, {
      cwd: desktop, stdio: 'inherit',
      env: { ...process.env, RUNLY_NATIVE_ENV: environment, ...(origin ? { RUNLY_NATIVE_ORIGIN: origin } : {}) },
    })
    if (result.error) throw result.error
    if (action === 'init' && result.status === 0) buildNativeBrandAssets()
    process.exitCode = result.status ?? 1
  }
}
```

Key changes: `extra`/`universal` are computed once, up front, before `origin` is resolved (previously `origin` was resolved before `extra` even existed as a variable). `--universal` is filtered out of the args passed to the real `tauri` CLI (it doesn't know that flag). `RUNLY_NATIVE_ORIGIN` is only added to the spawned environment when `origin` is truthy — passing `null` through `spawnSync`'s `env` would otherwise stringify to the literal text `"null"`, which `build.rs` would wrongly treat as a real (if malformed) origin string.

- [ ] **Step 3: Update `makeConfig` to emit a wildcard capability pattern when there's no fixed origin**

In `apps/desktop/scripts/native-host.mjs`, `makeConfig(origin)` currently has:

```js
          { identifier: 'native-remote', windows: ['main'], platforms: ['android', 'iOS'], local: false,
            remote: { urls: [`${origin}/app/*`] },
```

Change it to:

```js
          { identifier: 'native-remote', windows: ['main'], platforms: ['android', 'iOS'], local: false,
            remote: { urls: origin ? [`${origin}/app/*`] : ['https://*/app/*'] },
```

**Why this is still safe with no fixed origin:** the Tauri capability match only gates whether the webview *can receive IPC responses at all* for a matching URL — it is not the layer that decides which server the user is actually talking to. That decision is enforced independently and redundantly by Rust: `on_navigation` (only navigates to `HostState.origin` or the local shell) and `check_remote` (re-validates on every single command call) both compare against the one origin currently stored in `HostState`, set only via the local-shell-only `host_confirm_origin`. A broader capability pattern here doesn't let a remote page reach a *different* origin than the one already confirmed — it only widens which origins the capability *system* would allow the IPC bridge to respond on, and Rust's own checks are what actually pin that down to exactly one at a time.

**Verification note for whoever implements this step:** Tauri 2's capability `remote.urls` patterns support wildcards, but this plan hasn't independently confirmed that a bare-host wildcard like `https://*/app/*` (not just a subdomain wildcard on a fixed root domain) validates against Tauri's own capability schema. `cargo check` in Step 4 below will surface a schema validation error immediately if this exact pattern is rejected — if that happens, don't guess a fix; report it, since the schema's actual supported syntax needs to be looked up (Tauri's capability JSON schema docs) rather than assumed.

- [ ] **Step 4: Verify**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: compiles clean.

Run: `node --check apps/desktop/scripts/native-host.mjs`
Expected: no output (pass).

Run a config-only dry run to inspect the generated capability without a full build:
```bash
node apps/desktop/scripts/native-host.mjs android config production --universal
cat apps/desktop/src-tauri/tauri.native.generated.json
```
Expected: prints a config whose `native-remote` capability has `remote.urls: ["https://*/app/*"]`, and no `RUNLY_NATIVE_ORIGIN`-dependent value baked in. (If this command errors instead, read the error — `config` needs `extra`/`universal` handling to also work when `action === 'config'`, which the rewritten Step 2 code already supports since `universal`/`origin` are computed before the `action === 'config'` branch.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/build.rs apps/desktop/scripts/native-host.mjs
git commit -m "feat: add --universal Android build mode with no compiled-in server origin"
```

---

### Task 4: `mobile_media.rs` — origin persistence bridge functions

**Files:**
- Modify: `apps/desktop/src-tauri/src/mobile_media.rs`

- [ ] **Step 1: Add `get_origin`/`set_origin`**

Add these two functions after `stop_on_navigation` and before `pub fn init()`:

```rust
pub async fn get_origin(app: AppHandle) -> Result<Option<String>, String> {
    let result = run(app, "getOrigin", json!({})).await?;
    Ok(result.get("origin").and_then(|v| v.as_str()).map(String::from))
}

pub async fn set_origin(app: AppHandle, origin: Option<String>) -> Result<(), String> {
    run(app, "setOrigin", json!({ "origin": origin })).await?;
    Ok(())
}
```

These are plain `pub async fn`, not `#[tauri::command]` — they're called from `mobile_host.rs`'s `persist_origin`/`load_persisted_origin` (Task 1), not directly invoked from JS. They forward to Android plugin commands named `"getOrigin"`/`"setOrigin"` (Task 5) via the same private `run()` helper already used by every other function in this file.

- [ ] **Step 2: Verify**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: compiles clean on this desktop host (this file is `#[cfg(target_os = "android")]`-gated as a whole at the `mod mobile_media;` declaration in `lib.rs`, so it isn't compiled here at all — this check just confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/mobile_media.rs
git commit -m "feat: add get_origin/set_origin bridge functions for the Android plugin"
```

---

### Task 5: Kotlin — persist the origin via SharedPreferences

**Files:**
- Modify: `apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/ScreenSharePlugin.kt`

- [ ] **Step 1: Add `getOrigin`/`setOrigin` commands**

In `ScreenSharePlugin.kt`, add these two `@Command` methods right after the existing `currentToken` command (added by the FCM plan):

```kotlin
  @Command
  fun getOrigin(invoke: Invoke) {
    val origin = activity.getSharedPreferences("runly_server", Context.MODE_PRIVATE).getString("origin", null)
    invoke.resolve(JSObject().apply { put("origin", origin) })
  }

  @Command
  fun setOrigin(invoke: Invoke) {
    val args = invoke.getArgs()
    val prefs = activity.getSharedPreferences("runly_server", Context.MODE_PRIVATE)
    if (args.isNull("origin")) prefs.edit().remove("origin").apply()
    else prefs.edit().putString("origin", args.getString("origin")).apply()
    invoke.resolve()
  }
```

`Context` is already imported in this file (used for `Context.MEDIA_PROJECTION_SERVICE`). `JSObject`/`Invoke`/`@Command` are already imported and used by the neighboring `currentToken`/`notify` commands.

`args.isNull("origin")` (from `org.json.JSONObject`) correctly distinguishes "key present with JSON `null` value" from "key present with a real string" — this matters because the Rust side sends `json!({ "origin": origin })` where `origin: Option<String>` serializes `None` as JSON `null`, not as a missing key.

- [ ] **Step 2: Verify the Kotlin compiles**

Run: `cd apps/desktop/src-tauri/gen/android && ./gradlew.bat :app:compileArm64DebugKotlin` (set `ANDROID_HOME`/`JAVA_HOME` first if not already in this shell's environment — see `docs/mobile/RUNLY_NATIVE_HOST.md`'s "Configuración y desarrollo" section for the exact values used successfully earlier in this project).
Expected: `BUILD SUCCESSFUL`. If the Android SDK/toolchain isn't available in this environment, report that clearly rather than guessing at a fix — this exact command succeeded earlier in this project's history (FCM plan, Task 10), so if it fails now, the cause is either an environment change or a real error in this new code, not something to route around.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/ScreenSharePlugin.kt
git commit -m "feat: persist the server origin via SharedPreferences (Android)"
```

---

### Task 6: Local shell UI — three-state connect flow

**Files:**
- Modify: `apps/desktop/native-host/shell/index.html`
- Modify: `apps/desktop/native-host/shell/shell.css`
- Modify: `apps/desktop/native-host/shell/shell.js`

- [ ] **Step 1: Add the form/confirmation markup**

Replace the full content of `apps/desktop/native-host/shell/index.html`:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Runly ERP</title>
  <link rel="stylesheet" href="shell.css">
  <script src="shell.js" defer></script>
</head>
<body>
  <main>
    <img class="mark" src="runly-mark.svg" width="96" height="96" alt="">
    <h1>Runly ERP</h1>
    <p id="status" role="status">Conectando con Runly…</p>
    <form id="connect-form" hidden>
      <label for="origin-input">URL de tu servidor Runly</label>
      <input id="origin-input" type="url" placeholder="https://runly.tuempresa.com" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button id="connect-button" type="button">Conectar</button>
    </form>
    <div id="confirm-panel" hidden>
      <p>Vas a conectar a <strong id="confirm-origin"></strong>. Esta app confiará en este servidor y le dará acceso a notificaciones, vibración y captura de pantalla cuando lo uses.</p>
      <button id="confirm-button" type="button">Confirmar</button>
      <button id="cancel-button" type="button">Cancelar</button>
    </div>
    <button id="retry" type="button" hidden>Reintentar</button>
    <details><summary>Diagnóstico</summary><pre id="diagnostics"></pre></details>
    <p class="forget"><a id="forget-link" href="#">Cambiar de servidor</a></p>
  </main>
</body>
</html>
```

(`retry` gains `hidden` as its default state — `shell.js` toggles it explicitly now instead of relying on `disabled` alone.)

- [ ] **Step 2: Add minimal styling for the new elements**

Replace the full content of `apps/desktop/native-host/shell/shell.css`:

```css
:root{font-family:system-ui,sans-serif;color:#e8edf7;background:#0c172b;color-scheme:dark}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:env(safe-area-inset-top) 24px env(safe-area-inset-bottom);box-sizing:border-box}
main{width:100%;max-width:360px}.mark{display:block;width:96px;height:96px;border-radius:24px}
h1{font-size:28px;margin-top:24px}p{color:#b9c7df;line-height:1.6;min-height:52px}
button{border:0;border-radius:10px;padding:14px 22px;background:#467bea;color:white;font:inherit;cursor:pointer}button:disabled{opacity:.5}
details{margin-top:32px;color:#b9c7df}summary{cursor:pointer;padding:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.6}
form{display:grid;gap:10px;margin-top:8px}label{font-size:13px;color:#b9c7df;text-align:left}
input{border:1px solid #2a3a5c;border-radius:10px;padding:12px 14px;background:#0f1e38;color:#e8edf7;font:inherit}
#confirm-panel{display:grid;gap:10px}#confirm-panel button{width:100%}#cancel-button{background:#2a3a5c}
.forget{margin-top:16px;min-height:auto}.forget a{color:#7ea1e8}
[hidden]{display:none!important}
```

- [ ] **Step 3: Rewrite the connect flow logic**

Replace the full content of `apps/desktop/native-host/shell/shell.js`:

```js
const status = document.getElementById('status')
const retry = document.getElementById('retry')
const diagnostics = document.getElementById('diagnostics')
const connectForm = document.getElementById('connect-form')
const originInput = document.getElementById('origin-input')
const connectButton = document.getElementById('connect-button')
const confirmPanel = document.getElementById('confirm-panel')
const confirmOrigin = document.getElementById('confirm-origin')
const confirmButton = document.getElementById('confirm-button')
const cancelButton = document.getElementById('cancel-button')
const forgetLink = document.getElementById('forget-link')
const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args)

function showForm(message) {
  status.textContent = message || 'Conecta con tu servidor Runly.'
  connectForm.hidden = false
  confirmPanel.hidden = true
  retry.hidden = true
}

function showConfirm(origin) {
  confirmOrigin.textContent = origin
  connectForm.hidden = true
  confirmPanel.hidden = false
  retry.hidden = true
}

function showConnecting() {
  status.textContent = 'Conectando con Runly…'
  connectForm.hidden = true
  confirmPanel.hidden = true
  retry.hidden = true
}

function showFailed(message) {
  status.textContent = message
  connectForm.hidden = true
  confirmPanel.hidden = true
  retry.hidden = false
}

async function attemptConnect(origin) {
  showConnecting()
  try {
    const result = await invoke('host_connect', { origin: origin ?? null })
    if (result?.status === 'pending_confirmation') showConfirm(result.origin)
    // status "connected" navigates the webview away; nothing else to do here.
  } catch (error) {
    diagnostics.textContent += `\nError: ${String(error)}\nRed: ${navigator.onLine ? 'disponible' : 'sin conexión'}`
    if (error === 'NO_ORIGIN_CONFIGURED') { showForm(); return }
    if (origin) showForm('No se pudo conectar. Revisa la URL e intenta de nuevo.')
    else showFailed('No se pudo conectar con Runly.')
  }
}

connectButton.addEventListener('click', () => {
  const value = originInput.value.trim()
  if (value) attemptConnect(value)
})

confirmButton.addEventListener('click', async () => {
  confirmButton.disabled = true
  try {
    await invoke('host_confirm_origin')
  } catch (error) {
    confirmButton.disabled = false
    showForm('No se pudo confirmar la conexión.')
  }
})

cancelButton.addEventListener('click', () => showForm())

forgetLink.addEventListener('click', async (event) => {
  event.preventDefault()
  await invoke('host_forget_origin').catch(() => {})
  showForm()
})

retry.addEventListener('click', () => attemptConnect())

invoke('host_info').then((info) => {
  diagnostics.textContent = `Host: ${info.nativeHostVersion}\nPlataforma: ${info.platform}\nSistema: ${info.osVersion}\nFrontend: ${info.frontendUrl ?? '(sin configurar)'}\nRed: ${navigator.onLine ? 'disponible' : 'sin conexión'}`
  if (location.hash === '#failed') showFailed('No se pudo conectar con Runly.')
  else attemptConnect()
}).catch(() => { status.textContent = 'No se pudo iniciar Runly. Reinicia la aplicación.' })
```

- [ ] **Step 4: Verify**

Run: `node --check apps/desktop/native-host/shell/shell.js`
Expected: no output (pass).

There is no build/bundle step for this shell (per `docs/mobile/RUNLY_NATIVE_HOST.md`: "Mobile empaqueta únicamente `native-host/shell`... HTML/CSS/JS de recuperación") — it's shipped as static files, so a syntax check plus manual reading is the available verification; full behavioral verification needs an actual device/emulator run, out of scope for this automated pass (same limitation the plan's final task documents for the rest of the native host).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/native-host/shell/index.html apps/desktop/native-host/shell/shell.css apps/desktop/native-host/shell/shell.js
git commit -m "feat: add connect/confirm/forget-server UI to the native host local shell"
```

---

### Task 7: Documentation correction

**Files:**
- Modify: `docs/mobile/RUNLY_NATIVE_HOST.md`

- [ ] **Step 1: Fix the now-inaccurate claim**

In `docs/mobile/RUNLY_NATIVE_HOST.md`, the audit table's "Runtime" row currently ends with:

```
Mobile usa configuración web y nunca ofrece elegir servidor.
```

Change that sentence to:

```
Mobile usa configuración web; un build `--universal` (ver más abajo) deja elegir servidor en runtime con preflight y confirmación explícita, y los demás modos siguen con origen fijo en compilación.
```

- [ ] **Step 2: Add a short new subsection documenting the universal build**

Right after the existing `pnpm native:android build staging --debug --apk` code block in the "Configuración y desarrollo" section, add:

```markdown

Build universal (sin origen fijo, para distribución pública — el usuario conecta su propio servidor la primera vez que abre la app):

```powershell
pnpm native:android build production --apk --universal
```

Ver `docs/superpowers/specs/2026-09-22-android-runtime-server-connect-design.md` para el diseño completo del flujo de conexión en runtime.
```

- [ ] **Step 3: Commit**

```bash
git add docs/mobile/RUNLY_NATIVE_HOST.md
git commit -m "docs: correct mobile server-selection claim and document --universal build"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the Rust test suite**

Run: `cd apps/desktop/src-tauri && cargo test`
Expected: all tests pass (existing + the 2 new ones from Task 1).

- [ ] **Step 2: Run `cargo check`**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: compiles clean.

- [ ] **Step 3: Syntax-check every modified JS file**

Run:
```bash
node --check apps/desktop/scripts/native-host.mjs
node --check apps/desktop/native-host/shell/shell.js
```
Expected: no output from either.

- [ ] **Step 4: Attempt the Android Kotlin compile**

Run: `cd apps/desktop/src-tauri/gen/android && ./gradlew.bat :app:compileArm64DebugKotlin`
Expected: `BUILD SUCCESSFUL`. If the environment can't run this (missing SDK/NDK), report that plainly rather than skipping silently.

- [ ] **Step 5: Report status to the user**

Summarize what was verified automatically (Rust tests, `cargo check`, JS syntax, Kotlin compile if it ran) versus what still needs the user's own environment: an actual `--universal` APK build and install on a device to walk through the connect → preflight → confirm → navigate flow end-to-end against a real server, which no automated check in this plan proves. Also remind the user that `docs/mobile/RUNLY_NATIVE_HOST.md`'s device-acceptance checklist (further down in that same file) was written for the old fixed-origin flow and should get a new checklist item for "connect to a fresh server on first launch" the next time someone runs through it on a physical device.

---

## Post-implementation note for the user

This plan does not touch:
- iOS (explicitly out of scope per the approved spec — the same `#[cfg(not(target_os = "android"))]` fallback in `persist_origin`/`load_persisted_origin` means iOS keeps behaving exactly like today, seeded only from `COMPILED_ORIGIN`, since there's no iOS project buildable in this environment to add the equivalent Keychain/UserDefaults persistence to).
- Any curated/vetted list of known-good Runly servers — connecting is free-text, gated only by the HTTPS+CSP preflight and the user's own explicit confirmation, matching Element/Matrix-style self-hosted trust.
- Publishing/distributing the resulting APK anywhere (Google Play, GitHub Releases, etc.) — this plan only makes the build possible, it doesn't publish it.
