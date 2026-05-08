import 'package:flutter/material.dart';

class SplashOverlay extends StatelessWidget {
  final String message;
  final bool isLoading;

  const SplashOverlay({
    super.key,
    required this.message,
    this.isLoading = true,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Logo / icon
            Icon(
              Icons.hub_outlined,
              size: 80,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(height: 24),
            Text(
              'SessionBridge',
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 32),
            if (isLoading)
              const CircularProgressIndicator(),
            if (isLoading)
              const SizedBox(height: 16),
            Text(
              message,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
              textAlign: TextAlign.center,
            ),
            if (!isLoading)
              Padding(
                padding: const EdgeInsets.only(top: 24),
                child: FilledButton.icon(
                  onPressed: () => Navigator.pushNamed(context, '/settings'),
                  icon: const Icon(Icons.settings),
                  label: const Text('Check Settings'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
