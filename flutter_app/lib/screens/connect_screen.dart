import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/connection_provider.dart';
import '../widgets/connection_card.dart';

/// Connect screen — URL/Token input and saved connections.
class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key});

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  final _urlController = TextEditingController();
  final _tokenController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    // Load saved connections on first build
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ConnectionProvider>().loadSavedConnections();
    });
  }

  void _connect() {
    if (!_formKey.currentState!.validate()) return;
    final url = _urlController.text.trim();
    final token = _tokenController.text.trim();
    context.read<ConnectionProvider>().connect(url, token);
    Navigator.pushNamed(context, '/terminal');
  }

  @override
  void dispose() {
    _urlController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('SessionBridge'),
        centerTitle: true,
      ),
      body: Consumer<ConnectionProvider>(
        builder: (context, provider, _) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Header
              Icon(Icons.cloud_outlined, size: 64, color: theme.colorScheme.primary),
              const SizedBox(height: 8),
              Text(
                'Connect to Relay',
                style: theme.textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 4),
              Text(
                'Enter the WebSocket URL of your relay server.',
                style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),

              // Error message
              if (provider.status == ConnectionStatus.error)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Text(
                    provider.errorMessage,
                    style: TextStyle(color: Colors.red.shade700, fontSize: 13),
                  ),
                ),

              // Connect form
              Form(
                key: _formKey,
                child: Column(
                  children: [
                    TextFormField(
                      controller: _urlController,
                      decoration: InputDecoration(
                        labelText: 'WebSocket URL',
                        hintText: 'ws://192.168.1.100:8080',
                        prefixIcon: const Icon(Icons.link),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                      keyboardType: TextInputType.url,
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return 'URL is required';
                        if (!v.trim().startsWith('ws://') && !v.trim().startsWith('wss://')) {
                          return 'Must start with ws:// or wss://';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _tokenController,
                      decoration: InputDecoration(
                        labelText: 'Token (optional)',
                        hintText: 'Auth token if required',
                        prefixIcon: const Icon(Icons.lock_outline),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                      obscureText: true,
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton.icon(
                        onPressed: provider.status == ConnectionStatus.connecting ? null : _connect,
                        icon: provider.status == ConnectionStatus.connecting
                            ? const SizedBox(
                                width: 18, height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.power_settings_new),
                        label: Text(
                          provider.status == ConnectionStatus.connecting
                              ? 'Connecting...'
                              : 'Connect',
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 32),

              // Saved connections
              if (provider.savedConnections.isNotEmpty) ...[
                Text(
                  'Saved Connections',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: Colors.grey,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                ...provider.savedConnections.map((conn) => ConnectionCard(
                  connection: conn,
                  onTap: () {
                    _urlController.text = conn.url;
                    _tokenController.text = conn.token;
                    _connect();
                  },
                  onDelete: () => provider.deleteSavedConnection(conn.id),
                )),
              ],
            ],
          );
        },
      ),
    );
  }
}
