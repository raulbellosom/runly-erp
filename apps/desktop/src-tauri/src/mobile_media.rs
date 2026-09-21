use serde_json::{json, Value};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, WebviewWindow, Wry,
};

struct MediaHandle(PluginHandle<Wry>);

pub fn stop_on_navigation(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = run(app, "stop", json!({})).await;
    });
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("runly-media")
        .setup(|app, api| {
            app.manage(MediaHandle(api.register_android_plugin(
                "com.racoondevs.runlyerp",
                "ScreenSharePlugin",
            )?));
            Ok(())
        })
        .build()
}

async fn run(app: AppHandle, command: &'static str, payload: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<MediaHandle>()
            .0
            .run_mobile_plugin(command, payload)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "NATIVE_MEDIA_FAILED".to_string())?
}

#[tauri::command]
pub async fn host_notification_show(
    window: WebviewWindow,
    app: AppHandle,
    options: Value,
) -> Result<Value, String> {
    super::mobile_host::check_remote(&window)?;
    run(app, "notify", options).await
}

#[tauri::command]
pub async fn host_screen_start(
    window: WebviewWindow,
    app: AppHandle,
    session: Value,
) -> Result<Value, String> {
    super::mobile_host::check_remote(&window)?;
    let url = tauri::Url::parse(session["livekitUrl"].as_str().unwrap_or(""))
        .map_err(|_| "INVALID_MEDIA_URL")?;
    if (url.scheme() != "wss" && !(cfg!(debug_assertions) && url.scheme() == "ws"))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("INVALID_MEDIA_URL".into());
    }
    if session["token"]
        .as_str()
        .map_or(true, |token| token.is_empty() || token.len() > 8192)
    {
        return Err("INVALID_MEDIA_TOKEN".into());
    }
    run(app, "start", session).await
}

#[tauri::command]
pub async fn host_screen_stop(window: WebviewWindow, app: AppHandle) -> Result<Value, String> {
    super::mobile_host::check_remote(&window)?;
    run(app, "stop", json!({})).await
}

#[tauri::command]
pub async fn host_screen_status(window: WebviewWindow, app: AppHandle) -> Result<Value, String> {
    super::mobile_host::check_remote(&window)?;
    run(app, "status", json!({})).await
}

#[tauri::command]
pub async fn host_fcm_token(window: WebviewWindow, app: AppHandle) -> Result<Value, String> {
    super::mobile_host::check_remote(&window)?;
    run(app, "currentToken", json!({})).await
}
