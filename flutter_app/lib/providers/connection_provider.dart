import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/instance_info.dart';
import '../models/saved_connection.dart';
import '../services/session_bridge_client.dart';

enum ConnectionStatus { disconnected, connecting, connected, error }

/// Manages WebSocket connection lifecycle, instance list, and saved connections.
class ConnectionProvider extends ChangeNotifier {
  ConnectionStatus _status = ConnectionStatus.disconnected;
  SessionBridgeClient? _client;
  List<InstanceInfo> _instances = [];
  List<SavedConnection> _savedConnections = [];
  StreamSubscription<Map<String, dynamic>>? _subscription;
  String _errorMessage = '';

  ConnectionStatus get status => _status;
  List<InstanceInfo> get instances => _instances;
  List<SavedConnection> get savedConnections => _savedConnections;
  String get errorMessage => _errorMessage;
  bool get isCryptoEnabled => _client?.isCryptoEstablished ?? false;

  static const String _storageKey = 'saved_connections';

  /// Load saved connections from disk.
  Future<void> loadSavedConnections() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw != null && raw.isNotEmpty) {
      _savedConnections = SavedConnection.decodeList(raw);
      notifyListeners();
    }
  }

  /// Save connections to disk.
  Future<void> _persistConnections() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, SavedConnection.encodeList(_savedConnections));
  }

  /// Connect to a relay server.
  Future<void> connect(String url, String token) async {
    _status = ConnectionStatus.connecting;
    _errorMessage = '';
    notifyListeners();

    try {
      // Save this connection
      _saveConnection(url, token);

      _client = SessionBridgeClient(url: url, token: token);

      // Listen for messages
      _subscription = _client!.messages.listen(_handleMessage);

      await _client!.connect();

      // Wait briefly for welcome, then mark connected
      await Future.delayed(const Duration(seconds: 2));
      _status = ConnectionStatus.connected;
      notifyListeners();
    } catch (e) {
      _status = ConnectionStatus.error;
      _errorMessage = e.toString();
      notifyListeners();
    }
  }

  void _saveConnection(String url, String token) {
    _savedConnections.removeWhere((c) => c.url == url);
    _savedConnections.insert(0, SavedConnection(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      url: url,
      token: token,
      lastUsed: DateTime.now(),
    ));
    _persistConnections();
    notifyListeners();
  }

  /// Delete a saved connection.
  Future<void> deleteSavedConnection(String id) async {
    _savedConnections.removeWhere((c) => c.id == id);
    await _persistConnections();
    notifyListeners();
  }

  void _handleMessage(Map<String, dynamic> msg) {
    final type = msg['type'] as String?;

    switch (type) {
      case 'welcome':
        _handleWelcome(msg);
        break;
      case 'instance.added':
        if (msg['instance'] != null) {
          _instances.add(InstanceInfo.fromJson(msg['instance'] as Map<String, dynamic>));
          notifyListeners();
        }
        break;
      case 'instance.removed':
        final id = msg['instanceId'] as String?;
        if (id != null) {
          _instances.removeWhere((i) => i.id == id);
          notifyListeners();
        }
        break;
      case 'instance.switched':
        // Instance focus changed, could update active state
        notifyListeners();
        break;
      case 'instance.list':
        final list = msg['instances'] as List?;
        if (list != null) {
          _instances = list.map((e) => InstanceInfo.fromJson(e as Map<String, dynamic>)).toList();
          notifyListeners();
        }
        break;
      case '_disconnected':
        _status = ConnectionStatus.disconnected;
        notifyListeners();
        break;
      case 'error':
        _errorMessage = msg['message'] as String? ?? 'Unknown error';
        notifyListeners();
        break;
    }
  }

  void _handleWelcome(Map<String, dynamic> msg) {
    // Parse initial instance list
    final instances = msg['instances'] as List?;
    if (instances != null) {
      _instances = instances.map((e) => InstanceInfo.fromJson(e as Map<String, dynamic>)).toList();
    }
    _status = ConnectionStatus.connected;
    notifyListeners();
  }

  /// Disconnect from the relay.
  void disconnect() {
    _subscription?.cancel();
    _client?.disconnect();
    _client = null;
    _status = ConnectionStatus.disconnected;
    _instances = [];
    notifyListeners();
  }

  /// Get the underlying client for shell/terminal operations.
  SessionBridgeClient? get client => _client;

  @override
  void dispose() {
    _subscription?.cancel();
    _client?.disconnect();
    super.dispose();
  }
}
