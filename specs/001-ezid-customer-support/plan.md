# Implementation Plan: Hỗ trợ khách hàng từ xa có đăng nhập ezID

**Branch**: `001-ezid-customer-support` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ezid-customer-support/spec.md`

## Summary

ezCloud Remote là bản fork của RustDesk (client 1.5.1, server 1.1.17) để nhân viên hỗ trợ khách đã đăng nhập ezID. Khách không gửi mã máy. Nhân viên không gõ ID. Mỗi kết nối cần một yêu cầu đang mở và nút chấp nhận trên máy khách.

Cách làm, chi tiết ở [research.md](./research.md):

- **Client** (repo này): đăng nhập ezID bằng Authorization Code + PKCE trên loopback. Chỉ sau khi có phiên thì mới đăng ký lên `hbbs`.
- **Broker** (`ezcloud-support-broker/`): dịch vụ mới. Verify token ezID, phát presence token 10 phút và connect grant 60 giây, một lần. Giữ hàng đợi yêu cầu hỗ trợ.
- **`hbbs` / `hbbr`** (`rustdesk-server/`): từ chối đăng ký và bắt cặp khi thiếu token hợp lệ. `hbbs` ghi tên nhân viên vào thông báo bắt cặp để hộp thoại chấp nhận hiển thị.
- Tài khoản RustDesk Pro (`UserModel`, `/api/currentUser`) không dùng cho ezID.
- Desktop Windows và macOS. Điện thoại ngoài phạm vi bản này.
- **Phần quản lý** (API và trang trên broker): đăng nhập ezID, phân quyền bằng Central ACL theo `ezcloud.central.ACL/docs/integration-guide.md`. Danh mục quyền nằm trong `ezcloud-support-broker/src/acl/catalog.ts`. Desktop khách/nhân viên và đường `hbbs` không gọi ACL.
- Cửa sổ log `rustdesk-server/ui` giữ nguyên, không đưa ra mạng và không gắn ACL.

## Technical Context

**Language/Version**: Rust 1.75+ (client và `rustdesk-server` 1.1.17); TypeScript trên Node.js 22 (broker)

**Primary Dependencies**:

- Client/server: stack RustDesk hiện có (Flutter desktop, protobuf `rendezvous.proto`, sodiumoxide trên server).
- Broker: Fastify, `jose` (verify JWT ezID qua JWKS và ký JWT riêng), better-sqlite3. Gọi Central ACL bằng HTTP từ backend (`Authorization: Bearer acl_…`), không dùng SDK trên desktop.
- ezID: IdentityServer4, Authorization Code + PKCE, authority theo môi trường (`dev-id` / `uat-id` / `id.ezcloud.vn`).

**Storage**:

- Broker: SQLite (yêu cầu hỗ trợ, `jti` đã dùng, ánh xạ `sub`).
- `hbbs`: SQLite sẵn có, cột `peer.user` lưu `sub`. Presence và hạn dùng nằm trong RAM của tiến trình `hbbs`.
- Client: refresh token ezID trong keychain hệ điều hành; presence token chỉ trong bộ nhớ.

**Testing**: `cargo test` cho cổng xác thực của `hbbs`/`hbbr`; `node --test` cho broker. Không yêu cầu TDD toàn bộ. Bắt buộc test các đường từ chối trong spec (chưa đăng nhập, grant sai máy, grant dùng lại, role khách không thấy hàng đợi).

**Target Platform**: Windows và macOS cho ứng dụng desktop. Linux cho `hbbs`, `hbbr` và broker. Điện thoại không làm UI mới.

**Project Type**: Ứng dụng desktop có sẵn, cộng một dịch vụ HTTP nội bộ và bản fork của ID/relay server.

**Performance Goals**:

- Máy chưa đăng nhập hoặc vừa đăng xuất không nhận kết nối mới trong vòng 1 phút (SC-001, SC-005). `hbbs` đã coi peer offline sau `REG_TIMEOUT` = 30 giây.
- Khách có sẵn tài khoản ezID đăng nhập và tạo yêu cầu trong vòng 3 phút, không đọc mã máy (SC-002).
- Kiểm tra grant trên `hbbs` là xác minh chữ ký cục bộ, không gọi ezID trên đường UDP keepalive.

**Constraints**:

- AGPL-3.0: không xóa `LICENCE` / `LICENSE` và thông báo bản quyền gốc. Phần giới thiệu ghi ezCloud Remote là bản đã sửa của RustDesk.
- Desktop là public client: không nhúng `client_secret`.
- Khóa người dùng là claim `sub`.
- Không log JWT, authorization code, access token ezID.
- `EZCLOUD_AUTH_REQUIRED=Y` trên server ezCloud: client RustDesk gốc không đăng ký và không punch được.
- Phần quản lý: fail-closed khi ACL lỗi (503), route chưa khai báo thì 403 `acl_unmapped`, thiếu quyền thì 403 `forbidden_acl`. Cache quyền theo người ≤ 300 giây, stale-if-error ≤ 120 giây. `ACL_MODE=off` tắt khẩn cấp. API key ACL chỉ ở backend.
- Không mật khẩu thường trực, không vào máy khi không có người chấp nhận.

**Scale/Scope**: Một đội hỗ trợ ezCloud và các máy khách đang mở yêu cầu. Không phải sàn công cộng. Một nhân viên một máy tại một thời điểm.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Repo này chưa có `.specify/memory/constitution.md`. Không có nguyên tắc đã phê chuẩn để đối chiếu. **Status: PASS (no constraints defined).**

Guardrail mặc định cho đến khi có constitution:

| Guardrail | Cách plan đáp ứng |
|---|---|
| Đơn giản | Không thêm console quản trị, không ghi hình, không sổ địa chỉ. Broker một tiến trình, SQLite. |
| Ép buộc ở server | UI chỉ là lớp hiển thị. `hbbs` từ chối peer và punch không có token (FR-014). |
| Contract trước code | `contracts/broker.openapi.yaml` và `contracts/rendezvous.md` có trước implementation. |
| Bí mật | `client_secret` không có trên client. Khóa ký JWT của broker và API key ACL không vào git. Log không chứa token. |
| Phân quyền quản lý | Một guard trên broker. Danh mục và bảng route trong mã. Trang cấu hình ACL không đi qua ACL. Desktop và `hbbs` không gọi ACL. |
| Giấy phép | Giữ license upstream. Source của bản phát hành được publish (FR-016). |

**Post-design re-check**: PASS. Ba tiến trình (client, server, broker) được ghi ở Complexity Tracking vì gộp broker vào `hbbs` sẽ đưa bí mật ezID và hàng đợi vào đường UDP, và không chặn được client gốc.

## Project Structure

### Documentation (this feature)

```text
specs/001-ezid-customer-support/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── broker.openapi.yaml
│   └── rendezvous.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/ezcloud/                  # OIDC, presence, gọi broker (mới)
src/rendezvous_mediator.rs    # register_pk / register_peer
src/client.rs                 # PunchHoleRequest của nhân viên
src/server/connection.rs      # chấp nhận kết nối phía khách
flutter/lib/desktop/pages/    # đăng nhập, hàng đợi, về chúng tôi
libs/hbb_common/protos/rendezvous.proto

rustdesk-server/src/rendezvous_server.rs
rustdesk-server/src/relay_server.rs
rustdesk-server/src/ezcloud_auth.rs
rustdesk-server/libs/hbb_common/protos/rendezvous.proto

ezcloud-support-broker/       # dịch vụ mới, không fork từ RustDesk
├── src/acl/                 # catalog, route table, guard, settings
├── src/
└── test/

rustdesk-server/ui/          # tray/log cục bộ, không gắn ACL, không publish ra mạng
```

**Structure Decision**: Giữ nguyên cây RustDesk. Thêm `src/ezcloud/` trên client, `ezcloud_auth.rs` trên server, và thư mục `ezcloud-support-broker/` cho dịch vụ mới. Hai bản `rendezvous.proto` (client và server đang pin hai commit `hbb_common` khác nhau) phải sửa giống nhau cho đến khi cả hai submodule trỏ cùng một fork `hbb_common`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Thêm broker bên cạnh hbbs/hbbr | FR-002, FR-006, FR-009 cần hàng đợi và token ngắn, thu hồi được | Nhét ezID vào `hbbs`: mọi keepalive UDP phải gọi ezID; client gốc vẫn punch nếu chỉ chặn trên UI; bí mật xác thực nằm trên đường rendezvous |
| Sửa cả hai bản `hbb_common` | Client và server trong workspace này không dùng chung một checkout submodule | Chỉ sửa một bên thì hai tiến trình không hiểu field mới |

## Phase 0 và Phase 1

Phase 0: [research.md](./research.md). Các quyết định R1–R8 đã chốt, không còn NEEDS CLARIFICATION trong plan.

Phase 1:

- [data-model.md](./data-model.md)
- [contracts/broker.openapi.yaml](./contracts/broker.openapi.yaml)
- [contracts/rendezvous.md](./contracts/rendezvous.md)
- [contracts/acl-catalog.md](./contracts/acl-catalog.md)
- [quickstart.md](./quickstart.md)
