import 'package:flutter/material.dart';
import 'app.dart';
import 'services/node_service.dart';
import 'services/notification_service.dart';
import 'services/settings_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Init services
  final settings = SettingsService();
  await settings.init();

  final nodeService = NodeService(settings);
  final notificationService = NotificationService();

  runApp(SessionBridgeApp(
    settings: settings,
    nodeService: nodeService,
    notificationService: notificationService,
  ));
}
