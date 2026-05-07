import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:session_bridge/app.dart';
import 'package:session_bridge/providers/connection_provider.dart';
import 'package:session_bridge/providers/terminal_provider.dart';

void main() {
  testWidgets('App renders connect screen', (WidgetTester tester) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(create: (_) => ConnectionProvider()),
          ChangeNotifierProvider(create: (_) => TerminalProvider()),
        ],
        child: const SessionBridgeApp(),
      ),
    );

    // Verify connect screen renders
    expect(find.text('SessionBridge'), findsOneWidget);
    expect(find.text('Connect to Relay'), findsOneWidget);
  });
}
