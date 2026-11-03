import 'package:flutter/material.dart';
import 'package:flutter_hbb/models/platform_model.dart';

bool ezcloudAuthRequired() =>
    bind.mainGetLocalOption(key: 'ezcloud-auth-required') == 'Y';

bool ezcloudHasPresence() =>
    bind.mainGetLocalOption(key: 'ezcloud-presence-token').isNotEmpty;

class EzcloudSignedOutPage extends StatelessWidget {
  const EzcloudSignedOutPage({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Text('Sign in with ezID before this computer can be reached.'),
      ),
    );
  }
}
