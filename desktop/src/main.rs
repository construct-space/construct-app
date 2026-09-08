// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // --dev flag: opens webview devtools on the main window so production
    // builds can be inspected without rebuilding. Run from a terminal:
    //   /Volumes/Construct/Construct.app/Contents/MacOS/construct --dev
    if std::env::args().any(|a| a == "--dev") {
        // SAFETY: set early before any threads spawn. Read inside lib::run().
        unsafe {
            std::env::set_var("CONSTRUCT_DEV", "1");
        }
    }
    construct_lib::run();
}
