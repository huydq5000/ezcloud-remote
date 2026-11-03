import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/models/platform_model.dart';

class EzcloudLoginPage extends StatefulWidget {
  const EzcloudLoginPage({Key? key}) : super(key: key);

  @override
  State<EzcloudLoginPage> createState() => _EzcloudLoginPageState();
}

class _EzcloudLoginPageState extends State<EzcloudLoginPage> {
  final _clientId = TextEditingController();
  final _issuer = TextEditingController();
  final _broker = TextEditingController();
  final _port = TextEditingController();
  Timer? _timer;
  String _status = '';
  String _error = '';

  @override
  void initState() {
    super.initState();
    final savedClientId = bind.mainGetLocalOption(key: 'ezcloud-client-id');
    _clientId.text = savedClientId.isEmpty ? 'ezcloud-remote' : savedClientId;
    final issuer = bind.mainGetLocalOption(key: 'ezcloud-issuer');
    _issuer.text = issuer.isEmpty ? 'https://dev-id.ezcloud.vn' : issuer;
    final broker = bind.mainGetLocalOption(key: 'ezcloud-broker');
    _broker.text = broker.isEmpty ? 'http://127.0.0.1:8080' : broker;
    final port = bind.mainGetLocalOption(key: 'ezcloud-redirect-port');
    _port.text = port.isEmpty ? '43821' : port;
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
    _clientId.dispose();
    _issuer.dispose();
    _broker.dispose();
    _port.dispose();
    super.dispose();
  }

  Future<void> _saveSettings() async {
    await bind.mainSetLocalOption(
        key: 'ezcloud-client-id', value: _clientId.text.trim());
    await bind.mainSetLocalOption(
        key: 'ezcloud-issuer', value: _issuer.text.trim());
    await bind.mainSetLocalOption(
        key: 'ezcloud-broker', value: _broker.text.trim());
    await bind.mainSetLocalOption(
        key: 'ezcloud-redirect-port', value: _port.text.trim());
  }

  Future<void> _start() async {
    await _saveSettings();
    await bind.mainSetLocalOption(key: 'ezcloud-login', value: 'start');
  }

  Future<void> _cancel() async {
    await bind.mainSetLocalOption(key: 'ezcloud-login', value: 'cancel');
  }

  @override
  Widget build(BuildContext context) {
    final port = _port.text.trim().isEmpty ? '43821' : _port.text.trim();
    final waiting = _status == 'starting' || _status == 'waiting';
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(24),
            children: [
              Text(
                'Đăng nhập ezID',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              const Text(
                'Máy này chỉ online sau khi đăng nhập. Client ID là ezcloud-remote, public client, không có client secret.',
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _clientId,
                decoration: const InputDecoration(
                  labelText: 'Client ID',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _issuer,
                decoration: const InputDecoration(
                  labelText: 'Issuer',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _broker,
                decoration: const InputDecoration(
                  labelText: 'Broker',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _port,
                decoration: const InputDecoration(
                  labelText: 'Cổng loopback',
                  border: OutlineInputBorder(),
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 8),
              Text(
                'Đăng ký với ezID:\nhttp://127.0.0.1:$port/callback\nhttp://127.0.0.1:$port/logout',
              ),
              const SizedBox(height: 16),
              if (_error.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(_error, style: const TextStyle(color: Colors.red)),
                ),
              Row(
                children: [
                  FilledButton(
                    onPressed: waiting ? null : _start,
                    child: const Text('Đăng nhập ezID'),
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
    );
  }
}
