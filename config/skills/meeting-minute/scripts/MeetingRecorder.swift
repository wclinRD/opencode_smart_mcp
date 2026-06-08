#!/usr/bin/env swift

/// MeetingRecorder.swift
/// macOS audio recorder — ScreenCaptureKit (system audio) + AVAudioEngine (mic)
///
/// Usage:
///   swift MeetingRecorder.swift --source system --output recording.wav
///   swift MeetingRecorder.swift --source mic --output recording.wav
///   swift MeetingRecorder.swift --source both --output-system sys.wav --output-mic mic.wav
///
/// Signals: SIGINT/SIGTERM → graceful stop → flush WAV → exit
///
/// Permissions needed (granted via GUI prompt on first run):
///   - Screen Recording (for system audio via ScreenCaptureKit)
///   - Microphone (for mic audio via AVAudioEngine)
///
/// macOS 12.3+ (ScreenCaptureKit) required for system audio capture.

import Foundation
import AVFoundation
import ScreenCaptureKit
import AudioToolbox
import CoreMedia

// MARK: - Logger

class Logger {
    let fileHandle: FileHandle?
    let logPath: String

    init(path: String) {
        self.logPath = path
        let fm = FileManager.default
        let dir = (path as NSString).deletingLastPathComponent
        if !dir.isEmpty, !fm.fileExists(atPath: dir) {
            try? fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        }
        fm.createFile(atPath: path, contents: nil)
        self.fileHandle = try? FileHandle(forWritingTo: URL(fileURLWithPath: path))
        fileHandle?.seekToEndOfFile()
    }

    func log(_ msg: String) {
        let ts = ISO8601DateFormatter().string(from: Date())
        let line = "[\(ts)] \(msg)\n"
        if let data = line.data(using: .utf8) {
            fileHandle?.write(data)
            print(msg)  // Also print to stdout for real-time feedback
        }
    }

    func close() {
        try? fileHandle?.close()
    }

    deinit { close() }
}

// MARK: - Arguments

struct Args: CustomStringConvertible {
    enum Source: String, CaseIterable { case system, mic, both }
    var source: Source = .both
    var outputSystem: String = ""
    var outputMic: String = ""
    var sampleRate: Double = 48000
    var channels: Int = 1
    var logPath: String = "recorder.log"

    var description: String {
        "source=\(source.rawValue) sys=\(outputSystem) mic=\(outputMic) \(sampleRate)Hz \(channels)ch"
    }
}

func parseArgs() -> Args {
    var a = Args()
    let raw = Array(CommandLine.arguments.dropFirst())
    for i in 0..<raw.count {
        switch raw[i] {
        case "--source":
            if i+1 < raw.count, let s = Args.Source(rawValue: raw[i+1]) { a.source = s }
        case "--output":
            if i+1 < raw.count { a.outputSystem = raw[i+1]; a.outputMic = raw[i+1] }
        case "--output-system":
            if i+1 < raw.count { a.outputSystem = raw[i+1] }
        case "--output-mic":
            if i+1 < raw.count { a.outputMic = raw[i+1] }
        case "--sample-rate":
            if i+1 < raw.count { a.sampleRate = Double(raw[i+1]) ?? 48000 }
        case "--channels":
            if i+1 < raw.count { a.channels = Int(raw[i+1]) ?? 1 }
        case "--log":
            if i+1 < raw.count { a.logPath = raw[i+1] }
        default: break
        }
    }
    if a.outputSystem.isEmpty { a.outputSystem = "system_audio.wav" }
    if a.outputMic.isEmpty { a.outputMic = "mic_audio.wav" }
    return a
}

// MARK: - ExtAudioFile Writer

class AudioFileWriter {
    private var extFile: ExtAudioFileRef?
    let fileURL: URL

    init?(path: String, inputFormat: AudioStreamBasicDescription) {
        self.fileURL = URL(fileURLWithPath: path)

        var outputFormat = AudioStreamBasicDescription(
            mSampleRate: inputFormat.mSampleRate != 0 ? inputFormat.mSampleRate : 48000,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 2,
            mFramesPerPacket: 1,
            mBytesPerFrame: 2,
            mChannelsPerFrame: 1,
            mBitsPerChannel: 16,
            mReserved: 0
        )
        if inputFormat.mChannelsPerFrame >= 2 {
            outputFormat.mChannelsPerFrame = 2
            outputFormat.mBytesPerPacket = 4
            outputFormat.mBytesPerFrame = 4
        }

        var err = ExtAudioFileCreateWithURL(
            fileURL as CFURL,
            kAudioFileWAVEType,
            &outputFormat,
            nil,
            AudioFileFlags.eraseFile.rawValue,
            &extFile
        )
        guard err == noErr, extFile != nil else {
            print("ERROR: ExtAudioFileCreate failed (\(err)): \(path)")
            return nil
        }

        // Set client format (what we feed it)
        var clientFormat = inputFormat
        let fmtSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        err = ExtAudioFileSetProperty(extFile!, kExtAudioFileProperty_ClientDataFormat,
                                      fmtSize, &clientFormat)
        if err != noErr {
            print("WARN: Client format set failed (\(err)), using output format")
            err = ExtAudioFileSetProperty(extFile!, kExtAudioFileProperty_ClientDataFormat,
                                          fmtSize, &outputFormat)
            guard err == noErr else {
                print("ERROR: Cannot set client format (\(err))")
                ExtAudioFileDispose(extFile!)
                return nil
            }
        }
    }

    func write(audioBufferList: UnsafePointer<AudioBufferList>, frames: UInt32) -> OSStatus {
        guard let ef = extFile else { return -1 }
        var abl = audioBufferList.pointee  // mutable copy
        return withUnsafeMutablePointer(to: &abl) { ablPtr in
            ExtAudioFileWrite(ef, frames, ablPtr)
        }
    }

    func close() {
        guard let ef = extFile else { return }
        ExtAudioFileDispose(ef)
        extFile = nil
    }

    deinit { close() }
}

// MARK: - Microphone Recorder (AVAudioEngine)

class MicRecorder {
    private let engine = AVAudioEngine()
    private var writer: AudioFileWriter?
    private var isPaused = false

    func start(outputPath: String) throws {
        let input = engine.inputNode
        let fmt = input.outputFormat(forBus: 0)
        print("  Mic: \(fmt.sampleRate)Hz, \(fmt.channelCount)ch")

        let w = AudioFileWriter(path: outputPath, inputFormat: fmt.streamDescription.pointee)
        guard let w else {
            throw NSError(domain: "MicRecorder", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Cannot create audio writer"])
        }
        writer = w

        input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { [weak self] buffer, _ in
            guard let self = self, let writer = self.writer, !self.isPaused else { return }
            let status = writer.write(audioBufferList: buffer.audioBufferList, frames: buffer.frameLength)
            if status != noErr {
                print("WARN: ExtAudioFileWrite mic error: \(status)")
            }
        }

        try engine.start()
        print("  Mic recording started.")
    }

    func pause() {
        isPaused = true
        print("  Mic paused.")
    }

    func resume() {
        isPaused = false
        print("  Mic resumed.")
    }

    func stop() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        writer?.close()
        writer = nil
        print("  Mic recording stopped.")
    }
}

// MARK: - System Audio Recorder (ScreenCaptureKit)

class SystemAudioRecorder: NSObject, SCStreamOutput {
    private var stream: SCStream?
    private var writer: AudioFileWriter?
    private var recording = false
    private var outputSystemPath: String = ""

    func start(outputPath: String) async throws {
        outputSystemPath = outputPath
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw NSError(domain: "SysRecorder", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "No display found"])
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 48000
        cfg.channelCount = 2
        cfg.width = 1
        cfg.height = 1
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        stream = SCStream(filter: filter, configuration: cfg, delegate: nil)
        try stream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: .main)
        try await stream?.startCapture()

        recording = true
        print("  System audio recording started (ScreenCaptureKit). Output: \(outputPath)")

        // If no audio data arrives within 5 seconds, create a default-format writer
        // as a fallback (ScreenCaptureKit audio format is typically 48kHz Float32)
        Task {
            try await Task.sleep(nanoseconds: 5_000_000_000)
            if writer == nil && recording {
                print("  WARN: No audio data yet, creating fallback writer")
                let defaultFormat = AudioStreamBasicDescription(
                    mSampleRate: 48000,
                    mFormatID: kAudioFormatLinearPCM,
                    mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsNonInterleaved | kAudioFormatFlagIsPacked,
                    mBytesPerPacket: 4,
                    mFramesPerPacket: 1,
                    mBytesPerFrame: 4,
                    mChannelsPerFrame: 2,
                    mBitsPerChannel: 32,
                    mReserved: 0
                )
                writer = AudioFileWriter(path: outputPath, inputFormat: defaultFormat)
            }
        }
    }

    func stop() {
        recording = false
        let currentWriter = writer
        writer = nil
        stream?.stopCapture { error in
            if let error = error { print("  WARN: stream stop: \(error)") }
        }
        currentWriter?.close()
        print("  System audio recording stopped.")
    }

    // MARK: SCStreamOutput
    func stream(_ stream: SCStream, didOutput sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, recording else { return }

        // Lazily create writer from format description
        if writer == nil {
            guard let formatDesc = sampleBuffer.formatDescription else {
                print("  WARN: No format description")
                return
            }
            guard let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else {
                print("  WARN: No ASBD")
                return
            }
            let asbd = asbdPtr.pointee
            print("  System audio format: \(asbd.mSampleRate)Hz, \(asbd.mChannelsPerFrame)ch, flags=\(asbd.mFormatFlags)")

            writer = AudioFileWriter(path: outputSystemPath, inputFormat: asbd)
            if writer == nil {
                print("  ERROR: Cannot create system audio writer")
                return
            }
        }

        // Extract AudioBufferList from CMSampleBuffer
        var bufferListSize: Int = 0
        var _: CMBlockBuffer?
        var filledSize: Int = 0

        // Get size needed
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &bufferListSize,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: nil
        )

        guard bufferListSize > 0 else { return }

        let bufferList = UnsafeMutablePointer<AudioBufferList>.allocate(capacity: 1)
        defer { bufferList.deallocate() }

        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &filledSize,
            bufferListOut: bufferList,
            bufferListSize: bufferListSize,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: &blockBuffer
        )

        guard status == noErr else {
            // Silently skip - some buffers may not have audio yet
            return
        }

        let frames = UInt32(sampleBuffer.numSamples)
        guard frames > 0 else { return }

        if let writer = writer {
            let writeStatus = writer.write(audioBufferList: UnsafePointer(bufferList), frames: frames)
            if writeStatus != noErr {
                // First write might fail if format mismatch, try again once
                print("  WARN: ExtAudioFileWrite sys error: \(writeStatus)")
            }
        }
    }
}

// MARK: - Status Writer

class StatusWriter {
    let path: String
    let startTime: Date

    init?(sessionDir: String) {
        self.path = (sessionDir as NSString).appendingPathComponent(".status")
        self.startTime = Date()
        let fm = FileManager.default
        let dir = (sessionDir as NSString).deletingLastPathComponent
        if !fm.fileExists(atPath: dir) {
            try? fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        }
        try? "00:00|recording".write(toFile: path, atomically: true, encoding: .utf8)
    }

    func update(state: String) {
        let elapsed = Int(Date().timeIntervalSince(startTime))
        let min = elapsed / 60
        let sec = elapsed % 60
        let elapsedStr = String(format: "%02d:%02d", min, sec)
        try? "\(elapsedStr)|\(state)".write(toFile: path, atomically: true, encoding: .utf8)
    }

    func remove() {
        try? FileManager.default.removeItem(atPath: path)
    }
}

// MARK: - Control Reader

class ControlReader {
    let path: String
    private var lastCmd: String = ""

    init?(sessionDir: String) {
        self.path = (sessionDir as NSString).appendingPathComponent(".control")
    }

    func read() -> String? {
        guard let cmd = try? String(contentsOfFile: path, encoding: .utf8) else {
            return nil
        }
        let trimmed = cmd.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed != lastCmd {
            lastCmd = trimmed
            return trimmed
        }
        return nil
    }

    func clear() {
        lastCmd = ""
        try? FileManager.default.removeItem(atPath: path)
    }
}

// MARK: - Main

let args = parseArgs()
print("MeetingRecorder v2")
print("  Config: \(args)")

let cwd = FileManager.default.currentDirectoryPath
let systemPath = args.outputSystem.hasPrefix("/") ? args.outputSystem : "\(cwd)/\(args.outputSystem)"
let micPath = args.outputMic.hasPrefix("/") ? args.outputMic : "\(cwd)/\(args.outputMic)"
let sessionDir = (systemPath as NSString).deletingLastPathComponent

print("  Output (system): \(systemPath)")
print("  Output (mic):    \(micPath)")
print("  Session dir: \(sessionDir)")

// Initialize status writer
let statusWriter = StatusWriter(sessionDir: sessionDir)

// Initialize control reader
let controlReader = ControlReader(sessionDir: sessionDir)

// State
var running = true
var paused = false

signal(SIGINT) { _ in
    print("\n⏹  Received SIGINT, stopping recording...")
    running = false
}
signal(SIGTERM) { _ in
    print("\n⏹  Received SIGTERM, stopping recording...")
    running = false
}

let semaphore = DispatchSemaphore(value: 0)

Task {
    do {
        // Ensure output directory exists
        let fm = FileManager.default
        let dir = (systemPath as NSString).deletingLastPathComponent
        if !fm.fileExists(atPath: dir) {
            try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        }

        let micRecorder: MicRecorder?
        if args.source == .mic || args.source == .both {
            micRecorder = MicRecorder()
            try micRecorder?.start(outputPath: micPath)
        } else {
            micRecorder = nil
        }

        let sysRecorder: SystemAudioRecorder?
        if args.source == .system || args.source == .both {
            sysRecorder = SystemAudioRecorder()
            try await sysRecorder?.start(outputPath: systemPath)
        } else {
            sysRecorder = nil
        }

        print("\n🎤 Recording started. Use the floating panel to pause/stop.\n")
        statusWriter?.update(state: "recording")

        var tick = 0
        while running {
            try await Task.sleep(nanoseconds: 200_000_000)

            // Check control file every 0.2s
            if let cmd = controlReader?.read() {
                switch cmd {
                case "pause":
                    paused = true
                    micRecorder?.pause()
                    statusWriter?.update(state: "paused")
                    print("⏸  Paused")
                case "resume":
                    paused = false
                    micRecorder?.resume()
                    statusWriter?.update(state: "recording")
                    print("▶️  Resumed")
                case "stop":
                    print("⏹  Stop requested via control file")
                    running = false
                default:
                    break
                }
            }

            // Update status every second (every 5 ticks)
            tick += 1
            if tick % 5 == 0 {
                statusWriter?.update(state: paused ? "paused" : "recording")
            }
        }

        print("\n⏳ Stopping recorders...")
        statusWriter?.update(state: "stopping")
        sysRecorder?.stop()
        micRecorder?.stop()

        // Verify output files
        for path in [systemPath, micPath] {
            if fm.fileExists(atPath: path) {
                let attrs = try fm.attributesOfItem(atPath: path)
                let size = attrs[.size] as? UInt64 ?? 0
                print("  ✅ \(path) — \(size) bytes")
            } else {
                print("  ⚠️  No output: \(path)")
            }
        }

        statusWriter?.update(state: "complete")
        print("\n✅ Recording complete.")
        controlReader?.clear()
        semaphore.signal()
        exit(0)

    } catch {
        print("ERROR: \(error.localizedDescription)")
        statusWriter?.update(state: "error")
        semaphore.signal()
        exit(1)
    }
}

semaphore.wait()
