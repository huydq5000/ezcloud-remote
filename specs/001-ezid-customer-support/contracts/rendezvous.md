# Contract: mở rộng rendezvous của bản fork

**Feature**: `001-ezid-customer-support` | **Date**: 2026-11-03

File phải giống nhau ở:

- `libs/hbb_common/protos/rendezvous.proto`
- `rustdesk-server/libs/hbb_common/protos/rendezvous.proto`

Bật `EZCLOUD_AUTH_REQUIRED=Y` thì mọi quy tắc dưới đây có hiệu lực. Thiếu token bị từ chối, không chỉ bị bỏ qua.

## RegisterPk

Thêm `string session_token = 6`.

Server chấp nhận khi tất cả đúng:

- JWT verify bằng JWKS của broker, `iss` khớp `EZCLOUD_JWT_ISS`.
- `typ` = `ezcloud-presence`.
- `exp` còn hạn.
- `device_uuid` trong token khớp `uuid` của `RegisterPk`.

Thất bại: `RegisterPkResponse.result = AUTH_REQUIRED` (giá trị enum mới). Không ghi peer, không cập nhật `peer.user`.

Thành công: luồng uuid/pk hiện tại giữ nguyên. RAM của peer nhớ `sub`, `role`, `name`, `exp`. Cột `peer.user` lưu `sub`.

## RegisterPeer

Nếu peer chưa có presence còn hạn: `RegisterPeerResponse.auth_required = true` (field 3) và không `update_addr`.

Peer quá 30 giây không đăng ký địa chỉ, hoặc presence hết hạn: xóa khỏi map online.

## PunchHoleRequest

Field `token` (số 5) là connect grant.

Server chấp nhận khi tất cả đúng:

- `typ` = `ezcloud-connect`, chữ ký và `iss` đúng, `exp` còn hạn.
- `peer_id` trong grant trùng ID đích.
- `jti` chưa dùng. Đánh dấu đã dùng trước khi trả địa chỉ.
- Máy đích đang online, presence `role=customer` còn hạn.

Thất bại: `PunchHoleResponse.failure = AUTH_REQUIRED` (giá trị enum mới). Không trả địa chỉ socket.

Thành công: `PunchHole.agent_name` (field 11) và `PunchHole.ticket_id` (field 12) lấy từ grant đã verify, không lấy từ gói tin của nhân viên. Cùng quy tắc cho nhánh `FetchLocalAddr`.

`licence_key` vẫn phải khớp khóa server như code hiện tại.

## RequestRelay

Field `token` (số 8) là cùng connect grant. `hbbr` kiểm tra chữ ký, `typ`, hạn 60 giây, `peer_id` khớp `id`. Cùng `jti` được dùng cho cặp relay ngay sau punch, không dùng cho punch thứ hai.

## Cấu hình server

| Biến | Bắt buộc khi auth bật |
|---|---|
| `EZCLOUD_AUTH_REQUIRED` | `Y` |
| `EZCLOUD_JWKS_URL` hoặc `EZCLOUD_JWT_PUBLIC_KEY` | Một trong hai |
| `EZCLOUD_JWT_ISS` | Có |

Log được `sub`, `ticket_id`, ID máy, kết quả. Không log JWT.
