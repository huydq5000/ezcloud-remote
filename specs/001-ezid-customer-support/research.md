# Research: Hỗ trợ khách hàng từ xa có đăng nhập ezID

**Feature**: `001-ezid-customer-support` | **Date**: 2026-11-03

Đối chiếu với client RustDesk `55786aa` (1.5.1) và `rustdesk-server` `2215e70` (1.1.17) đang có trong workspace.

---

## R1. Chặn người lạ ở đâu

**Decision**: `hbbs` từ chối `RegisterPk` / `RegisterPeer` khi không có presence token, và từ chối `PunchHoleRequest` khi không có connect grant hợp lệ. `hbbr` từ chối `RequestRelay` cùng điều kiện khi `EZCLOUD_AUTH_REQUIRED=Y`. UI không phải hàng rào.

**Rationale**: `RegisterPeer` hôm nay chỉ gửi `id` và `serial` (`libs/hbb_common/protos/rendezvous.proto`). `handle_punch_hole_request` trong `rustdesk-server/src/rendezvous_server.rs` chỉ so `licence_key`. Client RustDesk gốc biết địa chỉ server và public key là vào được nếu chỉ ẩn nút trên Flutter. FR-014 yêu cầu bản gốc không đăng ký và không kết nối.

**Alternatives considered**:

- Chỉ ẩn ô nhập ID trên client ezCloud: không chặn bản gốc.
- Tường lửa theo IP nhân viên: khách ở mạng nhà, không dùng được.

## R2. Token nào đi trên đường rendezvous

**Decision**: Phương án B của ezID. Client đổi code lấy token ezID (PKCE, không `client_secret`). Broker verify JWT ezID rồi ký hai JWT của ezCloud:

- Presence, `typ=ezcloud-presence`, 10 phút, gắn `sub` + `device_uuid`.
- Connect grant, `typ=ezcloud-connect`, 60 giây, một `jti`, gắn `ticket_id` + `peer_id` + tên nhân viên.

`hbbs` chỉ giữ khóa công khai, verify cục bộ. Không đưa refresh token ezID lên `hbbs`.

**Rationale**: Access token ezID sống theo `expires_in` của IdP và không mô tả “một lượt vào một máy”. Nhét token đó vào UDP keepalive 30 giây (`REG_TIMEOUT`) làm lộ token trong log và không thu hồi được một lượt kết nối.

**Alternatives considered**:

- Dùng `access_token` sẵn có của RustDesk Pro (`flutter/lib/models/user_model.dart` gọi `/api/currentUser`): đó là tài khoản RustDesk, không phải ezID.
- `hbbs` gọi ezID introspection mỗi lần punch: thêm độ trễ và một bí mật client trên server rendezvous cho mỗi gói tin.

## R3. Field protobuf dùng lại

**Decision**: Thêm field mới, không đổi nghĩa field cũ ngoại trừ một điểm đã ghi trong contract.

| Message | Thay đổi |
|---|---|
| `RegisterPk` | field 6 `session_token` = presence token |
| `RegisterPeerResponse` | field 3 `auth_required` |
| `RegisterPkResponse.Result` | thêm `AUTH_REQUIRED` |
| `PunchHole` | field 11 `agent_name`, field 12 `ticket_id` do `hbbs` điền sau khi verify |
| `PunchHoleRequest.token` (field 5) | trên bản fork này là connect grant, không còn là access token tài khoản RustDesk |
| `PunchHoleResponse.Failure` | thêm `AUTH_REQUIRED` |
| `RequestRelay.token` (field 8) | cùng connect grant |

Sửa cả `libs/hbb_common/protos/rendezvous.proto` và `rustdesk-server/libs/hbb_common/protos/rendezvous.proto`. Hai checkout đang ở hai commit khác nhau (`fae47e0` trên client, `69cea8d` trên server).

**Rationale**: Proto3 thêm field số mới vẫn đọc được bởi decoder cũ, nhưng server ezCloud cố ý từ chối bản thiếu token. Hai bên fork phải cùng schema.

## R4. Chấp nhận trên máy khách

**Decision**: Khi có `ticket_id` từ `PunchHole` trùng yêu cầu đang mở trên máy, hộp thoại hiện `agent_name` và chỉ cho `ApproveMode::Click` (`src/server/connection.rs`). Tắt mật khẩu thường trực trong Settings của bản này. Lệch ticket thì từ chối, không mở điều khiển.

**Rationale**: FR-010 và FR-011. Mật khẩu đọc qua điện thoại không gắn với danh tính ezID của nhân viên.

## R5. Broker là tiến trình riêng

**Decision**: `ezcloud-support-broker/`, Node.js 22, Fastify, SQLite, ký Ed25519. Contract: `contracts/broker.openapi.yaml`.

**Rationale**: Hàng đợi và thu hồi `jti` là trạng thái nghiệp vụ. `hbbs` giữ việc bắt cặp. Tách process để khóa ký không nằm trong binary điều khiển từ xa, và phần code mới không trộn vào lịch sử AGPL trừ khi publish cùng đợt (FR-016 yêu cầu source của bản phát hành, gồm broker).

**Alternatives considered**:

- Rust/axum trong `rustdesk-server`: một toolchain, nhưng nhét nghiệp vụ ezCloud vào binary AGPL và khó tách secret.
- RustDesk Server Pro + OIDC: console Pro không thuộc hai repo OSS và không có trong workspace.

## R6. Vai trò

**Decision**: Scope ezID `roles`, claim `role` (chuỗi hoặc mảng). Biến `EZID_SUPPORTER_ROLES` là danh sách giá trị được coi là nhân viên. Còn lại là khách. Chưa bịa tên role. Team ezID xác nhận giá trị trước khi bật production.

**Rationale**: FR-003. Spec cấm gắn cứng tên role.

## R7. Đăng nhập desktop

**Decision**: Public client, PKCE S256, redirect `http://127.0.0.1:{port}/callback` với port cố định theo môi trường, đã đăng ký với ezID. Rust (`src/ezcloud/`) giữ verifier, đổi code, verify `id_token` (`iss`, `aud` = client_id, `exp`, `nonce`). Flutter chỉ vẽ. Refresh token trong keychain.

**Rationale**: Skill ezID: desktop/mobile không được có `client_secret`. Verify trước khi tin `sub`.

## R8. Giấy phép và tên sản phẩm

**Decision**: Đổi tên hiển thị sang ezCloud Remote bằng cơ chế custom client sẵn có (Flutter đã coi app name khác `RustDesk` là custom client). Tab About trong `flutter/lib/desktop/pages/desktop_setting_page.dart` thêm dòng bản đã sửa, ngày, AGPL-3.0, URL source. Không xóa file `LICENCE` và `rustdesk-server/LICENSE`. Không dùng logo RustDesk làm logo sản phẩm.

**Rationale**: FR-015, FR-016, FR-017. AGPL cho phép đổi tên; không cho xóa bản quyền gốc.

## R9. Phân quyền phần quản lý

**Decision**: Chỉ HTTP quản lý trên broker dùng Central ACL. Làm theo `ezcloud.central.ACL/docs/integration-guide.md`.

- Verify ezID trước, lấy `sub` và `email` từ token đã verify, gửi cả hai khi gọi `POST /subjects/permissions`.
- Danh mục trong `ezcloud-support-broker/src/acl/catalog.ts`. Không bảng role trong SQLite. Chi tiết mã quyền: `contracts/acl-catalog.md`.
- Một guard Fastify `preHandler` đọc `src/acl/route-permissions.ts`. Route quản lý không có trong bảng → 403 `acl_unmapped`.
- Cache theo người ≤ 300 giây. ACL timeout hoặc 5xx: dùng bản cũ tối đa 120 giây, rồi 503 `acl_unavailable`.
- Ba chế độ `off` | `shadow` | `enforce`, lưu trong bảng settings (key mã hoá). `ACL_MODE=off` ghi đè. Không URL/key thì các route quản lý **từ chối**, vì ứng dụng chưa có phân quyền cũ để quay về. Trang `/admin/acl` không đi qua ACL; chỉ email trong `ACL_BREAK_GLASS_EMAILS` vào được.
- Không bật `enforce` nếu người bật không nhận quyền nào (409).
- Frontend quản lý lấy quyền từ `GET /admin/me`. Không gọi `acl.ezcloud.vn` từ trình duyệt.
- Desktop (hàng đợi nhân viên theo claim ezID) và `hbbs`/`hbbr` không gọi ACL.
- `rustdesk-server/ui` là cửa sổ log/tray trên máy đang chạy server, không phải UI quản lý. Không thêm ACL vào đó và không mở nó ra mạng.
- Chưa có phân quyền cũ nên không làm `PUT /assignments/import`.

**Rationale**: FR-019 đến FR-026. OSS server không có console đa người dùng. Phần quản lý mới nằm ở broker, nơi có dữ liệu mọi khách.

**Alternatives considered**:

- Dùng claim `role` của ezID cho cả trang quản lý: tách khỏi ACL trong khi các app ezCloud khác đã gom quyền ở một chỗ.
- Gắn ACL vào từng punch trên `hbbs`: thêm độ trễ và một API key trên đường UDP; spec nói luồng hỗ trợ desktop không phụ thuộc ACL.
