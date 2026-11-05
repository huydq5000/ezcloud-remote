import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/models/platform_model.dart';

class EzcloudLoginPage extends StatefulWidget {
  const EzcloudLoginPage({Key? key}) : super(key: key);

  @override
  State<EzcloudLoginPage> createState() => _EzcloudLoginPageState();
}

class _EzcloudLoginPageState extends State<EzcloudLoginPage> {
  Timer? _timer;
  String _status = '';
  String _error = '';

  @override
  void initState() {
    super.initState();
    _readStatus();
    _timer = Timer.periodic(const Duration(milliseconds: 500), (_) {
      if (!mounted) return;
      final status = bind.mainGetLocalOption(key: 'ezcloud-login-status');
      final error = bind.mainGetLocalOption(key: 'ezcloud-login-error');
      if (status != _status || error != _error) {
        setState(() {
          _status = status;
          _error = error;
        });
      }
    });
  }

  void _readStatus() {
    _status = bind.mainGetLocalOption(key: 'ezcloud-login-status');
    _error = bind.mainGetLocalOption(key: 'ezcloud-login-error');
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    await bind.mainSetLocalOption(key: 'ezcloud-login', value: 'start');
  }

  Future<void> _cancel() async {
    await bind.mainSetLocalOption(key: 'ezcloud-login', value: 'cancel');
  }

  @override
  Widget build(BuildContext context) {
    final waiting = _status == 'starting' || _status == 'waiting';
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Đăng nhập ezID',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                const Text('Đăng nhập để máy này sẵn sàng nhận hỗ trợ.'),
                if (_error.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text(_error, style: const TextStyle(color: Colors.red)),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    FilledButton(
                      onPressed: waiting ? null : _start,
                      child: const Text('Đăng nhập'),
                    ),
                    const SizedBox(width: 12),
                    if (waiting)
                      TextButton(
                        onPressed: _cancel,
                        child: const Text('Hủy'),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
