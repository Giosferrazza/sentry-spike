import ActivityKit
import ExpoModulesCore

// Must match SentryInterventionAttributes in targets/widget/live-activity.swift
// field for field: ActivityKit pairs the app and the widget by type name.
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
  // Deep links into the app (scheme differs between Sentry and Sentry Dev).
  var openUrl: String
  var timerUrl: String
  var okayUrl: String
}

struct StartArgs: Record {
  @Field var interventionId: String = ""
  @Field var placeName: String = ""
  @Field var openUrl: String = ""
  @Field var timerUrl: String = ""
  @Field var okayUrl: String = ""
}

struct StateArgs: Record {
  @Field var phase: String = "arrived"
  @Field var enteredAt: Double = 0 // epoch ms
  @Field var timerStartedAt: Double? = nil
  @Field var timerEndsAt: Double? = nil
  @Field var message: String = ""
  @Field var streakDays: Int = 0

  var content: SentryInterventionAttributes.ContentState {
    let date = { (ms: Double) in Date(timeIntervalSince1970: ms / 1000) }
    return .init(
      phase: phase,
      enteredAt: date(enteredAt),
      timerStartedAt: timerStartedAt.map(date),
      timerEndsAt: timerEndsAt.map(date),
      message: message,
      streakDays: streakDays
    )
  }
}

// JS side: src/lib/live-activity.ts. One Live Activity per intervention.
public class LiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) { return ActivityAuthorizationInfo().areActivitiesEnabled }
      return false
    }

    // Start, or update if this intervention already has one. Ends any other
    // intervention's activity. iOS only allows starting while the app is in
    // the foreground (throws otherwise); updates work from the background.
    AsyncFunction("start") { (args: StartArgs, state: StateArgs) async throws in
      guard #available(iOS 16.2, *) else { return }
      let content = ActivityContent(state: state.content, staleDate: nil)
      var found = false
      for activity in Activity<SentryInterventionAttributes>.activities {
        if activity.attributes.interventionId == args.interventionId {
          found = true
          await activity.update(content)
        } else {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
      if found { return }
      let attrs = SentryInterventionAttributes(
        interventionId: args.interventionId,
        placeName: args.placeName,
        openUrl: args.openUrl,
        timerUrl: args.timerUrl,
        okayUrl: args.okayUrl
      )
      _ = try Activity.request(attributes: attrs, content: content, pushType: nil)
    }

    // Final state, then dismiss after `dismissAfter` seconds (0 = now).
    AsyncFunction("end") { (interventionId: String, state: StateArgs?, dismissAfter: Double) async in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<SentryInterventionAttributes>.activities
      where activity.attributes.interventionId == interventionId {
        let content = state.map { ActivityContent(state: $0.content, staleDate: nil) }
        let policy: ActivityUIDismissalPolicy =
          dismissAfter > 0 ? .after(Date().addingTimeInterval(dismissAfter)) : .immediate
        await activity.end(content, dismissalPolicy: policy)
      }
    }
  }
}
