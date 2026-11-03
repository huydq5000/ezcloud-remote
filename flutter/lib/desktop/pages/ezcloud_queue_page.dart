import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/common.dart';
import 'package:flutter_hbb/models/platform_model.dart';
import 'package:flutter_hbb/models/server_model.dart';
import 'package:flutter_hbb/utils/multi_window_manager.dart';
import 'package:http/http.dart' as http;

class EzcloudSupportPage extends StatefulWidget {
  const EzcloudSupportPage({Key? key}) : super(key: key);

  @override
  State<EzcloudSupportPage> createState() => _EzcloudSupportPageState();
}

class _EzcloudSupportPageState extends State<EzcloudSupportPage> {
  String _status = '';
  String _ticketId = '';
  String _error = '';
  bool _busy = false;

  Future<void> _request() async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final response = await _send('POST', '/v1/tickets', await _deviceBody());
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode >= 300) {
        throw Exception(body['error'] ?? response.statusCode);
      }
      setState(() {
        _ticketId = body['ticket_id']?.toString() ?? '';
        _status = body['status']?.toString() ?? 'waiting';
      });
      await bind.mainSetLocalOption(key: 'ezcloud-open-ticket', value: _ticketId);
    } catch (err) {
      setState(() => _error = 'Không tạo được yêu cầu hỗ trợ.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _close() async {
    if (_ticketId.isEmpty) return;
    setState(() => _busy = true);
    try {
      final response = await _send('POST', '/v1/tickets/$_ticketId/close', {});
      if (response.statusCode >= 300) {
        throw Exception(response.statusCode);
      }
      await bind.mainSetLocalOption(key: 'ezcloud-open-ticket', value: '');
      await _dropLiveControl();
      setState(() {
        _status = 'closed';
      });
    } catch (_) {
      setState(() => _error = 'Không đóng được yêu cầu.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final label = _status == 'waiting'
        ? 'Đang chờ nhân viên'
        : _status == 'active'
            ? 'Đang được hỗ trợ'
            : _status == 'closed'
                ? 'Đã đóng'
                : 'Chưa có yêu cầu';
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(label, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            if (_error.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error),
              ),
            FilledButton(
              onPressed: _busy || _status == 'waiting' || _status == 'active'
                  ? null
                  : _request,
              child: const Text('Yêu cầu hỗ trợ'),
            ),
            if (_status == 'waiting' || _status == 'active')
              TextButton(
                onPressed: _busy ? null : _close,
                child: const Text('Kết thúc'),
              ),
          ],
        ),
      ),
    );
  }
}

class EzcloudQueuePage extends StatefulWidget {
  const EzcloudQueuePage({Key? key}) : super(key: key);

  @override
  State<EzcloudQueuePage> createState() => _EzcloudQueuePageState();
}

class _EzcloudQueuePageState extends State<EzcloudQueuePage> {
  Timer? _timer;
  List<Map<String, dynamic>> _tickets = [];
  String _error = '';
  String _activeTicket = '';

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final response = await _send('GET', '/v1/tickets?status=waiting', null);
      if (response.statusCode >= 300) {
        throw Exception(response.statusCode);
      }
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final tickets = (body['tickets'] as List? ?? [])
          .map((item) => Map<String, dynamic>.from(item as Map))
          .toList();
      if (!mounted) return;
      setState(() {
        _tickets = tickets;
        _error = '';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Không tải được hàng đợi.');
    }
  }

  Future<void> _connect(Map<String, dynamic> ticket) async {
    final id = ticket['ticket_id']?.toString() ?? '';
    final peer = ticket['device_id']?.toString() ?? '';
    if (id.isEmpty || peer.isEmpty) return;
    final response = await _send('POST', '/v1/tickets/$id/connect', {});
    if (response.statusCode >= 300) {
      setState(() => _error = 'Không cấp được quyền kết nối.');
      return;
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final grant = body['connect_grant']?.toString() ?? '';
    if (grant.isEmpty) return;
    await bind.mainSetLocalOption(key: 'ezcloud-connect-grant', value: grant);
    setState(() => _activeTicket = id);
    await connectMainDesktop(
      peer,
      isFileTransfer: false,
      isViewCamera: false,
      isTerminal: false,
      isTcpTunneling: false,
      isRDP: false,
    );
    _load();
  }

  Future<void> _end(String ticketId) async {
    final response = await _send('POST', '/v1/tickets/$ticketId/close', {});
    if (response.statusCode >= 300) {
      setState(() => _error = 'Không đóng được yêu cầu.');
      return;
    }
    await _dropLiveControl();
    if (!mounted) return;
    setState(() => _activeTicket = '');
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text('Hàng đợi hỗ trợ',
              style: Theme.of(context).textTheme.titleLarge),
        ),
        if (_error.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text(_error)),
        if (_activeTicket.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextButton(
              onPressed: () => _end(_activeTicket),
              child: const Text('Kết thúc'),
            ),
          ),
        Expanded(
          child: _tickets.isEmpty
              ? const Center(child: Text('Không có yêu cầu đang chờ.'))
              : ListView.builder(
                  itemCount: _tickets.length,
                  itemBuilder: (_, index) {
                    final ticket = _tickets[index];
                    return ListTile(
                      title: Text(ticket['name']?.toString() ?? ''),
                      subtitle: Text(ticket['device_id']?.toString() ?? ''),
                      trailing: FilledButton(
                        onPressed: () => _connect(ticket),
                        child: const Text('Kết nối'),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

Future<void> _dropLiveControl() async {
  final clients = List<Client>.from(gFFI.serverModel.clients);
  for (final client in clients) {
    await bind.cmCloseConnection(connId: client.id);
  }
  try {
    await rustDeskWinManager.closeAllSubWindows();
  } catch (_) {}
}

Future<Map<String, String>> _deviceBody() async {
  return {
    'device_id': await bind.mainGetMyId(),
    'device_uuid': await bind.mainGetUuid(),
  };
}

Future<http.Response> _send(String method, String path, Map<String, String>? body) async {
  final broker = bind.mainGetLocalOption(key: 'ezcloud-broker');
  final base = broker.isEmpty ? 'http://127.0.0.1:8080' : broker;
  final presence = bind.mainGetLocalOption(key: 'ezcloud-presence-token');
  final uri = Uri.parse('$base$path');
  final headers = {
    'authorization': 'Bearer $presence',
    'content-type': 'application/json',
  };
  if (method == 'GET') {
    return http.get(uri, headers: headers);
  }
  return http.post(uri, headers: headers, body: jsonEncode(body ?? {}));
}
