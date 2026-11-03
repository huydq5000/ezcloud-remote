---
description: "Task list for ezCloud Remote — ezID login and support queue"
---

# Tasks: Hỗ trợ khách hàng từ xa có đăng nhập ezID

**Input**: Design documents from `/specs/001-ezid-customer-support/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/broker.openapi.yaml, contracts/rendezvous.md, contracts/acl-catalog.md, quickstart.md

**ACL**: Mọi route quản lý mới phải có một dòng trong `ezcloud-support-broker/src/acl/route-permissions.ts`, dùng mã trong `src/acl/catalog.ts`. `test/acl-catalog.test.ts` thất bại nếu thiếu. Desktop và `hbbs` không gọi ACL.

**Tests**: Spec không yêu cầu TDD. Chỉ thêm test cho đường từ chối mà plan.md nêu là guardrail: đăng ký không token, punch sai máy, grant dùng lại, role khách không lấy được hàng đợi.

**Organization**: Theo user story trong spec.md. US2 và US3 đều P1; US3 dùng API ticket của US2 nên làm sau US2. US1 là MVP độc lập (đăng nhập xong máy mới online).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1–US5
- Đường dẫn theo plan.md: client ở gốc repo, server trong `rustdesk-server/`, broker trong `ezcloud-support-broker/`

---

## Phase 1: Setup

**Purpose**: Khung broker và cấu hình, chưa có hành vi người dùng

- [x] T001 Tạo project Node 22 `ezcloud-support-broker/` với `package.json` (script `dev`, `test`), `tsconfig.json`, `src/main.ts` (Fastify, prefix không thêm ngoài path trong OpenAPI), và `.gitignore` bỏ `.env` cùng file SQLite
- [x] T002 [P] Thêm `ezcloud-support-broker/.env.example` với `EZID_ISSUER`, `EZID_AUDIENCE`, `EZID_SUPPORTER_ROLES`, `EZCLOUD_JWT_ISS`, `EZCLOUD_JWT_PRIVATE_KEY_PATH`, `DATABASE_PATH`, `LISTEN_ADDR`, `ACL_BASE_URL`, `ACL_API_KEY`, `ACL_MODE`, `ACL_BREAK_GLASS_EMAILS`, `SETTINGS_ENC_KEY`. Không có `client_secret`. `ACL_API_KEY` chỉ là ví dụ secret ref, không phải key thật
- [x] T003 [P] Thêm `ezcloud-support-broker/README.md` chỉ cách chạy local và trỏ tới `specs/001-ezid-customer-support/contracts/broker.openapi.yaml`

---

## Phase 2: Foundational (Blocking)

**Purpose**: Schema protobuf, ký và verify JWT. Mọi story đều cần lớp này.

**⚠️ CRITICAL**: Không bắt đầu user story trước khi phase này xong.

- [x] T004 Sửa `libs/hbb_common/protos/rendezvous.proto` theo `specs/001-ezid-customer-support/contracts/rendezvous.md` (`RegisterPk.session_token`, `RegisterPeerResponse.auth_required`, enum `AUTH_REQUIRED`, `PunchHole.agent_name`, `PunchHole.ticket_id`) và regenerate code protobuf mà build RustDesk đang dùng
- [x] T005 [P] Áp cùng diff proto cho `rustdesk-server/libs/hbb_common/protos/rendezvous.proto` và regenerate code phía server
- [x] T006 Tạo schema SQLite trong `ezcloud-support-broker/src/db.ts`: bảng `profile` (`sub`, `name`, `role`), `ticket` (các cột trong data-model.md, unique một ticket `waiting`/`active` theo `device_id`), `used_jti` (`jti`, `exp`)
- [x] T007 [P] Viết `ezcloud-support-broker/src/ezid.ts`: lấy JWKS từ `{EZID_ISSUER}/.well-known/openid-configuration`, verify access token (`iss`, `aud`, `exp`, `kid`), đọc `sub` và `role`, map role bằng `EZID_SUPPORTER_ROLES`
- [ ] T008 Viết `ezcloud-support-broker/src/tokens.ts`: ký presence (`typ=ezcloud-presence`, 600 giây) và connect grant (`typ=ezcloud-connect`, 60 giây, `jti`) bằng Ed25519; phục vụ `GET /.well-known/ezcloud-support-jwks`
- [x] T009 Viết `rustdesk-server/src/ezcloud_auth.rs`: tải JWKS hoặc đọc `EZCLOUD_JWT_PUBLIC_KEY`, verify `iss`/`typ`/`exp`, trả `sub`, `role`, `name`, `device_uuid`, `ticket_id`, `peer_id`, `jti`. Bỏ qua verify khi `EZCLOUD_AUTH_REQUIRED` không phải `Y` để test upstream vẫn build

**Checkpoint**: Broker ký được một presence token và `ezcloud_auth.rs` verify được bằng khóa công khai. Chưa có UI.

---

## Phase 3: User Story 1 - Khách đăng nhập ezID để máy sẵn sàng (Priority: P1) MVP

**Goal**: Máy chỉ online trên `hbbs` sau khi đăng nhập ezID. Đăng xuất thì hết online.

**Independent Test**: Punch tới máy chưa đăng nhập thì thất bại. Đăng nhập thì `hbbs` thấy peer. Đăng xuất, trong một phút punch thất bại. Xem quickstart mục US1.

### Tests

- [x] T010 [P] [US1] Test `ezcloud-support-broker/test/sessions.test.ts`: access token sai `iss` hoặc hết hạn thì `POST /v1/sessions` trả 401; token hợp lệ trả `presence_token` và `role`
- [x] T011 [P] [US1] Test `rustdesk-server` cho `RegisterPk` thiếu `session_token` khi auth bật: kết quả `AUTH_REQUIRED`, không có peer online

### Implementation

- [x] T012 [US1] Implement `POST /v1/sessions`, `POST /v1/sessions/refresh`, `DELETE /v1/sessions/current` trong `ezcloud-support-broker/src/routes/sessions.ts` đúng `contracts/broker.openapi.yaml`. Refresh chỉ nhận access token ezID, không nhận refresh token
- [x] T013 [P] [US1] Thêm `src/ezcloud/oidc.rs`: loopback `127.0.0.1` port cấu hình, `state`, `nonce`, PKCE S256, đổi code tại `/connect/token` không gửi `client_secret`, verify `id_token` (`iss`, `aud`, `exp`, `nonce`)
- [x] T014 [P] [US1] Thêm `src/ezcloud/session.rs`: gọi broker lấy presence, giữ presence trong bộ nhớ, ghi refresh token ezID vào keychain, gia hạn trước 10 phút, xóa khi đăng xuất
- [x] T015 [US1] Trong `src/rendezvous_mediator.rs` (`register_pk` và `register_peer`): gửi `session_token`; không đăng ký khi chưa có presence; khi nhận `auth_required` thì xóa phiên local
- [x] T016 [US1] Trong `rustdesk-server/src/rendezvous_server.rs` nhánh `RegisterPk` và `RegisterPeer`: gọi `ezcloud_auth`, từ chối và trả `auth_required` / `AUTH_REQUIRED` theo contract; khi hợp lệ ghi `sub` vào `peer.user` qua `rustdesk-server/src/database.rs`
- [x] T017 [US1] Thêm `flutter/lib/desktop/pages/ezcloud_login_page.dart` và chặn `flutter/lib/desktop/pages/desktop_home_page.dart` khi chưa có presence. Nút đăng nhập, hủy đăng nhập quay lại màn này, nút đăng xuất gọi `DELETE /v1/sessions/current` rồi end-session ezID
- [x] T018 [US1] Tắt đường tài khoản RustDesk Pro trên desktop: không gọi `/api/currentUser` từ `flutter/lib/models/user_model.dart` khi build ezCloud (giữ file, nhánh early-return theo cờ custom client)

**Checkpoint**: US1 chạy được mà chưa cần hàng đợi. Máy đã đăng nhập online; chưa đăng nhập thì không.

---

## Phase 4: User Story 2 - Khách yêu cầu hỗ trợ và chấp nhận nhân viên (Priority: P1)

**Goal**: Một yêu cầu mỗi máy. Hộp thoại hiện tên nhân viên. Từ chối thì không có phiên điều khiển.

**Independent Test**: Tạo yêu cầu, kết nối, từ chối một lần và đồng ý một lần. Grant của máy khác không mở hộp thoại. Xem quickstart mục US2.

### Tests

- [x] T019 [P] [US2] Test `ezcloud-support-broker/test/tickets-customer.test.ts`: hai lần `POST /v1/tickets` cùng `device_id` trả cùng `ticket_id`; role `supporter` gọi POST này thì 403

### Implementation

- [x] T020 [US2] Implement `POST /v1/tickets` và `POST /v1/tickets/{ticket_id}/close` (phía khách) trong `ezcloud-support-broker/src/routes/tickets.ts`. Đóng ticket khi presence khách hết hạn không refresh
- [x] T021 [US2] Trên `flutter/lib/desktop/pages/desktop_home_page.dart` thêm nút yêu cầu hỗ trợ và trạng thái đang chờ / đang hỗ trợ / đã đóng, gọi API ticket bằng presence của khách
- [x] T022 [US2] Trong `rustdesk-server/src/rendezvous_server.rs` `handle_punch_hole_request` và nhánh `FetchLocalAddr`: verify connect grant, điền `PunchHole.agent_name` và `ticket_id` từ grant, thất bại thì `AUTH_REQUIRED` và không trả địa chỉ
- [x] T023 [US2] Trong `src/server/connection.rs`: nếu `ticket_id` tới máy không trùng yêu cầu đang mở thì từ chối im lặng; nếu trùng thì hộp thoại chỉ có click, hiện `agent_name`, không chấp nhận bằng mật khẩu thường trực
- [x] T024 [US2] Ẩn tùy chọn mật khẩu cố định trong tab Safety của `flutter/lib/desktop/pages/desktop_setting_page.dart` trên bản ezCloud

**Checkpoint**: Có thể giả lập grant hợp lệ (task US3 chưa có UI nhân viên) để khách thấy tên và chấp nhận hoặc từ chối.

---

## Phase 5: User Story 3 - Nhân viên xử lý hàng đợi (Priority: P1)

**Goal**: Nhân viên chỉ vào máy từ hàng đợi. Một grant một lần. Khách không thấy hàng đợi.

**Independent Test**: Hai loại tài khoản. Nhân viên kết nối từ danh sách. Gõ ID không có trên UI. Grant dùng lần hai bị từ chối. Xem quickstart mục US3.

### Tests

- [x] T025 [P] [US3] Test `ezcloud-support-broker/test/tickets-supporter.test.ts`: presence `customer` gọi `GET /v1/tickets` thì 403; supporter lấy connect grant; gọi connect lần nữa khi ticket đã không còn `waiting` thì 409
- [x] T026 [P] [US3] Test `rustdesk-server` punch: grant có `peer_id` khác ID đích, hoặc `jti` đã dùng, trả `AUTH_REQUIRED` và không có địa chỉ peer

### Implementation

- [x] T027 [US3] Thêm `GET /v1/tickets?status=waiting` và `POST /v1/tickets/{ticket_id}/connect` vào `ezcloud-support-broker/src/routes/tickets.ts`. Connect ghi `used_jti`, chuyển ticket sang `active`, trả grant 60 giây
- [x] T028 [US3] Thêm hàng đợi `flutter/lib/desktop/pages/ezcloud_queue_page.dart`, chỉ mount khi presence `role=supporter`. Bấm kết nối lấy grant rồi gọi luồng có sẵn
- [x] T029 [US3] Trong `src/client.rs` chỗ tạo `PunchHoleRequest` (khoảng dòng 955): `token` là connect grant của ticket vừa chọn, không phải `access_token` tài khoản RustDesk
- [x] T030 [US3] Gỡ ô nhập ID và kết nối trực tiếp theo IP khỏi `flutter/lib/desktop/pages/desktop_home_page.dart` trên bản ezCloud
- [x] T031 [US3] Trong `rustdesk-server/src/relay_server.rs` `make_pair_`: khi auth bật, `RequestRelay.token` phải là connect grant còn trong 60 giây và `peer_id` khớp `id`. Giữ kiểm tra `licence_key` hiện có

**Checkpoint**: US1–US3 đủ một phiên hỗ trợ thật từ đăng nhập khách đến nhân viên thấy màn hình sau khi khách đồng ý.

---

## Phase 6: User Story 4 - Kết thúc phiên (Priority: P2)

**Goal**: Đóng từ hai phía thì hết quyền điều khiển và yêu cầu không dùng lại.

**Independent Test**: Đóng từ khách và từ nhân viên ở hai lần chạy. Yêu cầu `closed` không cấp grant. Xem quickstart mục US4.

- [x] T032 [US4] Khi khách hoặc nhân viên bấm kết thúc trên UI desktop, gọi `POST /v1/tickets/{ticket_id}/close` rồi ngắt kết nối RustDesk hiện tại trong `src/server/connection.rs` / phiên client
- [x] T033 [US4] `POST /v1/tickets/{ticket_id}/connect` trả 409 nếu status là `closed`. UI hàng đợi bỏ ticket đã đóng
- [x] T034 [US4] Đăng xuất khách (đã có ở T017) phải đóng ticket đang `waiting` hoặc `active` của `device_id` đó trước khi xóa presence

**Checkpoint**: Hết phiên trong vòng một phút, không vào lại bằng yêu cầu cũ.

---

## Phase 7: User Story 5 - Tên sản phẩm và mã nguồn (Priority: P3)

**Goal**: Bản đóng gói mang tên ezCloud Remote và ghi nhận RustDesk, AGPL-3.0.

**Independent Test**: Mở About, đối chiếu `LICENCE` vẫn còn. Xem quickstart mục US5.

- [x] T035 [P] [US5] Đặt tên hiển thị ezCloud Remote tại chỗ RustDesk đang lấy app name cho desktop (cờ build / config), để `is_custom_client` nhận tên khác `RustDesk`
- [x] T036 [P] [US5] Sửa widget About trong `flutter/lib/desktop/pages/desktop_setting_page.dart`: dòng bản đã sửa của RustDesk, ngày, AGPL-3.0, URL source lấy từ cấu hình. Không xóa `LICENCE` hay `rustdesk-server/LICENSE`
- [ ] T037 [US5] Thay icon desktop bằng icon ezCloud. Không ship logo RustDesk làm icon sản phẩm

**Checkpoint**: Cửa sổ và About đúng FR-015. Source URL trỏ tới commit sẽ publish.

---

## Phase 8: User Story 6 - Quản lý server theo Central ACL (Priority: P2)

**Goal**: Trang và API quản lý trên broker đăng nhập ezID và chịu Central ACL. Desktop và `hbbs` không đổi theo story này.

**Independent Test**: Ba tài khoản (không quyền, chỉ xem, được đóng). Cắt mạng tới ACL ở chế độ enforce thì thao tác quản lý bị từ chối. Trang `/admin/acl` vẫn mở với email break-glass. Xem quickstart mục US6.

### Tests

- [x] T041 [P] [US6] Viết `ezcloud-support-broker/test/acl-catalog.test.ts`: mọi route quản lý có đúng một dòng; mã quyền thuộc catalog; route công khai, luồng `/v1/*` của khách/nhân viên desktop, và `/admin/acl` không bị đòi quyền ACL; quyền không có `resourceType` được coi là toàn ứng dụng

### Implementation

- [x] T042 [US6] Viết `ezcloud-support-broker/src/acl/catalog.ts` theo `contracts/acl-catalog.md`: `support.read`, `support.change`, `support.config` và ba vai trò mặc định
- [x] T043 [US6] Viết `ezcloud-support-broker/src/acl/route-permissions.ts` cho `GET /admin/tickets`, `GET /admin/devices`, `POST /admin/tickets/:id/close`, `GET /admin/me`, và nhóm miễn trừ (công khai, `/v1/*` desktop, `/admin/acl`)
- [x] T044 [US6] Thêm bảng `acl_settings`, `acl_push_log`, `acl_shadow_diff` trong `ezcloud-support-broker/src/db.ts`. Key ACL mã hoá bằng `SETTINGS_ENC_KEY`. API không trả key, chỉ `apiKeySet`
- [x] T045 [US6] Viết `ezcloud-support-broker/src/acl/guard.ts`: verify ezID lấy `sub` và `email`, cache `POST /subjects/permissions` ≤ 300 giây, stale-if-error ≤ 120 giây, 403 `forbidden_acl`, 403 `acl_unmapped`, 503 `acl_unavailable`. Gắn một `preHandler` trong `src/main.ts`
- [x] T046 [US6] Trang và API `ezcloud-support-broker/src/routes/admin.ts`: `GET /admin/me` trả quyền hiệu lực; `GET /admin/tickets` cần `support.read`; `POST /admin/tickets/:id/close` cần `support.change` và chuyển ticket sang `closed`; UI ẩn nút đóng khi không có `support.change`. Trình duyệt không gọi acl.ezcloud.vn
- [x] T047 [US6] Trang `/admin/acl` trong `ezcloud-support-broker/src/routes/admin-acl.ts`: sửa URL, key, chế độ; nút đẩy `PUT /manifest` rồi `PUT /roles` với `dryRun` trước; chặn enforce khi người bật không có quyền (409 `acl_enforce_self_lockout`). Chỉ email trong `ACL_BREAK_GLASS_EMAILS` vào được. `ACL_MODE=off` ghi đè chế độ đã lưu

**Checkpoint**: US6 không làm hỏng US1. Khách vẫn tạo yêu cầu khi ACL tắt. Người không có quyền không xem được danh sách quản lý.

---

## Phase 9: Polish

- [x] T038 Rà log trong `ezcloud-support-broker/src/` và `rustdesk-server/src/rendezvous_server.rs`: không ghi JWT, authorization code, access token
- [x] T039 [P] Chạy `ezcloud-support-broker` test và `cargo test` của các test T011, T026
- [ ] T040 Đi quickstart.md trên hai máy desktop (một khách, một nhân viên) với `https://dev-id.ezcloud.vn` và ghi kết quả vào cuối `specs/001-ezid-customer-support/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1) không phụ thuộc gì.
- Foundational (Phase 2) chặn mọi story. T008 phụ thuộc T006. T004 và T005 song song nhưng diff phải giống contract.
- US1 sau Phase 2. US2 sau US1 (cần presence). US3 sau US2 (cần ticket). US4 sau US3. US5 song song với US2 trở đi vì chỉ đụng tên và About.
- Polish sau story muốn phát hành.
- **US6**: sau khi bảng ticket của US2 tồn tại (T020). Không chặn MVP US1. Desktop supporter vẫn dùng claim ezID, không gọi ACL.

### User Story Dependencies

- **US1**: sau Foundational. Không cần ticket.
- **US2**: sau US1. Checkpoint US2 có thể dùng grant ký tay nếu US3 chưa có UI.
- **US3**: sau API ticket của US2 (T020).
- **US4**: sau phiên điều khiển của US3.
- **US5**: sau Phase 2, không cần hàng đợi.

### Parallel Opportunities

- T002 và T003 song song với T001 sau khi thư mục broker tồn tại.
- T004 và T005 song song.
- T007 song song với T006.
- T010 và T011 song song.
- T013 và T014 song song sau T012.
- T025 và T026 song song.
- T035 và T036 song song.

### Parallel Example: User Story 1

```text
T010 sessions.test.ts
T011 hbbs RegisterPk reject test
```

Sau khi T012 xong:

```text
T013 src/ezcloud/oidc.rs
T014 src/ezcloud/session.rs
```

---

## Implementation Strategy

### MVP (chỉ US1)

1. Phase 1 và Phase 2.
2. Phase 3.
3. Dừng và chạy mục US1 của quickstart. Máy chưa đăng nhập không online là đủ để demo chặn truy cập.

### Incremental

1. Thêm US2: khách tạo yêu cầu và hộp thoại chấp nhận (grant có thể ký bằng công cụ dev).
2. Thêm US3: hàng đợi nhân viên, bỏ ô nhập ID.
3. Thêm US4 rồi US5.
4. Thêm US6 khi đã có ticket. Cần Super Admin đăng ký ứng dụng `ezcloud-remote` trên ACL và App Admin tạo API key trước khi bật enforce.
5. Phase 9 trước khi đưa bản ra ngoài git nội bộ.

---

## Notes

- Không commit secret, `.env`, hay khóa ký.
- Không xóa bản quyền upstream khi làm T035–T037.
- Điện thoại không có task UI. Build mobile không được gãy chỉ vì thiếu màn hình mới; không cần luồng hỗ trợ trên mobile trong bản này.
