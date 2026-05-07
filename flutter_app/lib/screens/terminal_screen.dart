import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/connection_provider.dart';
import '../providers/terminal_provider.dart';
import '../widgets/terminal_view.dart';

/// Terminal screen — instance chips + terminal output + input bar.
class TerminalScreen extends StatefulWidget {
  const TerminalScreen({super.key});

  @override
  State<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends State<TerminalScreen> {
  bool _listening = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_listening) {
      _listening = true;
      _setupTerminal();
    }
  }

  void _setupTerminal() {
    final connProv = Provider.of<ConnectionProvider>(context, listen: false);
    final termProv = Provider.of<TerminalProvider>(context, listen: false);

    final client = connProv.client;
    if (client != null) {
      termProv.startListening(client.messages, client: client);
    }

    // Auto-spawn shell if no instances, otherwise select the first
    if (connProv.instances.isEmpty && client != null) {
      client.spawnShell();
    } else if (connProv.instances.isNotEmpty && termProv.activeInstance == null) {
      termProv.setActiveInstance(connProv.instances.first);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Consumer2<ConnectionProvider, TerminalProvider>(
      builder: (context, connProv, termProv, _) {
        return Scaffold(
          appBar: AppBar(
            title: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: connProv.status == ConnectionStatus.connected
                        ? Colors.green
                        : Colors.red,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  connProv.status == ConnectionStatus.connected
                      ? 'Connected'
                      : connProv.status == ConnectionStatus.error
                          ? 'Error'
                          : 'Disconnected',
                ),
              ],
            ),
            actions: [
              if (connProv.status == ConnectionStatus.connected)
                IconButton(
                  icon: const Icon(Icons.power_settings_new),
                  onPressed: () {
                    connProv.disconnect();
                    Navigator.of(context)
                        .pushNamedAndRemoveUntil('/connect', (route) => false);
                  },
                  tooltip: 'Disconnect',
                ),
            ],
          ),
          body: Column(
            children: [
              // Instance chips
              if (connProv.instances.isNotEmpty)
                Container(
                  height: 48,
                  color: theme.colorScheme.surfaceContainerHighest,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                    itemCount: connProv.instances.length + 1,
                    itemBuilder: (context, index) {
                      if (index == connProv.instances.length) {
                        return Padding(
                          padding: const EdgeInsets.only(left: 4),
                          child: ActionChip(
                            avatar: const Icon(Icons.add, size: 16),
                            label: const Text('New', style: TextStyle(fontSize: 12)),
                            onPressed: () => connProv.client?.spawnShell(),
                          ),
                        );
                      }
                      final inst = connProv.instances[index];
                      final isActive = termProv.activeInstance?.id == inst.id;
                      return Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: ChoiceChip(
                          label: Text(
                            inst.label,
                            style: const TextStyle(fontSize: 12),
                          ),
                          selected: isActive,
                          onSelected: (_) => termProv.setActiveInstance(inst),
                        ),
                      );
                    },
                  ),
                ),
              // Terminal output
              Expanded(
                child: TerminalView(
                  output: termProv.output,
                  connected: connProv.status == ConnectionStatus.connected,
                  onSend: (text) => termProv.sendToActiveInstance(text),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
