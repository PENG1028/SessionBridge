import 'dart:convert';

/// V1 envelope format: { v:1, ts, type, body } with body merged to top level.
class Envelope {
  final int v;
  final int ts;
  final String type;
  final Map<String, dynamic> body;

  Envelope({
    this.v = 1,
    int? ts,
    required this.type,
    required this.body,
  }) : ts = ts ?? DateTime.now().millisecondsSinceEpoch;

  /// Build the wire-format JSON map for sending.
  Map<String, dynamic> toJson() => {
    'v': v,
    'ts': ts,
    'type': type,
    'body': body,
  };

  /// Serialize to JSON string.
  String encode() => jsonEncode(toJson());

  /// Parse a raw WebSocket message string into a flat map.
  ///
  /// Mirrors adapters/protocol.ts parseMsg():
  /// - v1 envelopes: body fields are merged to top level for convenient access.
  /// - Legacy flat messages: returned as-is.
  /// - Invalid JSON: returns null (silently dropped).
  static Map<String, dynamic>? parse(String raw) {
    try {
      final parsed = jsonDecode(raw) as Map<String, dynamic>;

      if (parsed['v'] == 1 && parsed['body'] is Map) {
        final body = parsed['body'] as Map<String, dynamic>;
        // Merge body fields into top level (body fields take precedence)
        final merged = Map<String, dynamic>.from(parsed);
        merged.addAll(body);
        merged['_raw'] = parsed; // keep original envelope for reference
        return merged;
      }

      // Legacy flat message
      return parsed;
    } catch (_) {
      return null;
    }
  }

  /// Shortcut: create an envelope for sending.
  static Envelope create(String type, Map<String, dynamic> body) =>
      Envelope(type: type, body: body);
}
