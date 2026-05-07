/// Strips ANSI escape sequences from terminal output.
///
/// Matches lib/ansi.ts stripAnsi() in the web frontend.
class AnsiStripper {
    // CSI sequences: ESC [ params final
  static final _csi = RegExp(r'\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]');
  // OSC sequences: ESC ] text (ST | BEL)
  static final _osc = RegExp(r'\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)');
  // DCS / SOS / PM / APC sequences
  static final _dcs = RegExp(r'\x1B[PX^_].*?(?:\x07|\x1B\\)');
  /// Control characters (except TAB, LF, CR)
  static final _ctrl = RegExp(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]');
  /// Box-drawing / line-drawing characters (simple removal)
  static final _box = RegExp(r'[─-▟]');

  static String strip(String input) {
    return input
        .replaceAll(_csi, '')
        .replaceAll(_osc, '')
        .replaceAll(_dcs, '')
        .replaceAll(_ctrl, '')
        .replaceAll(_box, '')
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n');
  }
}
