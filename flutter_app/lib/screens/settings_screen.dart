import 'package:flutter/material.dart';
import '../services/settings_service.dart';

class SettingsScreen extends StatefulWidget {
  final SettingsService settings;

  const SettingsScreen({super.key, required this.settings});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late TextEditingController _relayUrlController;
  late TextEditingController _relayTokenController;
  late TextEditingController _portController;

  @override
  void initState() {
    super.initState();
    _relayUrlController =
        TextEditingController(text: widget.settings.relayUrl);
    _relayTokenController =
        TextEditingController(text: widget.settings.relayToken);
    _portController = TextEditingController(
        text: widget.settings.dashboardPort.toString());
  }

  @override
  void dispose() {
    _relayUrlController.dispose();
    _relayTokenController.dispose();
    _portController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await widget.settings.setRelayUrl(_relayUrlController.text.trim());
    await widget.settings
        .setRelayToken(_relayTokenController.text.trim());
    final port = int.tryParse(_portController.text.trim()) ?? 9843;
    await widget.settings.setDashboardPort(port);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Settings saved')),
      );
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: [
          TextButton(onPressed: _save, child: const Text('Save')),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _relayUrlController,
            decoration: const InputDecoration(
              labelText: 'Relay URL',
              hintText: 'ws://127.0.0.1:8080',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _relayTokenController,
            decoration: const InputDecoration(
              labelText: 'Relay Token (optional)',
              hintText: 'Leave blank if no token',
              border: OutlineInputBorder(),
            ),
            obscureText: true,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _portController,
            decoration: const InputDecoration(
              labelText: 'Dashboard Port',
              hintText: '9843',
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 24),
          SwitchListTile(
            title: const Text('Auto-start on login'),
            value: widget.settings.autoStart,
            onChanged: (value) {
              widget.settings.setAutoStart(value);
              setState(() {});
            },
          ),
          const SizedBox(height: 24),
          Text(
            'Version: 0.2.0',
            style: Theme.of(context).textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
