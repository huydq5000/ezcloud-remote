# Data Model: Hỗ trợ khách hàng từ xa có đăng nhập ezID

**Feature**: `001-ezid-customer-support` | **Date**: 2026-11-03

Khóa người dùng là `sub` của ezID. Email không dùng làm khóa.

## Người dùng

Không có bảng tài khoản riêng để thay ezID. Broker lưu hồ sơ tối thiểu sau lần đăng nhập đầu.

| Trường | Nguồn | Ghi chú |
|---|---|---|
| `sub` | claim ezID | Khóa chính |
| `name` | claim `name` hoặc `preferred_username` | Hiện trên hàng đợi và hộp thoại |
| `role` | suy ra từ claim `role` và `EZID_SUPPORTER_ROLES` | `customer` hoặc `supporter` |

## Máy

Định danh máy vẫn là ID và UUID do RustDesk tạo (`Config::get_id`, uuid trong `RegisterPk`). Broker và `hbbs` không phát ID mới.

| Trường | Ở đâu |
|---|---|
| `device_id` | ID RustDesk |
| `device_uuid` | UUID trong `RegisterPk` |
| `sub` | Người đang đăng nhập trên máy |
| `online_until` | RAM của `hbbs`, hết khi quá 30 giây không keepalive hoặc presence hết hạn |

Cột SQLite `peer.user` của `hbbs` (`rustdesk-server/src/database.rs`) lưu `sub` dạng byte của chuỗi. Không lưu JWT.

## Yêu cầu hỗ trợ

Bảng `ticket` trên broker.

| Trường | Ràng buộc |
|---|---|
| `ticket_id` | Khóa, UUID |
| `sub` | Khách tạo yêu cầu |
| `device_id` | Máy của khách |
| `device_uuid` | Khớp presence lúc tạo |
| `status` | `waiting`, `active`, `closed` |
| `created_at` | |
| `closed_at` | Khi `closed` |
| `supporter_sub` | Điền khi chuyển `active` |

Một `device_id` chỉ có tối đa một dòng `waiting` hoặc `active`. Tạo mới khi còn dòng đó thì trả về dòng cũ.

Chuyển trạng thái:

- `waiting` → `active` khi nhân viên lấy connect grant.
- `waiting` hoặc `active` → `closed` khi khách hoặc nhân viên của ticket đóng, hoặc presence của khách hết hạn không gia hạn.

## Lượt kết nối

Không cần bảng lâu dài. Broker ký JWT và ghi `jti` đã cấp.

| Claim | Giá trị |
|---|---|
| `typ` | `ezcloud-connect` |
| `sub` | `sub` nhân viên |
| `name` | Tên nhân viên |
| `ticket_id` | |
| `peer_id` | `device_id` của khách |
| `jti` | Ngẫu nhiên |
| `exp` | 60 giây |

`hbbs` và broker từ chối `jti` đã thấy. `hbbr` chấp nhận cùng `jti` trong 60 giây sau punch vì relay xảy ra ngay sau đó, rồi từ chối.

## Phiên hiện diện

JWT, không lưu bản đầy đủ.

| Claim | Giá trị |
|---|---|
| `typ` | `ezcloud-presence` |
| `sub` | |
| `name` | |
| `role` | `customer` hoặc `supporter` |
| `device_uuid` | |
| `exp` | 10 phút |
| `iss` | Giá trị `EZCLOUD_JWT_ISS` |

Client gia hạn trước hạn. Hết hạn: `hbbs` xóa peer khỏi map online.

## Phiên điều khiển

Không có bảng. Tồn tại khi khách đã bấm đồng ý trên kết nối RustDesk hiện có. Kết thúc khi một bên ngắt, ticket `closed`, hoặc khách đăng xuất. Sau đó grant cũ không mở lại được.

## Cấu hình ACL

Không có bảng vai trò. Ba bảng trên broker:

**acl_settings** (một dòng): `base_url`, `api_key_enc`, `cache_ttl_seconds`, `mode` (`off` | `shadow` | `enforce`). API cấu hình không trả key, chỉ `apiKeySet`.

**acl_push_log**: thời điểm, người đẩy, kết quả manifest/roles/resources.

**acl_shadow_diff**: người, route, quyền, quyết định cũ, quyết định ACL, số lần. Dùng khi `mode=shadow`.

Quyền hiệu lực không lưu lâu hơn cache bộ nhớ (≤ 300 giây).

## Trạng thái nhìn từ máy khách

| Trạng thái UI | Điều kiện |
|---|---|
| Cần đăng nhập | Không có presence |
| Sẵn sàng | Có presence, không có ticket mở |
| Đang chờ | Ticket `waiting` |
| Đang hỗ trợ | Ticket `active` và phiên điều khiển đang sống |
| Đã đóng | Ticket `closed`; máy vẫn online nếu presence còn |
