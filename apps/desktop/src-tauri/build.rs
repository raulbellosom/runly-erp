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
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
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
    ))
    .expect("Tauri build configuration failed");
}
