#!/usr/bin/env swift
// calendar-range.swift — Fetch calendar events in a date range from macOS Calendar
// Usage: swift calendar-range.swift <start-date> <end-date>
//   dates: YYYY-MM-DD format (e.g. 2026-05-14)
// Output: Plain text grouped by calendar, same format as original AppleScript
//
// This replaces the AppleScript-based fetch_calendar_events() in weekly-report
// because AppleScript Calendar iteration hangs on macOS 26+.

import EventKit
import Foundation

// ── Parse args ──
let dateFormatter = DateFormatter()
dateFormatter.dateFormat = "yyyy-MM-dd"
dateFormatter.locale = Locale(identifier: "en_US_POSIX")
dateFormatter.timeZone = TimeZone.current

guard CommandLine.arguments.count >= 3,
      let startDate = dateFormatter.date(from: CommandLine.arguments[1]),
      let endDate = dateFormatter.date(from: CommandLine.arguments[2]) else {
    print("Usage: swift calendar-range.swift <start-date> <end-date>")
    print("  dates: YYYY-MM-DD format")
    exit(1)
}

// End date should be end of day
let endOfDay = Calendar.current.date(bySettingHour: 23, minute: 59, second: 59, of: endDate) ?? endDate

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
var granted = false

// ── Request Calendar access ──
if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { (granted_, error_) in
        granted = granted_
        if let err = error_ {
            print("ERROR=\(err.localizedDescription)")
        }
        semaphore.signal()
    }
} else {
    store.requestAccess(to: .event) { (granted_, error_) in
        granted = granted_
        if let err = error_ {
            print("ERROR=\(err.localizedDescription)")
        }
        semaphore.signal()
    }
}

semaphore.wait()

guard granted else {
    print("__NO_EVENTS__")
    exit(0)
}

// ── Fetch events ──
let predicate = store.predicateForEvents(withStart: startDate, end: endOfDay, calendars: nil)
let events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }

// ── Group by calendar ──
var grouped: [String: [[String: String]]] = [:]

let displayFormatter = DateFormatter()
displayFormatter.dateStyle = .full
displayFormatter.timeStyle = .short
displayFormatter.locale = Locale.current

for event in events {
    let calName = event.calendar.title
    var dict: [String: String] = [:]
    dict["title"] = event.title ?? "(Untitled)"
    dict["startDate"] = displayFormatter.string(from: event.startDate)
    dict["location"] = (event.location ?? "").replacingOccurrences(of: "\n", with: ", ")

    if grouped[calName] == nil {
        grouped[calName] = []
    }
    grouped[calName]?.append(dict)
}

// ── Output text ──
if grouped.isEmpty {
    print("__NO_EVENTS__")
    exit(0)
}

var output = ""
let sortedCalendars = grouped.keys.sorted()
for calName in sortedCalendars {
    output += "  **\(calName)**\n"
    for evt in grouped[calName]! {
        let loc = evt["location"]!.isEmpty ? "" : "  @ \(evt["location"]!)"
        output += "  - \(evt["startDate"]!)  \(evt["title"]!)\(loc)\n"
    }
    output += "\n"
}

print(output, terminator: "")
