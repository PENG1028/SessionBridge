/// Represents a session instance on the relay server.
class InstanceInfo {
  final String id;
  final String label;
  final String status;  // "running", "stopped", "starting", "error"
  final String source;  // "local", "remote"
  final String? dir;
  final String? adapterId;

  const InstanceInfo({
    required this.id,
    required this.label,
    this.status = 'stopped',
    this.source = 'local',
    this.dir,
    this.adapterId,
  });

  bool get isRunning => status == 'running';
  bool get isRemote => source == 'remote';

  factory InstanceInfo.fromJson(Map<String, dynamic> json) {
    return InstanceInfo(
      id: json['id'] as String? ?? json['instanceId'] as String? ?? '',
      label: json['label'] as String? ?? json['name'] as String? ?? '',
      status: json['status'] as String? ?? 'stopped',
      source: json['source'] as String? ?? 'local',
      dir: json['dir'] as String?,
      adapterId: json['adapterId'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'label': label,
    'status': status,
    'source': source,
    'dir': dir,
    'adapterId': adapterId,
  };
}
