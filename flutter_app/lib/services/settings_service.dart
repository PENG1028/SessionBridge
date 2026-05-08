import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class SettingsService extends ChangeNotifier {
  static const _keyRelayUrl = 'relay_url';
  static const _keyRelayToken = 'relay_token';
  static const _keyAutoStart = 'auto_start';
  static const _keyDashboardPort = 'dashboard_port';

  late SharedPreferences _prefs;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  String get relayUrl =>
      _prefs.getString(_keyRelayUrl) ?? 'ws://127.0.0.1:8080';

  String get relayToken => _prefs.getString(_keyRelayToken) ?? '';

  bool get autoStart => _prefs.getBool(_keyAutoStart) ?? false;

  int get dashboardPort => _prefs.getInt(_keyDashboardPort) ?? 9843;

  Future<void> setRelayUrl(String url) async {
    await _prefs.setString(_keyRelayUrl, url);
    notifyListeners();
  }

  Future<void> setRelayToken(String token) async {
    await _prefs.setString(_keyRelayToken, token);
    notifyListeners();
  }

  Future<void> setAutoStart(bool value) async {
    await _prefs.setBool(_keyAutoStart, value);
    notifyListeners();
  }

  Future<void> setDashboardPort(int port) async {
    await _prefs.setInt(_keyDashboardPort, port);
    notifyListeners();
  }
}
