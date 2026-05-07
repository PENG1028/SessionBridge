import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/instance_info.dart';
import '../services/ansi_stripper.dart';
import '../services/session_bridge_client.dart';

/// Manages terminal output buffer and active instance selection.
class TerminalProvider extends ChangeNotifier {
  final StringBuffer _outputBuffer = StringBuffer();
  String _output = '';
  InstanceInfo? _activeInstance;
  bool _isConnected = false;

  SessionBridgeClient? _client;
  StreamSubscription<Map<String, dynamic>>? _subscription;

  // Max output buffer (1 MB)
  static const int _maxLength = 1024 * 1024;

  String get output => _output;
  InstanceInfo? get activeInstance => _activeInstance;
  bool get isConnected => _isConnected;

  /// Append terminal output, stripping ANSI escape codes.
  void appendOutput(String data) {
    final clean = AnsiStripper.strip(data);
    if (clean.isEmpty) return;

    _outputBuffer.write(clean);

    // Trim buffer if too large
    if (_outputBuffer.length > _maxLength) {
      final current = _outputBuffer.toString();
      _outputBuffer.clear();
      _outputBuffer.write(current.substring(current.length - _maxLength));
    }

    _output = _outputBuffer.toString();
    notifyListeners();
  }

  /// Clear terminal output.
  void clearOutput() {
    _outputBuffer.clear();
    _output = '';
    notifyListeners();
  }

  /// Set the active instance.
  void setActiveInstance(InstanceInfo instance) {
    _activeInstance = instance;
    clearOutput();
    notifyListeners();
  }

  /// Set connection state.
  void setConnected(bool connected) {
    _isConnected = connected;
    if (!connected) {
      _activeInstance = null;
      appendOutput('[Disconnected]\n');
    }
    notifyListeners();
  }

  /// Handle shell output message (from WebSocket).
  void handleShellOutput(Map<String, dynamic> msg) {
    final data = msg['data'] as String?;
    if (data != null && data.isNotEmpty) {
      appendOutput(data);
    }
  }

  /// Handle shell exit message.
  void handleShellExit(Map<String, dynamic> msg) {
    final code = msg['code'];
    appendOutput('\n[Process exited with code $code]\n');
  }

  /// Start listening to relay messages for shell output/exit.
  void startListening(Stream<Map<String, dynamic>> stream, {SessionBridgeClient? client}) {
    _client = client;
    _subscription?.cancel();
    _subscription = stream.listen(_onMessage);
  }

  void _onMessage(Map<String, dynamic> msg) {
    switch (msg['type'] as String?) {
      case 'shell.output':
        handleShellOutput(msg);
        break;
      case 'shell.exit':
        handleShellExit(msg);
        break;
    }
  }

  /// Send input to the active instance via the relay client.
  void sendToActiveInstance(String text) {
    if (text.isEmpty || _activeInstance == null || _client == null) return;
    appendOutput('$text\n');
    _client!.sendShellInput(text, instanceId: _activeInstance!.id);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
