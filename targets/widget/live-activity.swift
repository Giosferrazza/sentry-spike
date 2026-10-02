import ActivityKit
import SwiftUI
import WidgetKit

// Must match SentryInterventionAttributes in
// modules/live-activity/ios/LiveActivityModule.swift field for field.
struct SentryInterventionAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var phase: String // approach | arrived | timer | stayed | left
        var enteredAt: Date
        var timerStartedAt: Date?
        var timerEndsAt: Date?
        var message: String
        var streakDays: Int
    }

    var interventionId: String
    var placeName: String
    var openUrl: String
    var timerUrl: String
    var okayUrl: String
}

// The intervention on the Lock Screen and Dynamic Island. The Lock Screen view
// uses the full height iOS allows (~160pt), about a medium widget.
struct SentryInterventionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SentryInterventionAttributes.self) { context in
            LockScreenIntervention(attrs: context.attributes, state: context.state)
                .activityBackgroundTint(Palette.hex(0x0f1115))
                .activitySystemActionForegroundColor(Palette.primary)
                .widgetURL(URL(string: context.attributes.openUrl))
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(context.attributes.placeName)
                            .font(.system(size: 15, weight: .semibold))
                            .lineLimit(1)
                    } icon: {
                        Image(systemName: phaseIcon(s.phase)).foregroundStyle(phaseColor(s.phase))
                    }
                    .foregroundStyle(Palette.primary)
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Clock(state: s, size: 22)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(s.message)
                            .font(.system(size: 13))
                            .foregroundStyle(Palette.secondary)
                            .lineLimit(2)
                        ActionRow(attrs: context.attributes, state: s)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: phaseIcon(s.phase)).foregroundStyle(phaseColor(s.phase))
            } compactTrailing: {
                Clock(state: s, size: 14)
                    .frame(maxWidth: 48)
            } minimal: {
                Image(systemName: phaseIcon(s.phase)).foregroundStyle(phaseColor(s.phase))
            }
            .widgetURL(URL(string: context.attributes.openUrl))
            .keylineTint(Palette.avoid)
        }
    }
}

struct LockScreenIntervention: View {
    let attrs: SentryInterventionAttributes
    let state: SentryInterventionAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Overline + streak at stake.
            HStack(spacing: 6) {
                Image(systemName: phaseIcon(state.phase))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(phaseColor(state.phase))
                Text(overline(state.phase))
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(Palette.muted)
                Spacer()
                if state.streakDays > 0 {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(Palette.hex(0xf5a524))
                    Text("\(state.streakDays) \(state.streakDays == 1 ? "day" : "days") clean")
                        .font(.system(size: 12, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(Palette.secondary)
                }
            }

            HStack(alignment: .firstTextBaseline) {
                Text(attrs.placeName)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Palette.primary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Clock(state: state, size: 28)
            }

            if state.phase == "timer", let start = state.timerStartedAt, let end = state.timerEndsAt, end > start {
                ProgressView(timerInterval: start...end, countsDown: true) { EmptyView() } currentValueLabel: { EmptyView() }
                    .tint(Palette.seek)
            }

            Text(state.message)
                .font(.system(size: 13))
                .foregroundStyle(Palette.secondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            ActionRow(attrs: attrs, state: state)
        }
        .padding(16)
    }
}

// Time here (counting up), the exit countdown, or a check once you've left.
struct Clock: View {
    let state: SentryInterventionAttributes.ContentState
    let size: CGFloat

    var body: some View {
        Group {
            if state.phase == "left" {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.seek)
            } else if state.phase == "timer", let start = state.timerStartedAt, let end = state.timerEndsAt {
                Text(timerInterval: start...end, countsDown: true)
                    .foregroundStyle(Palette.primary)
            } else {
                Text(state.enteredAt, style: .timer)
                    .foregroundStyle(state.phase == "stayed" ? Palette.avoid : Palette.primary)
            }
        }
        .font(.system(size: size, weight: .bold))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .lineLimit(1)
    }
}

// Buttons open the app on the Intervention screen (and act on arrival there).
struct ActionRow: View {
    let attrs: SentryInterventionAttributes
    let state: SentryInterventionAttributes.ContentState

    var body: some View {
        HStack(spacing: 8) {
            if state.phase == "arrived" || state.phase == "stayed" {
                pill(state.phase == "stayed" ? "Another 10 min" : "Start 10 min timer", icon: "timer",
                     url: attrs.timerUrl, primary: true)
            }
            if state.phase != "left" {
                pill("Talk to Sentry", icon: "bubble.left.fill", url: attrs.openUrl, primary: state.phase == "timer")
                pill("I'm okay", icon: "checkmark", url: attrs.okayUrl, primary: false)
            }
        }
    }

    @ViewBuilder
    func pill(_ label: String, icon: String, url: String, primary: Bool) -> some View {
        if let dest = URL(string: url) {
            Link(destination: dest) {
                HStack(spacing: 5) {
                    Image(systemName: icon).font(.system(size: 11, weight: .semibold))
                    Text(label).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                }
                .foregroundStyle(primary ? Palette.hex(0x0f1115) : Palette.primary)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .frame(maxWidth: primary ? .infinity : nil)
                .background(primary ? Palette.primary : Palette.track, in: Capsule())
            }
        }
    }
}

func phaseIcon(_ phase: String) -> String {
    switch phase {
    case "left": return "checkmark.seal.fill"
    case "timer": return "timer"
    case "stayed": return "exclamationmark.circle.fill"
    case "approach": return "arrow.uturn.backward.circle.fill"
    default: return "shield.lefthalf.filled"
    }
}

func phaseColor(_ phase: String) -> Color {
    phase == "left" ? Palette.seek : Palette.avoid
}

func overline(_ phase: String) -> String {
    switch phase {
    case "left": return "BOUNDARY KEPT"
    case "timer": return "EXIT TIMER"
    case "stayed": return "TIME'S UP"
    case "approach": return "HEADING TOWARD · ON THE WAY"
    default: return "STAY OUT · HERE FOR"
    }
}
