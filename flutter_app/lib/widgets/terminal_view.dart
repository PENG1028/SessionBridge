import 'package:flutter/material.dart';

/// Scrollable terminal output viewer with an input bar.
class TerminalView extends StatefulWidget {
  final String output;
  final bool connected;
  final ValueChanged<String> onSend;

  const TerminalView({
    super.key,
    required this.output,
    this.connected = false,
    required this.onSend,
  });

  @override
  State<TerminalView> createState() => _TerminalViewState();
}

class _TerminalViewState extends State<TerminalView> {
  final TextEditingController _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final FocusNode _inputFocus = FocusNode();
  static const _maxLines = 5000;

  @override
  void didUpdateWidget(TerminalView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.output != widget.output) {
      // Auto-scroll to bottom on new output
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 100),
            curve: Curves.easeOut,
          );
        }
      });
    }
  }

  void _handleSend() {
    final text = _inputController.text;
    if (text.isEmpty) return;
    _inputController.clear();
    widget.onSend(text);
    // Refocus input
    _inputFocus.requestFocus();
  }

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    _inputFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        // Terminal output area
        Expanded(
          child: Container(
            color: const Color(0xFF1E1E1E),
            child: SingleChildScrollView(
              controller: _scrollController,
              padding: const EdgeInsets.all(12),
              child: SelectableText(
                widget.output.isEmpty ? '[Waiting for output...]' : widget.output,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 13,
                  color: Color(0xFFD4D4D4),
                  height: 1.4,
                ),
                maxLines: _maxLines,
              ),
            ),
          ),
        ),
        // Input bar
        Container(
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            border: Border(top: BorderSide(color: theme.dividerColor)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _inputController,
                  focusNode: _inputFocus,
                  enabled: widget.connected,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
                  decoration: InputDecoration(
                    hintText: widget.connected ? 'Type a command...' : 'Not connected',
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                  ),
                  onSubmitted: (_) => _handleSend(),
                ),
              ),
              const SizedBox(width: 4),
              IconButton(
                icon: const Icon(Icons.send, size: 20),
                onPressed: widget.connected ? _handleSend : null,
                tooltip: 'Send',
              ),
            ],
          ),
        ),
      ],
    );
  }
}
