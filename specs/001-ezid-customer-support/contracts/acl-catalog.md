# Contract: danh mục quyền phần quản lý

**Feature**: `001-ezid-customer-support` | **Date**: 2026-11-03

Nguồn: `ezcloud.central.ACL/docs/integration-guide.md`. Mã ứng dụng đề xuất khi Super Admin đăng ký: `ezcloud-remote`. Chưa có API key trong repo.

File sinh ra từ một catalog trong `ezcloud-support-broker/src/acl/catalog.ts`. Không có `resourceType` ở bản này: đội hỗ trợ chưa giao quyền theo từng khách sạn hay từng máy.

## Quyền

| Mã | Mức | Thao tác |
|---|---|---|
| `support.read` | xem | Danh sách mọi yêu cầu, máy đang online, người đang đăng nhập |
| `support.change` | sửa | Đóng yêu cầu của người khác, ngắt phiên quản lý đang mở |
| `support.config` | cấu hình | Tham số broker ngoài trang kết nối ACL (issuer hiển thị, thời gian presence). Không gồm API key ACL |

## Vai trò mặc định

| Vai trò | Quyền | requestable |
|---|---|---|
| Support Viewer | `support.read` | không |
| Support Operator | `support.read`, `support.change` | không |
| Support Admin | cả ba quyền | không |

Đẩy bằng `PUT /manifest` rồi `PUT /roles` (`dryRun` trước). Không gọi `PUT /assignments/import`.

## Route

Bảng trong `ezcloud-support-broker/src/acl/route-permissions.ts`. Mỗi route quản lý một dòng.

| Nhóm | Ví dụ | ACL |
|---|---|---|
| Công khai | `GET /health` | không |
| Đăng nhập ezID, không phải quản lý | `POST /v1/sessions`, `POST /v1/tickets` của khách, `GET /v1/tickets` của nhân viên desktop | không — đây là luồng US1–US3 |
| Chỉ cần đã đăng nhập ezID | `GET /admin/me` | không kiểm tra quyền; response chứa quyền hiệu lực để UI ẩn nút |
| Cấu hình ACL | `GET/PUT /admin/acl/*` | không đi qua ACL; chỉ email trong `ACL_BREAK_GLASS_EMAILS` |
| Quản lý | `GET /admin/tickets`, `POST /admin/tickets/{id}/close`, `GET /admin/devices` | `support.read` hoặc `support.change` như catalog |

Route quản lý thiếu trong bảng: 403 `acl_unmapped`.

Test `ezcloud-support-broker/test/acl-catalog.test.ts` đối chiếu mọi route đăng ký với bảng này.

## Guard

Một `preHandler`. Gọi `POST /subjects/permissions` với `sub` và `email` từ access token ezID đã verify. Đánh giá tại chỗ: quyền không có `resourceType` thì có grant ở bất kỳ phạm vi nào là đủ.

| Tình huống | HTTP | `error` |
|---|---|---|
| Thiếu quyền | 403 | `forbidden_acl` |
| Route chưa khai báo | 403 | `acl_unmapped` |
| ACL không trả lời quá stale 120 giây | 503 | `acl_unavailable` |
| Bật enforce khi người bật không có quyền | 409 | `acl_enforce_self_lockout` |

`mode=off` hoặc chưa có URL/key: route quản lý trả 403, không mở cho mọi người. `shadow`: vẫn từ chối theo cùng quy tắc tạm (chưa có phân quyền cũ), đồng thời ghi khác biệt.
