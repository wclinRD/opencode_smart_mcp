#!/usr/bin/env swift
/// get-current-events.swift
/// Swift EventKit tool — query Calendar for ongoing + upcoming events
///
/// Usage:
///   swift get-current-events.swift [--lookahead 30]
///
/// Output: JSON to stdout
///
/// macOS 26.5+ with Calendar accessibility permission

import EventKit
import Foundation

// MARK: - Args

let lookaheadMinutes: Int
if CommandLine.arguments.contains("--lookahead"),
   let idx = CommandLine.arguments.firstIndex(of: "--lookahead"),
   idx + 1 < CommandLine.arguments.count,
   let val = Int(CommandLine.arguments[idx + 1]) {
    lookaheadMinutes = val
} else {
    lookaheadMinutes = 30
}

// MARK: - Event Query

let store = EKEventStore()

let semaphore = DispatchSemaphore(value: 0)
var resultJSON: String = ""

if #available(macOS 14.0, *) {
    Task {
        do {
            let granted = try await store.requestFullAccessToEvents()
            guard granted else {
                resultJSON = """
                { "found": false, "error": "Calendar access denied" }
                """
                semaphore.signal()
                return
            }
            fetchEvents(store: store, lookaheadMinutes: lookaheadMinutes) { json in
                resultJSON = json
                semaphore.signal()
            }
        } catch {
            resultJSON = """
            { "found": false, "error": "Authorization error: \(error.localizedDescription)" }
            """
            semaphore.signal()
        }
    }
} else {
    store.requestAccess(to: .event) { granted, error in
        guard granted else {
            resultJSON = """
            { "found": false, "error": "Calendar access denied" }
            """
            semaphore.signal()
            return
        }
        fetchEvents(store: store, lookaheadMinutes: lookaheadMinutes) { json in
            resultJSON = json
            semaphore.signal()
        }
    }
}

semaphore.wait()
print(resultJSON)

// MARK: - Fetch Logic

func fetchEvents(store: EKEventStore, lookaheadMinutes: Int, completion: @escaping (String) -> Void) {
    let now = Date()
    let searchEnd = now.addingTimeInterval(TimeInterval(lookaheadMinutes * 60))
    let searchPast = now.addingTimeInterval(-2 * 60 * 60) // 2 hours back for ongoing

    // Get all calendars, skip non-event types
    let calendars = store.calendars(for: .event).filter { cal in
        let skipNames: Set<String> = [
            "生日", "台灣節日", "台灣假日", "Siri建議",
            "已排程的提醒事項", "2025農曆提醒", "股市配息日"
        ]
        return !skipNames.contains(cal.title)
    }

    let predicate = store.predicateForEvents(withStart: searchPast, end: searchEnd, calendars: calendars)
    let events = store.events(matching: predicate)

    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_TW")
    formatter.dateStyle = .full
    formatter.timeStyle = .medium

    let isoFormatter = ISO8601DateFormatter()

    var meetingList: [[String: Any]] = []

    for evt in events {
        guard let title = evt.title, !title.isEmpty else { continue }

        var status: String
        let minutesUntilStart = Int(evt.startDate.timeIntervalSince(now) / 60)
        let minutesRemaining = Int(evt.endDate.timeIntervalSince(now) / 60)

        if evt.startDate <= now && evt.endDate >= now {
            status = "ongoing"
        } else if evt.startDate > now {
            status = "upcoming"
        } else {
            status = "past"
        }

        let meeting: [String: Any] = [
            "title": title,
            "start": isoFormatter.string(from: evt.startDate),
            "end": isoFormatter.string(from: evt.endDate),
            "start_raw": formatter.string(from: evt.startDate),
            "end_raw": formatter.string(from: evt.endDate),
            "location": evt.location ?? "",
            "status": status,
            "minutes_until_start": max(0, minutesUntilStart),
            "minutes_remaining": max(0, minutesRemaining),
            "calendar": evt.calendar.title
        ]
        meetingList.append(meeting)
    }

    // Sort: ongoing first, then upcoming by start time
    meetingList.sort { a, b in
        let aStatus = a["status"] as! String
        let bStatus = b["status"] as! String
        if aStatus == "ongoing" && bStatus != "ongoing" { return true }
        if bStatus == "ongoing" && aStatus != "ongoing" { return false }
        return (a["minutes_until_start"] as! Int) < (b["minutes_until_start"] as! Int)
    }

    let result: [String: Any] = [
        "found": !meetingList.isEmpty,
        "current_time": isoFormatter.string(from: now),
        "lookahead_minutes": lookaheadMinutes,
        "meetings": meetingList,
        "primary_meeting": meetingList.first as Any
    ]

    if let jsonData = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .withoutEscapingSlashes]),
       let jsonStr = String(data: jsonData, encoding: .utf8) {
        completion(jsonStr)
    } else {
        completion(#"{ "found": false, "error": "JSON serialization failed" }"#)
    }
}
