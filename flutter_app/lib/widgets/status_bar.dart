import 'package:flutter/material.dart';
import '../services/node_service.dart';

class StatusBar extends StatelessWidget {
  final NodeState nodeState;
  final VoidCallback onSettingsTap;

  const StatusBar({
    super.key,
    required this.nodeState,
    required this.onSettingsTap,
  });

  @override
  Widget build(BuildContext context) {
    final (Color color, String label) = switch (nodeState) {
      NodeState.stopped => (Colors.grey, 'Stopped'),
      NodeState.starting => (Colors.orange, 'Starting...'),
      NodeState.running => (Colors.green, 'Connected'),
      NodeState.error => (Colors.red, 'Error'),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: const BorderRadius.vertical(
          bottom: Radius.circular(12),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall,
          ),
          const Spacer(),
          IconButton(
            icon: const Icon(Icons.settings, size: 18),
            onPressed: onSettingsTap,
            tooltip: 'Settings',
          ),
        ],
      ),
    );
  }
}
