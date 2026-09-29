import ExpoModulesCore
import MapKit

// Apple Maps search for the Map tab: MKLocalSearchCompleter for
// suggestions as you type, MKLocalSearch to turn a pick into coordinates.
// Runs on-device through Apple, no key and no rate limits.
public class PlaceSearchModule: Module {
  private lazy var completer = Completer()

  public func definition() -> ModuleDefinition {
    Name("PlaceSearch")

    // Suggestions for a partial query, biased toward the visible map region.
    AsyncFunction("complete") { (query: String, region: Region, promise: Promise) in
      self.completer.query(query, region: region.mk, promise: promise)
    }.runOnQueue(.main)

    // Coordinates for a suggestion the user picked.
    AsyncFunction("resolve") { (title: String, subtitle: String, region: Region, promise: Promise) in
      let request: MKLocalSearch.Request
      if let hit = self.completer.latest.first(where: { $0.title == title && $0.subtitle == subtitle }) {
        request = MKLocalSearch.Request(completion: hit)
      } else {
        request = MKLocalSearch.Request()
        request.naturalLanguageQuery = subtitle.isEmpty ? title : "\(title), \(subtitle)"
      }
      request.region = region.mk
      MKLocalSearch(request: request).start { response, error in
        guard let item = response?.mapItems.first else {
          promise.resolve(nil)
          return
        }
        let c = item.placemark.coordinate
        promise.resolve([
          "title": item.name ?? title,
          "subtitle": subtitle,
          "latitude": c.latitude,
          "longitude": c.longitude,
        ])
      }
    }.runOnQueue(.main)
  }
}

struct Region: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  @Field var latitudeDelta: Double = 0.05
  @Field var longitudeDelta: Double = 0.05

  var mk: MKCoordinateRegion {
    MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
      span: MKCoordinateSpan(latitudeDelta: max(latitudeDelta, 0.05), longitudeDelta: max(longitudeDelta, 0.05))
    )
  }
}

// MKLocalSearchCompleter is delegate-based; this bridges it to one promise
// per query. A newer query supersedes an older one (the old promise gets []).
final class Completer: NSObject, MKLocalSearchCompleterDelegate {
  private let completer = MKLocalSearchCompleter()
  private var pending: Promise?
  private(set) var latest: [MKLocalSearchCompletion] = []

  override init() {
    super.init()
    completer.delegate = self
    completer.resultTypes = [.pointOfInterest, .address]
  }

  func query(_ q: String, region: MKCoordinateRegion, promise: Promise) {
    pending?.resolve([[String: String]]())
    let trimmed = q.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty {
      pending = nil
      promise.resolve([[String: String]]())
      return
    }
    // Same fragment won't trigger the delegate again; answer from cache.
    if trimmed == completer.queryFragment && !latest.isEmpty {
      pending = nil
      promise.resolve(serialize(latest))
      return
    }
    pending = promise
    completer.region = region
    completer.queryFragment = trimmed
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    latest = completer.results
    pending?.resolve(serialize(latest))
    pending = nil
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    pending?.resolve([[String: String]]())
    pending = nil
  }

  private func serialize(_ results: [MKLocalSearchCompletion]) -> [[String: String]] {
    results.prefix(8).map { ["title": $0.title, "subtitle": $0.subtitle] }
  }
}
