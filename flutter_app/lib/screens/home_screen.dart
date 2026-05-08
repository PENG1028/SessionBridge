import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../services/node_service.dart';
import '../services/notification_service.dart';
import '../services/settings_service.dart';
import '../widgets/splash_overlay.dart';
import '../widgets/status_bar.dart';

class HomeScreen extends StatefulWidget {
  final SettingsService settings;
  final NodeService nodeService;
  final NotificationService notificationService;

  const HomeScreen({
    super.key,
    required this.settings,
    required this.nodeService,
    required this.notificationService,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late WebViewController _webViewController;
  bool _isLoading = true;
  bool _webViewReady = false;
  String _loadingMessage = 'Initializing...';

  @override
  void initState() {
    super.initState();
    _initWebView();
    _startNodeService();
  }

  void _initWebView() {
    _webViewController = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) {
            if (mounted) {
              setState(() {
                _isLoading = true;
                _loadingMessage = 'Loading dashboard...';
              });
            }
          },
          onPageFinished: (_) {
            if (mounted) {
              setState(() {
                _isLoading = false;
                _webViewReady = true;
              });
            }
          },
          onWebResourceError: (error) {
            if (mounted) {
              setState(() {
                _isLoading = false;
                _loadingMessage =
                    'Failed to load: ${error.description}';
              });
            }
          },
        ),
      );
  }

  Future<void> _startNodeService() async {
    if (mounted) {
      setState(() => _loadingMessage = 'Starting relay server...');
    }

    widget.nodeService.addListener(_onNodeStateChanged);

    // Listen for state changes before starting
    widget.nodeService.stateStream.listen((state) {
      if (state == NodeState.running) {
        _loadDashboard();
      } else if (state == NodeState.error) {
        if (mounted) {
          setState(() {
            _isLoading = false;
            _loadingMessage =
                'Error: ${widget.nodeService.errorMessage}';
          });
        }
      }
    });

    await widget.nodeService.start();
  }

  void _loadDashboard() {
    final port = widget.settings.dashboardPort;
    final url = 'http://127.0.0.1:$port';
    _webViewController.loadRequest(Uri.parse(url));
  }

  void _onNodeStateChanged() {
    // handled by stream listener in _startNodeService
  }

  void _openSettings() {
    Navigator.pushNamed(context, '/settings');
  }

  @override
  void dispose() {
    widget.nodeService.removeListener(_onNodeStateChanged);
    widget.nodeService.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            // WebView
            WebViewWidget(controller: _webViewController),

            // Splash overlay while loading
            if (!_webViewReady)
              SplashOverlay(
                message: _loadingMessage,
                isLoading: _isLoading,
              ),

            // Top status bar
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: StatusBar(
                nodeState: widget.nodeService.state,
                onSettingsTap: _openSettings,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
