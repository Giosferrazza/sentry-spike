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
    let delta: Int? // vs yesterday; nil if either day is empty (mirrors analytics.ts)
}

// Today's score, same as the Home card (lifeScore(..., days = 1)).
func lifeScore(_ tallies: [Date: Tally], now: Date) -> LifeScore {
    let cal = Calendar.current
    let today = cal.startOfDay(for: now)
    let yesterday = cal.date(byAdding: .day, value: -1, to: today)!
    let cur = tallies[today] ?? Tally()
    let prev = tallies[yesterday] ?? Tally()
    // Wins vs slips, Laplace-smoothed, plus the one "woke up" win every day
    // starts with (mirrors scoreOf and lifeScore in analytics.ts).
    func score(_ t: Tally) -> Int { Int((100.0 * (t.wins + 2) / (t.wins + 1 + t.slips + 2)).rounded()) }
    let s = score(cur)
    let hasCur = cur.wins + cur.slips > 0, hasPrev = prev.wins + prev.slips > 0
    return LifeScore(score: s, delta: hasCur && hasPrev ? s - score(prev) : nil)
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
            Text("Open Sentry to start")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Palette.primary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    func content(_ snap: Snapshot) -> some View {
        let tallies = dailyTallies(snap)
        let life = lifeScore(tallies, now: entry.date)

        HStack(alignment: .center, spacing: 14) {
            VStack(spacing: 2) {
                // Overline, same as T.overline in the app.
                Text("TODAY'S LIFE SCORE")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(Palette.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                ScoreDial(score: life.score)
                    .frame(width: 84, height: 72)
                if let d = life.delta, d != 0 {
                    Text("\(d > 0 ? "+" : "−")\(abs(d)) vs yesterday")
                        .font(.system(size: 11))
                        .monospacedDigit()
                        .foregroundStyle(Palette.secondary)
                        .lineLimit(1)
                }
            }
            .frame(width: 112)

            HeatGrid(tallies: tallies, now: entry.date)
        }
    }
}

// A small version of the app's Dial (src/components/dial.tsx): a 240° arc on
// the track color, filled up to the score in each band's zone color, with the
// number in the middle.
struct ScoreDial: View {
    let score: Int
    private let sweep = 240.0 / 360.0
    private let line: CGFloat = 7
    private let needle: CGFloat = 22
    // Band edges and colors, same as zoneColor() in dial.tsx.
    private let zones: [(from: Double, to: Double, color: Color)] = [
        (0, 40, Palette.avoid), (40, 60, Palette.even), (60, 80, Palette.seek1), (80, 100, Palette.seek),
    ]

    var body: some View {
        ZStack {
            arc(0, 1).stroke(Palette.track, style: StrokeStyle(lineWidth: line, lineCap: .round))
            ForEach(zones.indices, id: \.self) { i in
                let z = zones[i]
                let end = min(Double(score), z.to)
                if end > z.from {
                    arc(z.from / 100, end / 100).stroke(z.color, style: StrokeStyle(lineWidth: line, lineCap: .butt))
                }
            }
            // Needle and hub, like the app's Dial. 0° is straight up; the
            // sweep runs -120°...+120° (angleOf in dial.tsx).
            Capsule()
                .fill(Palette.primary)
                .frame(width: 3, height: needle)
                .offset(y: -needle / 2)
                .rotationEffect(.degrees(-120 + 240 * Double(score) / 100))
                .shadow(color: Palette.primary.opacity(0.5), radius: 3)
            Circle()
                .fill(Palette.primary)
                .frame(width: 11, height: 11)
                .overlay(Circle().fill(Palette.track).frame(width: 4, height: 4))
            // The number sits in the arc's open gap under the hub.
            Text("\(score)")
                .font(.system(size: 18, weight: .bold))
                .tracking(-0.5)
                .monospacedDigit()
                .foregroundStyle(Palette.primary)
                .contentTransition(.numericText())
                .offset(y: 23)
        }
    }

    // Trim runs clockwise from 3 o'clock; rotating 150° starts the arc at
    // lower left so it opens at the bottom, like the app's dial.
    private func arc(_ from: Double, _ to: Double) -> some Shape {
        Circle()
            .inset(by: line / 2)
            .trim(from: from * sweep, to: to * sweep)
            .rotation(.degrees(150))
    }
}

// A rolling window of as many full 7-day columns as fit, oldest top-left,
// today in the bottom-right cell (no half-empty current-week column).
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
            let start = cal.date(byAdding: .day, value: -(weeks * 7 - 1), to: today)!

            HStack(spacing: gap) {
                ForEach(0..<weeks, id: \.self) { w in
                    VStack(spacing: gap) {
                        ForEach(0..<7, id: \.self) { d in
                            let day = cal.date(byAdding: .day, value: w * 7 + d, to: start)!
                            RoundedRectangle(cornerRadius: 2)
                                .fill(heatColor(tallies[day]))
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
