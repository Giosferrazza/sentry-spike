import AppIntents
import ExpoModulesCore
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
#endif

// Full-screen interjection via AlarmKit (iOS 26): rings like a Clock alarm,
// through silent mode and Focus, when you approach or enter a Stay Out place.
// JS side: src/lib/alarm.ts.

// "Talk to Sentry" on the alarm: opens the app, which jumps to the newest
// unseen intervention (useAutoIntervention in the root layout).
struct OpenSentryIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Talk to Sentry"
  static var openAppWhenRun: Bool = true
  static var isDiscoverable: Bool = false

  func perform() async throws -> some IntentResult { .result() }
}

#if canImport(AlarmKit)
@available(iOS 26.0, *)
struct SentryAlarmMetadata: AlarmMetadata {}
#endif

public class SentryAlarmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SentryAlarm")

    // "unsupported" | "notDetermined" | "denied" | "authorized"
    Function("authorization") { () -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return Self.label(AlarmManager.shared.authorizationState) }
      #endif
      return "unsupported"
    }

    // Must be called while the app is in the foreground.
    AsyncFunction("requestAuthorization") { () async -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let state = (try? await AlarmManager.shared.requestAuthorization()) ?? .denied
        return Self.label(state)
      }
      #endif
      return "unsupported"
    }

    // Ring now. Returns the alarm id, or nil if AlarmKit isn't available.
    AsyncFunction("ring") { (title: String) async throws -> String? in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let talk = AlarmButton(text: "Talk to Sentry", textColor: .white, systemImageName: "bubble.left.fill")
        let alert: AlarmPresentation.Alert
        if #available(iOS 26.1, *) {
          // 26.1+: the system provides the Stop control.
          alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: title),
            secondaryButton: talk,
            secondaryButtonBehavior: .custom
          )
        } else {
          alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: title),
            stopButton: AlarmButton(text: "I'm leaving", textColor: .white, systemImageName: "figure.walk"),
            secondaryButton: talk,
            secondaryButtonBehavior: .custom
          )
        }
        let attributes = AlarmAttributes<SentryAlarmMetadata>(
          presentation: AlarmPresentation(alert: alert),
          metadata: SentryAlarmMetadata(),
          tintColor: Color(red: 0xd9 / 255, green: 0x59 / 255, blue: 0x26 / 255)
        )
        let id = UUID()
        _ = try await AlarmManager.shared.schedule(
          id: id,
          configuration: .alarm(
            schedule: .fixed(Date().addingTimeInterval(1)),
            attributes: attributes,
            secondaryIntent: OpenSentryIntent()
          )
        )
        return id.uuidString
      }
      #endif
      return nil
    }

    Function("cancel") { (id: String) in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *), let uuid = UUID(uuidString: id) {
        try? AlarmManager.shared.cancel(id: uuid)
      }
      #endif
    }
  }

  #if canImport(AlarmKit)
  @available(iOS 26.0, *)
  static func label(_ s: AlarmManager.AuthorizationState) -> String {
    switch s {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "denied"
    }
  }
  #endif
}
