import 'package:flutter_test/flutter_test.dart';
import 'package:session_bridge/services/ansi_stripper.dart';

void main() {
  group('AnsiStripper', () {
    test('removes basic SGR escape codes', () {
      const input = '\x1B[31mred\x1B[0m';
      expect(AnsiStripper.strip(input), equals('red'));
    });

    test('removes cursor movement sequences', () {
      const input = '\x1B[2J\x1B[HHello';
      expect(AnsiStripper.strip(input), equals('Hello'));
    });

    test('removes OSC sequences', () {
      const input = '\x1B]0;Title\x07Hello';
      expect(AnsiStripper.strip(input), equals('Hello'));
    });

    test('removes control characters except newlines and tabs', () {
      const input = '\x00\x01\x02Hello\x0B\x0CWorld\x1B';
      expect(AnsiStripper.strip(input), equals('HelloWorld'));
    });

    test('preserves normal text', () {
      const input = 'Hello, World!';
      expect(AnsiStripper.strip(input), equals('Hello, World!'));
    });

    test('normalizes line endings', () {
      const input = 'line1\r\nline2\rline3';
      expect(AnsiStripper.strip(input), equals('line1\nline2\nline3'));
    });

    test('removes complex CSI sequences', () {
      // SGR with multiple params, cursor positioning, erase display
      const input = '\x1B[38;2;255;100;0m\x1B[1;1H\x1B[Jtext';
      expect(AnsiStripper.strip(input), equals('text'));
    });

    test('removes box-drawing characters', () {
      const input = '┌──┐\n│ok│\n└──┘';
      expect(AnsiStripper.strip(input), equals('\nok\n'));
    });

    test('handles empty input', () {
      expect(AnsiStripper.strip(''), equals(''));
    });

    test('handles input with only escape sequences', () {
      const input = '\x1B[31m\x1B[32m\x1B[0m';
      expect(AnsiStripper.strip(input), equals(''));
    });
  });
}
