import 'package:flutter/material.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';
import 'services/node_service.dart';
import 'services/notification_service.dart';
import 'services/settings_service.dart';

class SessionBridgeApp extends StatelessWidget {
  final SettingsService settings;
  final NodeService nodeService;
  final NotificationService notificationService;

  const SessionBridgeApp({
    super.key,
    required this.settings,
    required this.nodeService,
    required this.notificationService,
  });

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SessionBridge',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorSchemeSeed: Colors.cyan,
        useMaterial3: true,
      ),
      initialRoute: '/',
      routes: {
        '/': (_) => HomeScreen(
              settings: settings,
              nodeService: nodeService,
              notificationService: notificationService,
            ),
        '/settings': (_) => SettingsScreen(settings: settings),
      },
    );
  }
}
