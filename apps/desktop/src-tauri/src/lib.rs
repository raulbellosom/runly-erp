#[cfg(any(mobile, test))]
mod mobile_host;
#[cfg(target_os = "android")]
mod mobile_media;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(mobile_media::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build());
    #[cfg(mobile)]
    let builder = builder
        .plugin(tauri_plugin_haptics::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
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
        .setup(mobile_host::setup);
    builder
        .run(tauri::generate_context!())
        .expect("error while running Runly ERP");
}
