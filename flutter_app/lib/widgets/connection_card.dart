import 'package:flutter/material.dart';
import '../models/saved_connection.dart';

/// A card showing a saved relay server connection.
class ConnectionCard extends StatelessWidget {
  final SavedConnection connection;
  final VoidCallback? onTap;
  final VoidCallback? onDelete;

  const ConnectionCard({
    super.key,
    required this.connection,
    this.onTap,
    this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: ListTile(
        leading: const Icon(Icons.dns_outlined, color: Colors.cyan),
        title: Text(
          connection.displayName,
          style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w500),
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          connection.token.isNotEmpty
              ? '${connection.url} (token)'
              : connection.url,
          style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey),
          overflow: TextOverflow.ellipsis,
        ),
        trailing: IconButton(
          icon: const Icon(Icons.delete_outline, size: 20),
          onPressed: onDelete,
          tooltip: 'Delete',
        ),
        onTap: onTap,
      ),
    );
  }
}
