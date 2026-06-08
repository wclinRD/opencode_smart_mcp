/// RecordingControlPanel.swift
/// SwiftUI floating panel for meeting recording control
///
/// Usage:
///   ./RecordingControlPanel --session /path/to/session --pid 12345
///
/// Controls:
///   - Pause/Resume: writes "pause" or "resume" to session_dir/.control
///   - Stop: writes "stop" to session_dir/.control, then SIGTERM recorder
///   - Status: reads session_dir/.status for recorder status updates

import SwiftUI
import AppKit
import Foundation

// MARK: - App

@main
struct RecordingControlPanelApp: App {
    @State private var elapsed: String = "00:00"
    @State private var state: String = "starting"
    @State private var isPaused: Bool = false
    @State private var timer: Timer? = nil

    let sessionDir: String
    let recorderPid: Int

    init() {
        let a = Self.parseArgs()
        self.sessionDir = a.sessionDir
        self.recorderPid = a.recorderPid
    }

    // MARK: Arguments

    struct Args {
        var sessionDir: String = ""
        var recorderPid: Int = 0
    }

    static func parseArgs() -> Args {
        var a = Args()
        let raw = Array(CommandLine.arguments.dropFirst())
        for i in 0..<raw.count {
            switch raw[i] {
            case "--session":
                if i+1 < raw.count { a.sessionDir = raw[i+1] }
            case "--pid":
                if i+1 < raw.count { a.recorderPid = Int(raw[i+1]) ?? 0 }
            default: break
            }
        }
        return a
    }

    // MARK: Control File I/O

    func writeControl(_ cmd: String) {
        let controlPath = (sessionDir as NSString).appendingPathComponent(".control")
        try? cmd.write(toFile: controlPath, atomically: true, encoding: .utf8)
    }

    func readStatus() -> (elapsed: String, state: String) {
        let statusPath = (sessionDir as NSString).appendingPathComponent(".status")
        guard let content = try? String(contentsOfFile: statusPath, encoding: .utf8) else {
            return ("--:--", "starting")
        }
        let parts = content.components(separatedBy: "|")
        if parts.count >= 2 {
            return (parts[0], parts[1])
        }
        return ("--:--", content.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 16) {
                // Recording indicator
                HStack(spacing: 8) {
                    Circle()
                        .fill(isPaused ? Color.orange : Color.red)
                        .frame(width: 12, height: 12)
                        .overlay(
                            Circle()
                                .stroke(Color.red.opacity(0.5), lineWidth: 2)
                                .scaleEffect(isPaused ? 1.0 : 1.5)
                                .animation(
                                    isPaused ? .default : .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                                    value: isPaused
                                )
                        )
                    Text(isPaused ? "已暫停" : "錄音中")
                        .font(.headline)
                        .foregroundColor(isPaused ? .orange : .primary)
                }

                // Elapsed time
                Text(elapsed)
                    .font(.system(size: 48, weight: .light, design: .monospaced))
                    .foregroundColor(.primary)

                // Source info
                HStack {
                    Image(systemName: "mic.fill")
                        .foregroundColor(.secondary)
                    Text(state.capitalized)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Divider()

                // Control buttons
                HStack(spacing: 20) {
                    Button(action: togglePause) {
                        VStack(spacing: 4) {
                            Image(systemName: isPaused ? "play.fill" : "pause.fill")
                                .font(.title2)
                            Text(isPaused ? "繼續" : "暫停")
                                .font(.caption)
                        }
                        .frame(width: 70, height: 60)
                    }
                    .buttonStyle(.bordered)
                    .tint(isPaused ? .green : .orange)

                    Button(action: stopRecording) {
                        VStack(spacing: 4) {
                            Image(systemName: "stop.fill")
                                .font(.title2)
                            Text("停止")
                                .font(.caption)
                        }
                        .frame(width: 70, height: 60)
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                }
            }
            .padding(24)
            .frame(minWidth: 200)
            .onAppear(perform: startPolling)
            .onDisappear(perform: stopPolling)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .windowLevel(.floating)
    }

    /// Accessory mode — no dock icon, no menu bar
    func setupAccessoryMode() {
        NSApplication.shared.setActivationPolicy(.accessory)
    }

    func startPolling() {
        setupAccessoryMode()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            let (elapsedStr, stateStr) = self.readStatus()
            self.elapsed = elapsedStr
            self.state = stateStr
            self.isPaused = (stateStr == "paused")
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    func togglePause() {
        writeControl(isPaused ? "resume" : "pause")
    }

    func stopRecording() {
        // Write stop command to control file
        writeControl("stop")
        // Also send SIGTERM as fallback
        if recorderPid > 0 {
            kill(Int32(recorderPid), SIGTERM)
        }
        NSApplication.shared.terminate(nil)
    }
}