import 'dart:convert';

/// A saved relay server connection persisted in SharedPreferences.
class SavedConnection {
  final String id;
  final String url;
  final String token;
  final String label;
  final DateTime lastUsed;

  const SavedConnection({
    required this.id,
    required this.url,
    this.token = '',
    this.label = '',
    required this.lastUsed,
  });

  String get displayName => label.isNotEmpty ? label : url;

  Map<String, dynamic> toJson() => {
    'id': id,
    'url': url,
    'token': token,
    'label': label,
    'lastUsed': lastUsed.toIso8601String(),
  };

  factory SavedConnection.fromJson(Map<String, dynamic> json) {
    return SavedConnection(
      id: json['id'] as String? ?? '',
      url: json['url'] as String? ?? '',
      token: json['token'] as String? ?? '',
      label: json['label'] as String? ?? '',
      lastUsed: json['lastUsed'] != null
          ? DateTime.parse(json['lastUsed'] as String)
          : DateTime.now(),
    );
  }

  static String encodeList(List<SavedConnection> list) =>
      jsonEncode(list.map((c) => c.toJson()).toList());

  static List<SavedConnection> decodeList(String json) {
    final list = jsonDecode(json) as List;
    return list.map((e) => SavedConnection.fromJson(e as Map<String, dynamic>)).toList();
  }
}
