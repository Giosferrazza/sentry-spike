import WidgetKit
import SwiftUI

// MARK: - Shared data

// Must match APP_GROUP in src/lib/widget.ts.
let appGroup = "group.com.giosferrazza.sentryspike"

struct Snapshot: Codable {
    struct Entry: Codable {
        let ts: Double // epoch ms
        let kind: String // "avoid" | "seek"
        let name: String
    }
    let monitoring: Bool
    let fenceCount: Int
    let entries: [Entry] // newest first, last ~8 days

    static func load() -> Snapshot? {
        guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: "snapshot"),
              let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    // Shown in the widget gallery before the app has synced real data.
    static let sample: Snapshot = {
        let now = Date().timeIntervalSince1970 * 1000
        var entries: [Entry] = []
        for i in 0..<12 {
            let ts: Double = now - Double(i) * 50_000_000
            let seek: Bool = i % 4 == 0
            entries.append(Entry(ts: ts, kind: seek ? "seek" : "avoid", name: seek ? "Gym" : "Taco Bell"))
        }
        return Snapshot(monitoring: true, fenceCount: 4, entries: entries)
    }()
}

struct Day {
    let label: String
    let isToday: Bool
    var avoid = 0
    var seek = 0
    var total: Int { avoid + seek }
}

// Buckets are computed at render time so the chart rolls over at midnight
// even if the app hasn't run.
func lastSevenDays(_ snap: Snapshot, now: Date) -> [Day] {
    let cal = Calendar.current
    let today = cal.startOfDay(for: now)
    let fmt = DateFormatter()
    fmt.dateFormat = "EEEEE" // M T W T F S S
    var days = (0..<7).reversed().map { back -> Day in
        let d = cal.date(byAdding: .day, value: -back, to: today)!
        return Day(label: fmt.string(from: d), isToday: back == 0)
    }
    for e in snap.entries {
        let day = cal.startOfDay(for: Date(timeIntervalSince1970: e.ts / 1000))
        guard let back = cal.dateComponents([.day], from: day, to: today).day, back >= 0, back < 7 else { continue }
        if e.kind == "seek" { days[6 - back].seek += 1 } else { days[6 - back].avoid += 1 }
    }
    return days
}

// MARK: - Timeline

struct SentryEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SentryEntry {
        SentryEntry(date: Date(), snapshot: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (SentryEntry) -> Void) {
        // Widget gallery preview: show sample data if the app hasn't synced yet.
        completion(SentryEntry(date: Date(), snapshot: Snapshot.load() ?? .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SentryEntry>) -> Void) {
        let now = Date()
        let snap = Snapshot.load()
        // Re-render at midnight so the 7-day window shifts; the app also
        // reloads the widget whenever the log or fences change.
        let midnight = Calendar.current.nextDate(
            after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime
        ) ?? now.addingTimeInterval(3600)
        completion(Timeline(
            entries: [SentryEntry(date: now, snapshot: snap), SentryEntry(date: midnight, snapshot: snap)],
            policy: .after(midnight.addingTimeInterval(60))
        ))
    }
}

// MARK: - View

enum Palette {
    static let avoid = Color(red: 0xd9 / 255, green: 0x59 / 255, blue: 0x26 / 255)
    static let seek = Color(red: 0x39 / 255, green: 0x87 / 255, blue: 0xe5 / 255)
    static let primary = Color(red: 0xf3 / 255, green: 0xf5 / 255, blue: 0xf8 / 255)
    static let secondary = Color(red: 0x8b / 255, green: 0x93 / 255, blue: 0xa3 / 255)
    static let muted = Color(red: 0x5a / 255, green: 0x61 / 255, blue: 0x72 / 255)
    static let grid = Color(red: 0x26 / 255, green: 0x2b / 255, blue: 0x38 / 255)
}

struct SentryWidgetView: View {
    let entry: SentryEntry

    var body: some View {
        if let snap = entry.snapshot {
            content(snap)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                header(monitoring: false, fenceCount: 0)
                Spacer()
                Text("Open Sentry to start")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.primary)
                Text("Draw a fence and your week shows up here.")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    func content(_ snap: Snapshot) -> some View {
        let days = lastSevenDays(snap, now: entry.date)
        let avoid = days.reduce(0) { $0 + $1.avoid }
        let seek = days.reduce(0) { $0 + $1.seek }

        VStack(alignment: .leading, spacing: 0) {
            header(monitoring: snap.monitoring, fenceCount: snap.fenceCount)
                .padding(.bottom, 6)

            HStack(alignment: .bottom, spacing: 16) {
                // Left: this week's headline
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(avoid + seek)")
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .foregroundStyle(Palette.primary)
                        .contentTransition(.numericText())
                    Text("entries · 7 days")
                        .font(.system(size: 12))
                        .foregroundStyle(Palette.secondary)
                    HStack(spacing: 10) {
                        legend(Palette.avoid, "\(avoid) stay out")
                        legend(Palette.seek, "\(seek) go")
                    }
                    .padding(.top, 6)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Right: 7-day stacked columns
                WeekChart(days: days)
                    .frame(maxWidth: .infinity)
            }

            Spacer(minLength: 6)

            lastLine(snap)
        }
    }

    func header(monitoring: Bool, fenceCount: Int) -> some View {
        HStack(spacing: 6) {
            Text("SENTRY")
                .font(.system(size: 11, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(Palette.secondary)
            Spacer()
            Circle()
                .fill(monitoring ? Palette.primary : Palette.muted)
                .frame(width: 6, height: 6)
            Text(monitoring ? "Watching \(fenceCount)" : "Paused")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Palette.secondary)
        }
    }

    func legend(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 8, height: 8)
            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Palette.secondary)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    func lastLine(_ snap: Snapshot) -> some View {
        if let last = snap.entries.first {
            let when = Date(timeIntervalSince1970: last.ts / 1000)
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(last.kind == "seek" ? Palette.seek : Palette.avoid)
                    .frame(width: 8, height: 8)
                Text("Last: \(last.name)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.primary)
                    .lineLimit(1)
                Text(when, format: Calendar.current.isDateInToday(when)
                     ? .dateTime.hour().minute()
                     : .dateTime.weekday(.abbreviated).hour().minute())
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
            }
        } else {
            Text("No entries yet")
                .font(.system(size: 12))
                .foregroundStyle(Palette.muted)
        }
    }
}

struct WeekChart: View {
    let days: [Day]
    private let plotHeight: CGFloat = 58

    var body: some View {
        let peak = max(1, days.map(\.total).max() ?? 1)
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                VStack(spacing: 4) {
                    column(day, peak: peak)
                        .frame(height: plotHeight, alignment: .bottom)
                    Text(day.label)
                        .font(.system(size: 10, weight: day.isToday ? .bold : .regular))
                        .foregroundStyle(day.isToday ? Palette.primary : Palette.muted)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .overlay(alignment: .bottom) {
            // Baseline hairline, sitting under the columns above the labels.
            Rectangle().fill(Palette.grid).frame(height: 1).padding(.bottom, 16)
        }
    }

    // Stay out stacked on top of go here, 2pt surface gap, rounded top only.
    @ViewBuilder
    func column(_ day: Day, peak: Int) -> some View {
        let unit = plotHeight / CGFloat(peak)
        VStack(spacing: day.avoid > 0 && day.seek > 0 ? 2 : 0) {
            if day.avoid > 0 {
                UnevenRoundedRectangle(topLeadingRadius: 3, topTrailingRadius: 3)
                    .fill(Palette.avoid)
                    .frame(height: max(3, CGFloat(day.avoid) * unit - (day.seek > 0 ? 2 : 0)))
            }
            if day.seek > 0 {
                UnevenRoundedRectangle(
                    topLeadingRadius: day.avoid > 0 ? 0 : 3,
                    topTrailingRadius: day.avoid > 0 ? 0 : 3
                )
                .fill(Palette.seek)
                .frame(height: max(3, CGFloat(day.seek) * unit))
            }
        }
        .frame(width: 12)
    }
}

// MARK: - Widget

struct SentryWidget: Widget {
    let kind = "SentryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            SentryWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    Color("$widgetBackground")
                }
        }
        .configurationDisplayName("Sentry")
        .description("Your week of fence entries at a glance.")
        .supportedFamilies([.systemMedium])
    }
}

#Preview(as: .systemMedium) {
    SentryWidget()
} timeline: {
    SentryEntry(date: .now, snapshot: .sample)
    SentryEntry(date: .now, snapshot: nil)
}
