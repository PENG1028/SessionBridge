import 'package:flutter/material.dart';
import 'screens/connect_screen.dart';
import 'screens/terminal_screen.dart';

/// Root MaterialApp with dark theme and route definitions.
class SessionBridgeApp extends StatelessWidget {
  const SessionBridgeApp({super.key});

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
      initialRoute: '/connect',
      routes: {
        '/connect': (_) => const ConnectScreen(),
        '/terminal': (_) => const TerminalScreen(),
      },
    );
  }
}
