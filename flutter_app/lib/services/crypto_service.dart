import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart' show sha256;
import 'package:cryptography/cryptography.dart';

/// ECDH + HKDF + AES-256-GCM crypto service.
///
/// Matches the Node.js server implementation in src/crypto-layer.ts.
/// CRITICAL: The HKDF must match the server's deriveSessionKey() exactly.
///
/// Key derivation (server formula):
///   prk = SHA256(secret1 + "session-bridge-v1")
///   sessionKey = SHA256(prk + 0x01)[0:32]
///
/// Flutter only has an ephemeral key (no static identity), so only
/// ephemeral-ephemeral ECDH is computed. The extra ephemeral-static
/// agreement that the browser incorrectly computes is NOT done here.
class CryptoService {
  SimpleKeyPair? _keyPair;
  SecretKey? _sessionKey;
  String? _publicKey;
  bool _established = false;

  bool get isEstablished => _established;

  /// The ephemeral public key, base64-encoded, for the hello message.
  String? get publicKey => _publicKey;

  /// Generate an ephemeral X25519 keypair for this connection.
  Future<void> generateKeyPair() async {
    final x25519 = X25519();
    _keyPair = await x25519.newKeyPair();
    final pub = await _keyPair!.extractPublicKey();
    _publicKey = base64Encode(pub.bytes);
  }

  /// Complete the ECDH handshake with the server.
  ///
  /// Flutter has no static key, so only ephemeral-ephemeral agreement
  /// is performed. This matches what the server computes for browser clients.
  Future<void> handshake({
    required String serverEphemeralKey,
  }) async {
    if (_keyPair == null) return;

    final x25519 = X25519();

    // ECDH: ephemeral-ephemeral (forward secrecy)
    final sharedSecret = await x25519.sharedSecretKey(
      keyPair: _keyPair!,
      remotePublicKey: SimplePublicKey(
        base64Decode(serverEphemeralKey),
        type: KeyPairType.x25519,
      ),
    );
    final secret1 = await sharedSecret.extractBytes();

    // Derive session key using server's HKDF formula
    final keyBytes = _deriveServerSessionKey(secret1);
    _sessionKey = SecretKey(keyBytes);
    _established = true;
  }

  /// Server-matching HKDF: deriveSessionKey() in src/crypto-layer.ts
  ///
  ///   prk = SHA256(secret1 [+ secret2] + "session-bridge-v1")
  ///   sessionKey = SHA256(prk + 0x01)[0:32]
  Uint8List _deriveServerSessionKey(List<int> secret1, [List<int>? secret2]) {
    final info = utf8.encode('session-bridge-v1');

    // Round 1: prk = SHA256(secret1 [+ secret2] + info)
    final prk = sha256.convert([...secret1, if (secret2 != null) ...secret2, ...info]).bytes;

    // Round 2: key = SHA256(prk + 0x01)[0:32]
    final keyBytes = sha256.convert([...prk, 0x01]).bytes;
    return Uint8List.fromList(keyBytes.take(32).toList());
  }

  /// Encrypt plaintext with AES-256-GCM.
  /// Returns the encrypted packet as a JSON string.
  /// Matches encrypt() in src/crypto-layer.ts.
  Future<String> encrypt(String plaintext) async {
    if (!_established || _sessionKey == null) return plaintext;

    final aesGcm = AesGcm.with256bits(nonceLength: 12);
    final secretBox = await aesGcm.encrypt(
      utf8.encode(plaintext),
      secretKey: _sessionKey!,
    );

    return jsonEncode({
      'enc': true,
      'iv': base64Encode(secretBox.nonce),
      'tag': base64Encode(secretBox.mac.bytes),
      'data': base64Encode(secretBox.cipherText),
    });
  }

  /// Decrypt an encrypted packet JSON string.
  /// Returns null on authentication failure.
  /// Matches decrypt() in src/crypto-layer.ts.
  Future<String?> decrypt(String cipherJson) async {
    if (!_established || _sessionKey == null) return cipherJson;

    try {
      final parsed = jsonDecode(cipherJson) as Map<String, dynamic>;
      if (parsed['enc'] != true) return cipherJson; // plaintext passthrough

      final aesGcm = AesGcm.with256bits(nonceLength: 12);
      final secretBox = SecretBox(
        base64Decode(parsed['data'] as String),
        nonce: base64Decode(parsed['iv'] as String),
        mac: Mac(base64Decode(parsed['tag'] as String)),
      );

      final plainBytes = await aesGcm.decrypt(
        secretBox,
        secretKey: _sessionKey!,
      );
      return utf8.decode(plainBytes);
    } catch (_) {
      return null;
    }
  }

  /// Reset all crypto state (on disconnect).
  void reset() {
    _keyPair = null;
    _sessionKey = null;
    _publicKey = null;
    _established = false;
  }
}
