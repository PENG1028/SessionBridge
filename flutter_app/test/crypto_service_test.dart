import 'package:flutter_test/flutter_test.dart';
import 'package:session_bridge/services/crypto_service.dart';

void main() {
  group('CryptoService', () {
    test('generateKeyPair produces a valid base64 public key', () async {
      final crypto = CryptoService();
      await crypto.generateKeyPair();
      expect(crypto.publicKey, isNotNull);
      expect(crypto.publicKey!.length, greaterThan(0));
      expect(crypto.isEstablished, isFalse);
    });

    test('two instances derive matching session keys', () async {
      // Simulate a client and server exchanging ephemeral keys
      final client = CryptoService();
      final server = CryptoService();

      await client.generateKeyPair();
      await server.generateKeyPair();

      // Each side performs ECDH with the other's public key
      await client.handshake(serverEphemeralKey: server.publicKey!);
      await server.handshake(serverEphemeralKey: client.publicKey!);

      expect(client.isEstablished, isTrue);
      expect(server.isEstablished, isTrue);
    });

    test('encrypt then decrypt returns original plaintext', () async {
      final client = CryptoService();
      final server = CryptoService();

      await client.generateKeyPair();
      await server.generateKeyPair();
      await client.handshake(serverEphemeralKey: server.publicKey!);
      await server.handshake(serverEphemeralKey: client.publicKey!);

      const original = 'Hello, SessionBridge!';
      final encrypted = await client.encrypt(original);
      expect(encrypted, isNot(equals(original)));

      final decrypted = await server.decrypt(encrypted);
      expect(decrypted, equals(original));
    });

    test('tampered ciphertext returns null on decrypt', () async {
      final client = CryptoService();
      final server = CryptoService();

      await client.generateKeyPair();
      await server.generateKeyPair();
      await client.handshake(serverEphemeralKey: server.publicKey!);
      await server.handshake(serverEphemeralKey: client.publicKey!);

      final encrypted = await client.encrypt('sensitive data');
      // Tamper by prepending to the data field value
      final tampered = encrypted.replaceFirst('"data":"', '"data":"X');
      final result = await server.decrypt(tampered);
      expect(result, isNull);
    });

    test('reset clears crypto state', () async {
      final crypto = CryptoService();
      await crypto.generateKeyPair();

      // Handshake with itself (same keypair) to establish
      await crypto.handshake(serverEphemeralKey: crypto.publicKey!);
      expect(crypto.isEstablished, isTrue);

      crypto.reset();
      expect(crypto.isEstablished, isFalse);
      expect(crypto.publicKey, isNull);
    });

    test('plaintext passthrough when crypto not established', () async {
      final crypto = CryptoService();
      const original = 'hello';

      // encrypt returns plaintext when not established
      final encrypted = await crypto.encrypt(original);
      expect(encrypted, equals(original));

      // decrypt returns ciphertext when not established
      final decrypted = await crypto.decrypt(original);
      expect(decrypted, equals(original));
    });
  });
}
