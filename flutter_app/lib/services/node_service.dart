import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'settings_service.dart';

enum NodeState { stopped, starting, running, error }

class NodeService extends ChangeNotifier {
  final SettingsService _settings;
  NodeState _state = NodeState.stopped;
  Process? _process;
  String _errorMessage = '';
  final _stateController = StreamController<NodeState>.broadcast();

  NodeService(this._settings);

  NodeState get state => _state;
  String get errorMessage => _errorMessage;
  Stream<NodeState> get stateStream => _stateController.stream;

  /// Path to the bundled relay server binary.
  /// Desktop: bundled via pkg as `relay-server` next to the app executable.
  /// Mobile: handled by nodejs-mobile, not this service.
  String get _relayBinaryPath {
    if (Platform.isWindows) {
      return 'relay-server.exe';
    }
    return 'relay-server';
  }

  bool get _isDesktop =>
      !kIsWeb &&
      (Platform.isWindows || Platform.isMacOS || Platform.isLinux);

  Future<void> start() async {
    if (_state == NodeState.starting || _state == NodeState.running) return;
    _setState(NodeState.starting);

    if (_isDesktop) {
      await _startDesktop();
    } else {
      // Mobile: nodejs-mobile handles startup independently
      _setState(NodeState.running);
    }
  }

  Future<void> _startDesktop() async {
    try {
      final appDir = await getApplicationSupportDirectory();
      final relayPath = '${appDir.path}/$_relayBinaryPath';

      if (!await File(relayPath).exists()) {
        // Fallback: try next to executable or in PATH
        final exeDir = Platform.resolvedExecutable;
        final fallback =
            '${exeDir.substring(0, exeDir.lastIndexOf(Platform.pathSeparator))}/$_relayBinaryPath';
        if (await File(fallback).exists()) {
          await Process.start(fallback, [
            '--relay-port',
            _settings.dashboardPort.toString(),
            '--dashboard-port',
            _settings.dashboardPort.toString(),
          ], mode: ProcessStartMode.normal);
        } else {
          _setError('Relay binary not found: $relayPath');
          return;
        }
      }

      _process = await Process.start(relayPath, [
        '--relay-port',
        _settings.dashboardPort.toString(),
        '--dashboard-port',
        _settings.dashboardPort.toString(),
      ], mode: ProcessStartMode.normal);

      // Monitor stdout for ready signal
      _process!.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
        if (line.contains('Dashboard ready') ||
            line.contains('Relay server on port')) {
          _setState(NodeState.running);
        }
      });

      // Monitor stderr for errors
      _process!.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
        if (line.contains('error') || line.contains('Error')) {
          _setError(line);
        }
      });

      // Handle unexpected exit
      _process!.exitCode.then((code) {
        if (_state == NodeState.running && code != 0) {
          _setError('Relay server exited with code $code');
        } else if (_state != NodeState.error) {
          _setState(NodeState.stopped);
        }
      });
    } catch (e) {
      _setError('Failed to start relay: $e');
    }
  }

  Future<void> stop() async {
    if (_process != null) {
      _process!.kill();
      _process = null;
    }
    _setState(NodeState.stopped);
  }

  void _setState(NodeState newState) {
    _state = newState;
    _stateController.add(newState);
    notifyListeners();
  }

  void _setError(String message) {
    _errorMessage = message;
    _setState(NodeState.error);
  }

  @override
  void dispose() {
    _stateController.close();
    super.dispose();
  }
}
