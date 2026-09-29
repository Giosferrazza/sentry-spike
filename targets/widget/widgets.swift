import WidgetKit
import SwiftUI

// MARK: - Shared data

// "group.<app bundle id>", matching APP_GROUP in src/lib/widget.ts. The
// widget's own ID is "<app bundle id>.widget", so this works for both the
// Sentry and Sentry Dev variants.
let appGroup: String = {
    let id = Bundle.main.bundleIdentifier ?? "com.giosferrazza.sentryspike.widget"
    let app = id.hasSuffix(".widget") ? String(id.dropLast(".widget".count)) : id
    return "group.\(app)"
}()

struct Snapshot: Codable {
    struct Entry: Codable {
        let ts: Double // epoch ms
        let kind: String // "avoid" | "seek"
        let name: String
    }
    // Per local day; t = local midnight, epoch ms. s/a = go-here/stay-out
    // visits (heatmap); w/l = wins/slips for the Life Score (absent in
    // snapshots from older app builds, which fall back to s/a).
    struct DayCount: Codable {
        let t: Double
        let s: Int
        let a: Int
        let w: Double?
        let l: Double?
    }
    let monitoring: Bool
    let fenceCount: Int
    let entries: [Entry] // newest first, last ~8 days
    let days: [DayCount]? // last ~16 weeks; absent in snapshots from older app builds

    static func load() -> Snapshot? {
        guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: "snapshot"),
              let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    // Shown in the widget gallery before the app has synced real data.
    static let sample: Snapshot = {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        var days: [DayCount] = []
        for back in 0..<100 {
            let seed = (back * 7 + 3) % 11
            if seed < 4 { continue }
            let t = cal.date(byAdding: .day, value: -back, to: today)!.timeIntervalSince1970 * 1000
            let s = seed % 3, a = seed % 4 == 0 ? 2 : seed % 2
            days.append(DayCount(t: t, s: s, a: a, w: Double(s), l: Double(a)))
        }
        let last = Entry(ts: Date().addingTimeInterval(-3_600).timeIntervalSince1970 * 1000, kind: "seek", name: "Gym")
        return Snapshot(monitoring: true, fenceCount: 4, entries: [last], days: days)
    }()
}

struct Tally {
    var seek = 0
    var avoid = 0
    var wins = 0.0
    var slips = 0.0
    var total: Int { seek + avoid }
}

func dailyTallies(_ snap: Snapshot) -> [Date: Tally] {
    var out: [Date: Tally] = [:]
    let cal = Calendar.current
    for d in snap.days ?? [] {
        let day = cal.startOfDay(for: Date(timeIntervalSince1970: d.t / 1000))
        out[day, default: Tally()].seek += d.s
        out[day, default: Tally()].avoid += d.a
        out[day, default: Tally()].wins += d.w ?? Double(d.s)
        out[day, default: Tally()].slips += d.l ?? Double(d.a)
    }
    return out
}

// MARK: - Life score (wins vs slips; mirrors lifeScore() in src/lib/analytics.ts)

struct LifeScore {
    let score: Int
    let band: String
    let delta: Int?
}

func lifeScore(_ tallies: [Date: Tally], now: Date) -> LifeScore {
    let cal = Calendar.current
    let today = cal.startOfDay(for: now)
    var cur = Tally(), prev = Tally()
    for (day, t) in tallies {
        guard let age = cal.dateComponents([.day], from: day, to: today).day else { continue }
        if age >= 0 && age < 7 { cur.wins += t.wins; cur.slips += t.slips }
        else if age >= 7 && age < 14 { prev.wins += t.wins; prev.slips += t.slips }
    }
    // Wins vs slips, Laplace-smoothed (mirrors scoreOf in analytics.ts).
    func score(_ t: Tally) -> Int { Int((100.0 * (t.wins + 1) / (t.wins + t.slips + 2)).rounded()) }
    let s = score(cur)
    let band = s >= 80 ? "Thriving" : s >= 60 ? "On track" : s >= 40 ? "Mixed" : "Rough week"
    return LifeScore(score: s, band: band, delta: prev.wins + prev.slips > 0 ? s - score(prev) : nil)
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
        completion(SentryEntry(date: Date(), snapshot: Snapshot.load() ?? .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SentryEntry>) -> Void) {
        let now = Date()
        let snap = Snapshot.load()
        // Re-render at midnight so the score window and heatmap shift; the app
        // also reloads the widget whenever the log or fences change.
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
    static func hex(_ v: UInt32) -> Color {
        Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
    static let avoid = hex(0xd95926)
    static let seek = hex(0x3987e5)
    static let primary = hex(0xf3f5f8)
    static let secondary = hex(0x8b93a3)
    static let muted = hex(0x5a6172)
    static let track = hex(0x1d212c)
    // Heatmap steps, same as HEAT in src/components/charts.tsx.
    static let seek1 = hex(0x275083)
    static let even = hex(0x454b5a)
    static let avoid1 = hex(0x773924)
}

func heatColor(_ t: Tally?) -> Color {
    guard let t, t.total > 0 else { return Palette.track }
    let net = t.seek - t.avoid
    if net == 0 { return Palette.even }
    if net > 0 { return net >= 2 ? Palette.seek : Palette.seek1 }
    return -net >= 2 ? Palette.avoid : Palette.avoid1
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
                Text("Draw a fence and your Life Score shows up here.")
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    func content(_ snap: Snapshot) -> some View {
        let tallies = dailyTallies(snap)
        let life = lifeScore(tallies, now: entry.date)

        VStack(alignment: .leading, spacing: 0) {
            header(monitoring: snap.monitoring, fenceCount: snap.fenceCount)
                .padding(.bottom, 8)

            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("LIFE SCORE")
                        .font(.system(size: 9, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(Palette.muted)
                    Text("\(life.score)")
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                        .foregroundStyle(Palette.primary)
                        .contentTransition(.numericText())
                    Text(life.band)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.primary)
                        .lineLimit(1)
                    Text(deltaText(life.delta))
                        .font(.system(size: 11))
                        .foregroundStyle(Palette.secondary)
                        .lineLimit(1)
                }
                .frame(width: 96, alignment: .leading)

                HeatGrid(tallies: tallies, now: entry.date)
            }

            Spacer(minLength: 6)
            lastLine(snap)
        }
    }

    func deltaText(_ d: Int?) -> String {
        guard let d else { return "First week" }
        if d == 0 { return "Same as last week" }
        return "\(d > 0 ? "+" : "−")\(abs(d)) vs last week"
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
            Text("No visits this week")
                .font(.system(size: 12))
                .foregroundStyle(Palette.muted)
        }
    }
}

// As many weeks as fit, newest column on the right, rows Sun..Sat.
struct HeatGrid: View {
    let tallies: [Date: Tally]
    let now: Date
    private let gap: CGFloat = 2.5

    var body: some View {
        GeometryReader { geo in
            let cell = floor((geo.size.height - gap * 6) / 7)
            let weeks = max(1, min(16, Int((geo.size.width + gap) / (cell + gap))))
            let cal = Calendar.current
            let today = cal.startOfDay(for: now)
            let weekday = cal.component(.weekday, from: today) - 1 // 0 = Sunday
            let start = cal.date(byAdding: .day, value: -weekday - (weeks - 1) * 7, to: today)!

            HStack(spacing: gap) {
                ForEach(0..<weeks, id: \.self) { w in
                    VStack(spacing: gap) {
                        ForEach(0..<7, id: \.self) { d in
                            let day = cal.date(byAdding: .day, value: w * 7 + d, to: start)!
                            RoundedRectangle(cornerRadius: 2)
                                .fill(day > today ? Color.clear : heatColor(tallies[day]))
                                .frame(width: cell, height: cell)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
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
        .description("Your Life Score and visit history at a glance.")
        .supportedFamilies([.systemMedium])
    }
}

#Preview(as: .systemMedium) {
    SentryWidget()
} timeline: {
    SentryEntry(date: .now, snapshot: .sample)
    SentryEntry(date: .now, snapshot: nil)
}
