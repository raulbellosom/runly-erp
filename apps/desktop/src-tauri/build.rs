fn main() {
    println!("cargo:rerun-if-env-changed=RUNLY_NATIVE_ENV");
    println!("cargo:rerun-if-env-changed=RUNLY_NATIVE_ORIGIN");
    println!("cargo:rerun-if-env-changed=ATLAS_NATIVE_ENV");
    println!("cargo:rerun-if-env-changed=ATLAS_NATIVE_ORIGIN");
    println!("cargo:rerun-if-changed=../native-host/environments.json");
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
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
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
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
    ))
    .expect("Tauri build configuration failed");
}
