# Quickstart: kiểm tra 001-ezid-customer-support

**Date**: 2026-11-03

Mục này dùng sau khi các task đã được làm, để đối chiếu spec. Chưa phải hướng dẫn triển khai production.

## Chuẩn bị

1. Team ezID cấp `client_id` public và đăng ký redirect `http://127.0.0.1:{port}/callback` trên `https://dev-id.ezcloud.vn`. Không có `client_secret` trong app.
2. Xác nhận giá trị claim `role` của một tài khoản nhân viên. Ghi vào `EZID_SUPPORTER_ROLES`.
3. Ba tiến trình trên máy dev:
   - broker, cổng HTTP nội bộ
   - `hbbs` và `hbbr` với `EZCLOUD_AUTH_REQUIRED=Y`, trỏ JWKS của broker
   - client desktop trỏ ID server đó, không trỏ server công cộng của RustDesk

## Kiểm tra theo story

**US1.** Chưa đăng nhập, từ một client khác punch vào ID của máy này. `hbbs` không giữ peer. Kết quả là không kết nối được.

Đăng nhập ezID bằng tài khoản khách. Trong vòng vài giây `hbbs` thấy peer. Đăng xuất. Trong vòng một phút punch mới thất bại.

**US2.** Khách bấm yêu cầu hỗ trợ. Nhân viên kết nối. Hộp thoại trên máy khách ghi đúng tên nhân viên. Bấm từ chối: không có hình. Tạo yêu cầu mới, bấm đồng ý: nhân viên thấy màn hình.

Dùng grant của máy A để punch máy B: `hbbs` trả từ chối, máy B không hiện hộp thoại.

**US3.** Tài khoản khách không thấy hàng đợi. Tài khoản nhân viên thấy yêu cầu vừa tạo và không có ô gõ ID. Dùng lại đúng grant: lần hai bị từ chối.

**US4.** Đang trong phiên, khách kết thúc. Nhân viên hết hình trong vòng một phút. Yêu cầu đóng không cấp grant mới.

**US5.** Tiêu đề và About ghi ezCloud Remote, có dòng bản đã sửa của RustDesk và AGPL-3.0. File `LICENCE` và `rustdesk-server/LICENSE` vẫn còn.

**US6.** Mở trang quản lý bằng tài khoản không được gán trên ACL: danh sách mọi yêu cầu bị từ chối. Tài khoản Support Viewer xem được và không đóng được. Support Operator đóng được một yêu cầu đang chờ. Ngắt mạng tới `acl.ezcloud.vn` khi chế độ bắt buộc: thao tác quản lý bị từ chối. Trang cấu hình ACL vẫn mở với email break-glass. Ứng dụng desktop của khách vẫn tạo được yêu cầu trong lúc ACL không trả lời.

**Bản gốc.** Cài RustDesk upstream, trỏ cùng ID server và key. Đăng ký peer thất bại.

## Log

Tìm trong log broker và `hbbs` các chuỗi `eyJ` và `code=`. Không được có JWT hay authorization code.
