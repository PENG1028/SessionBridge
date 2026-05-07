import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../models/envelope.dart';
import 'crypto_service.dart';

/// Chunk buffer for reassembling large (>64KB) messages.
class _ChunkBuffer {
  final int total;
  final List<String?> parts;
  _ChunkBuffer(this.total) : parts = List.filled(total, null);
}

/// WebSocket client for SessionBridge relay.
///
/// Handles: ECDH hello handshake, crypto_v1 encryption,
/// message forwarding, heartbeat, chunk reassembly.
///
/// Equivalent of lib/ws-client.ts in the web frontend.
class SessionBridgeClient {
  final String url;
  final String token;
  final CryptoService _crypto = CryptoService();
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  StreamController<Map<String, dynamic>>? _messageController;
  bool _closed = false;
  bool _authenticated = false;

  // Chunk reassembly state
  final Map<String, _ChunkBuffer> _chunks = {};
  Timer? _chunkCleanupTimer;

  // Heartbeat
  Timer? _heartbeatTimer;

  /// Stream of parsed messages (after decryption).
  Stream<Map<String, dynamic>> get messages => _messageController!.stream;

  bool get isConnected => _channel != null;
  bool get isAuthenticated => _authenticated;
  bool get isCryptoEstablished => _crypto.isEstablished;

  SessionBridgeClient({required this.url, this.token = ''}) {
    _messageController = StreamController<Map<String, dynamic>>.broadcast();
    // Clean up stale chunk buffers every 30s
    _chunkCleanupTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _chunks.clear(),
    );
  }

  /// Connect to the relay server.
  Future<void> connect() async {
    if (_closed) return;

    // 1. Generate ephemeral X25519 keypair
    await _crypto.generateKeyPair();

    // 2. Open WebSocket
    final wsUrl = url.replaceFirst('http', 'ws');
    _channel = WebSocketChannel.connect(Uri.parse(wsUrl));

    // 3. Listen for messages
    _subscription = _channel!.stream.listen(
      _onRawMessage,
      onError: (_) => _onDisconnected(),
      onDone: () => _onDisconnected(),
      cancelOnError: false,
    );

    // 4. Send hello once connected
    await _channel!.ready;
    _sendHello();
  }

  void _sendHello() {
    final body = <String, dynamic>{
      'role': 'browser',
      'features': ['crypto_v1', 'shell'],
      'cols': 80,
      'rows': 24,
    };
    if (_crypto.publicKey != null) {
      body['ephemeralKey'] = _crypto.publicKey;
    }
    if (token.isNotEmpty) {
      body['token'] = token;
    }
    _send('hello', body);
  }

  Future<void> _onRawMessage(dynamic rawData) async {
    String rawStr = rawData is String ? rawData : utf8.decode(rawData as List<int>);

    // Decrypt if crypto is established
    if (_crypto.isEstablished) {
      final decrypted = await _crypto.decrypt(rawStr);
      if (decrypted != null) rawStr = decrypted;
    }

    final msg = Envelope.parse(rawStr);
    if (msg == null) return;

    final type = msg['type'] as String? ?? '';

    // Handle control messages
    switch (type) {
      case 'welcome':
        await _handleWelcome(msg);
        return; // welcome is dispatched below
      case 'ping':
        _send('pong', {});
        return;
      case 'pong':
        return; // server heartbeat reply, ignore
      case 'error':
        // Dispatch error messages
        break;
      case 'shell.output':
      case 'shell.exit':
        // Handle chunked output reassembly
        final reassembled = _tryReassemble(msg);
        if (reassembled == null) return; // incomplete chunk, wait for more
        if (reassembled.isNotEmpty) {
          msg['data'] = reassembled; // replace with reassembled data
          msg.remove('chunk');       // remove chunk metadata
        }
        break; // dispatch the (possibly reassembled) message
      default:
        break;
    }

    // Dispatch to stream
    _messageController?.add(msg);
  }

  Future<void> _handleWelcome(Map<String, dynamic> msg) async {
    // Complete crypto handshake with server keys
    final serverEphemeralKey = msg['ephemeralKey'] as String?;
    if (serverEphemeralKey != null) {
      await _crypto.handshake(serverEphemeralKey: serverEphemeralKey);
    }

    _authenticated = true;

    // Start heartbeat: reply to server pings
    // (Server sends ping every ~30s, client replies pong)

    // Dispatch welcome to stream
    _messageController?.add(msg);
  }

  /// Try to reassemble a potentially chunked message.
  /// Returns the reassembled data string, or null if still waiting for chunks.
  String? _tryReassemble(Map<String, dynamic> msg) {
    final chunk = msg['chunk'] as Map<String, dynamic>?;
    if (chunk == null || chunk['msgId'] == null) {
      // Not a chunked message, pass through
      return '';
    }

    final msgId = chunk['msgId'] as String;
    final seq = chunk['seq'] as int;
    final total = chunk['total'] as int;
    final data = (msg['line'] ?? msg['data'] ?? '') as String;

    final buf = _chunks.putIfAbsent(msgId, () => _ChunkBuffer(total));
    buf.parts[seq] = data;

    final complete = buf.parts.where((p) => p != null).length >= total;
    if (!complete) return null; // still waiting

    _chunks.remove(msgId);
    return buf.parts.cast<String>().join('');
  }

  /// Send an envelope, encrypted if crypto is established.
  void _send(String type, Map<String, dynamic> body) {
    if (_channel == null) return;
    final payload = Envelope.create(type, body).encode();
    if (_crypto.isEstablished) {
      _crypto.encrypt(payload).then((encrypted) {
        _channel?.sink.add(encrypted);
      });
    } else {
      _channel?.sink.add(payload);
    }
  }

  // ─── Public API ─────────────────────────────────

  /// Spawn a new shell instance.
  void spawnShell({String? instanceId}) {
    final body = <String, dynamic>{};
    if (instanceId != null) body['instanceId'] = instanceId;
    _send('shell.spawn', body);
  }

  /// Send input to a shell instance.
  void sendShellInput(String data, {String? instanceId}) {
    final body = <String, dynamic>{'data': data};
    if (instanceId != null) body['instanceId'] = instanceId;
    _send('shell.input', body);
  }

  /// Request the instance list.
  void requestInstances() {
    _send('session.list_req', {});
  }

  /// Send a resize event for the terminal.
  void sendResize(int cols, int rows) {
    _send('shell.resize', {'cols': cols, 'rows': rows});
  }

  /// Disconnect from the relay server.
  void disconnect() {
    _closed = true;
    _heartbeatTimer?.cancel();
    _chunkCleanupTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _channel = null;
    _crypto.reset();
    _authenticated = false;
    _messageController?.close();
  }

  void _onDisconnected() {
    _channel = null;
    _crypto.reset();
    _authenticated = false;
    if (!_closed) {
      // Dispatch disconnect event
      _messageController?.add({'type': '_disconnected'});
    }
  }
}
