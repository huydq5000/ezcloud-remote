# Feature Specification: Hỗ trợ khách hàng từ xa có đăng nhập ezID

**Feature Branch**: `001-ezid-customer-support`

**Created**: 2026-11-03

**Status**: Approved

**Input**: User description: "ezCloud dùng phần mềm điều khiển từ xa để nhân viên hỗ trợ khách hàng. Không thương mại hóa sản phẩm. Khách hàng phải đăng nhập ezID mới nhận được hỗ trợ. Phát triển trên git nội bộ, publish GitHub khi hoàn thiện. Sản phẩm mang tên ezCloud Remote."

## Clarifications

### Session 2026-11-03

- Q: Sản phẩm có bán hoặc cấp phép thương mại không? → A: Không. Dùng nội bộ để hỗ trợ khách hàng của ezCloud.
- Q: Ai phải đăng nhập trước khi được hỗ trợ? → A: Khách hàng đăng nhập bằng tài khoản ezID đã có. Nhân viên hỗ trợ cũng đăng nhập ezID.
- Q: Nhân viên có được tự nhập mã máy để kết nối không? → A: Không. Nhân viên chỉ kết nối từ một yêu cầu hỗ trợ đang mở.
- Q: Khách có phải đồng ý trên máy của mình không? → A: Có. Mỗi lần kết nối, khách thấy tên nhân viên và bấm chấp nhận. Không có chế độ vào máy khi không có người ngồi máy.
- Q: Tên sản phẩm và nguồn gốc? → A: Tên hiển thị là ezCloud Remote. Phần giới thiệu ghi nhận đây là bản sửa đổi của RustDesk, giữ giấy phép công khai của dự án gốc, và khi phát hành thì công bố mã nguồn của đúng bản đang phát.
- Q: UI quản lý trên server phân quyền thế nào? → A: Mọi màn hình và thao tác quản lý dùng Central ACL (acl.ezcloud.vn) theo `ezcloud.central.ACL/docs/integration-guide.md`. ezID chỉ xác định họ là ai. Ứng dụng không giữ bảng vai trò riêng cho phần quản lý. Cửa sổ log cục bộ của máy chủ không phải UI quản lý.

## Bối cảnh

Nhân viên ezCloud cần nhìn thấy màn hình máy khách và thao tác giúp khách khi được khách yêu cầu. Khách chỉ được đưa vào hàng đợi hỗ trợ sau khi chứng minh danh tính bằng ezID. Máy chưa đăng nhập thì không ai kết nối tới được. Sản phẩm không bán ra ngoài; mã nguồn của bản phát hành được công bố khi hoàn thiện.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Khách đăng nhập ezID để sẵn sàng nhận hỗ trợ (Priority: P1)

Khách mở ezCloud Remote, đăng nhập bằng ezID, và chỉ sau bước đó máy của khách mới có thể nhận hỗ trợ. Nếu khách hủy đăng nhập, đóng ứng dụng, hoặc đăng xuất, máy trở lại trạng thái không thể bị kết nối.

**Why this priority**: Không có danh tính ezID thì ezCloud không biết đang hỗ trợ ai, và máy lạ không được xuất hiện trong hệ thống hỗ trợ.

**Independent Test**: Dùng một máy chưa đăng nhập và một máy đã đăng nhập ezID. Thử kết nối tới từng máy. Chỉ máy đã đăng nhập là có thể trở thành đích của một yêu cầu hỗ trợ.

**Acceptance Scenarios**:

1. **Given** khách chưa đăng nhập, **When** một nhân viên tìm máy đó để hỗ trợ, **Then** hệ thống báo máy không sẵn sàng và không mở phiên điều khiển.
2. **Given** khách đăng nhập ezID thành công, **When** đăng nhập hoàn tất, **Then** ứng dụng xác nhận đúng tài khoản (tên hiển thị gắn với tài khoản ezID đó) và máy chuyển sang trạng thái có thể yêu cầu hỗ trợ.
3. **Given** khách đang đăng nhập, **When** khách đăng xuất hoặc phiên đăng nhập hết hiệu lực mà không gia hạn được, **Then** trong vòng một phút máy không còn nhận kết nối hỗ trợ mới.
4. **Given** khách hủy cửa sổ đăng nhập ezID, **When** quay lại ứng dụng, **Then** ứng dụng vẫn ở màn đăng nhập và không tạo yêu cầu hỗ trợ.

---

### User Story 2 - Khách yêu cầu hỗ trợ và chấp nhận đúng nhân viên (Priority: P1)

Khách đã đăng nhập bấm yêu cầu hỗ trợ và chờ. Khi nhân viên kết nối, khách thấy tên nhân viên đó và chọn đồng ý hoặc từ chối. Chỉ khi khách đồng ý thì nhân viên mới xem và điều khiển được máy.

**Why this priority**: Đây là phiên hỗ trợ thực tế. Đăng nhập mà không có bước yêu cầu và chấp nhận thì khách không kiểm soát được ai đang vào máy.

**Independent Test**: Một khách đã đăng nhập tạo một yêu cầu. Một nhân viên nhận yêu cầu và kết nối. Kiểm tra hộp thoại trên máy khách, cả nhánh đồng ý và nhánh từ chối.

**Acceptance Scenarios**:

1. **Given** khách đã đăng nhập và chưa có yêu cầu nào đang mở, **When** khách bấm yêu cầu hỗ trợ, **Then** yêu cầu xuất hiện ở trạng thái đang chờ, gắn với đúng tài khoản ezID và đúng máy đó.
2. **Given** một yêu cầu đang chờ, **When** khách bấm yêu cầu thêm lần nữa trên cùng máy, **Then** hệ thống không tạo yêu cầu thứ hai; khách vẫn thấy yêu cầu đang chờ.
3. **Given** nhân viên bắt đầu kết nối vào yêu cầu đó, **When** hộp thoại hiện trên máy khách, **Then** hộp thoại ghi tên nhân viên đang xin vào và có lựa chọn đồng ý hoặc từ chối.
4. **Given** hộp thoại đang hiện, **When** khách bấm từ chối, **Then** nhân viên không xem được màn hình và không điều khiển được máy.
5. **Given** hộp thoại đang hiện, **When** khách bấm đồng ý, **Then** nhân viên thấy màn hình máy khách và điều khiển được cho tới khi một trong hai bên kết thúc phiên.
6. **Given** một yêu cầu của máy A, **When** có người cố kết nối vào máy B bằng yêu cầu đó, **Then** kết nối bị từ chối và máy B không hiện hộp thoại.

---

### User Story 3 - Nhân viên xử lý hàng đợi hỗ trợ (Priority: P1)

Nhân viên đăng nhập ezID, thấy các yêu cầu đang chờ, và chỉ kết nối được khi chọn một yêu cầu. Nhân viên không có ô nhập mã máy để tự ý vào một máy bất kỳ.

**Why this priority**: Hàng đợi là cách duy nhất để nhân viên bắt đầu hỗ trợ. Thiếu hàng đợi thì kiểm soát “chỉ vào máy đang yêu cầu” không tồn tại.

**Independent Test**: Đăng nhập bằng tài khoản nhân viên và bằng tài khoản khách. Chỉ tài khoản nhân viên thấy hàng đợi. Chọn một yêu cầu đang chờ và hoàn tất kết nối sau khi khách đồng ý.

**Acceptance Scenarios**:

1. **Given** tài khoản ezID có vai trò nhân viên hỗ trợ, **When** nhân viên đăng nhập, **Then** ứng dụng hiển thị danh sách yêu cầu đang chờ, gồm tên khách, máy, và thời điểm yêu cầu.
2. **Given** tài khoản ezID không có vai trò nhân viên hỗ trợ, **When** người đó đăng nhập, **Then** ứng dụng hiển thị luồng của khách (yêu cầu hỗ trợ) và không hiển thị hàng đợi của toàn bộ khách khác.
3. **Given** một yêu cầu đang chờ, **When** nhân viên bấm kết nối, **Then** hệ thống chỉ xin vào đúng máy của yêu cầu đó.
4. **Given** không có yêu cầu đang chờ cho một máy, **When** nhân viên tìm cách kết nối tới máy đó, **Then** hệ thống từ chối.
5. **Given** nhân viên đã dùng lượt kết nối của một yêu cầu, **When** dùng lại đúng lượt đó cho lần kết nối sau, **Then** hệ thống từ chối và nhân viên phải lấy lượt kết nối mới từ yêu cầu còn hiệu lực.

---

### User Story 4 - Kết thúc hỗ trợ và hết quyền vào máy (Priority: P2)

Khách hoặc nhân viên kết thúc phiên. Sau đó nhân viên không còn điều khiển máy. Yêu cầu chuyển sang đã đóng và không dùng để vào lại.

**Why this priority**: Phiên hỗ trợ phải có điểm dừng rõ, nếu không quyền vào máy kéo dài quá việc khách đang cần.

**Independent Test**: Hoàn tất một phiên được khách chấp nhận, đóng từ phía khách và từ phía nhân viên ở hai lần thử riêng, rồi thử kết nối lại bằng yêu cầu đã đóng.

**Acceptance Scenarios**:

1. **Given** phiên đang điều khiển, **When** khách hoặc nhân viên kết thúc, **Then** nhân viên hết quyền xem màn hình và điều khiển trong vòng một phút.
2. **Given** yêu cầu đã đóng, **When** nhân viên chọn lại yêu cầu đó, **Then** hệ thống không cấp kết nối mới.
3. **Given** khách vẫn đăng nhập sau khi đóng yêu cầu, **When** khách chưa tạo yêu cầu mới, **Then** không nhân viên nào kết nối được vào máy.

---

### User Story 5 - Nhận biết sản phẩm và lấy được mã nguồn bản phát hành (Priority: P3)

Người dùng thấy tên ezCloud Remote. Phần giới thiệu nói rõ sản phẩm là bản sửa đổi của RustDesk, nêu giấy phép công khai của dự án gốc, và chỉ tới mã nguồn của đúng bản đang cài khi bản đó đã được công bố.

**Why this priority**: Nghĩa vụ giữ bản quyền và giấy phép đi cùng việc phát hành, nhưng không chặn việc hỗ trợ khách ở bản dùng nội bộ đầu tiên.

**Independent Test**: Mở phần giới thiệu của bản đã đóng gói. Đối chiếu tên sản phẩm, dòng ghi nhận RustDesk, và liên kết mã nguồn với đúng bản đang cài.

**Acceptance Scenarios**:

1. **Given** người dùng mở ứng dụng, **When** xem tên cửa sổ và phần giới thiệu, **Then** tên sản phẩm là ezCloud Remote, không trình bày như sản phẩm RustDesk chính thức.
2. **Given** phần giới thiệu, **When** người dùng đọc ghi nhận nguồn gốc, **Then** có dòng cho biết đây là bản đã sửa của RustDesk, có ngày sửa, và có tên giấy phép công khai của dự án gốc.
3. **Given** một bản đã phát cho khách hoặc nhân viên, **When** người nhận bản đó yêu cầu mã nguồn, **Then** họ lấy được mã nguồn tương ứng với đúng bản đó, bao gồm phần đã sửa để đăng nhập ezID và xếp hàng hỗ trợ.

---

### User Story 6 - Quản lý server theo Central ACL (Priority: P2)

Người quản trị mở phần quản lý (danh sách yêu cầu hỗ trợ của mọi người, đóng yêu cầu, xem máy đang chờ, cấu hình dịch vụ). Họ đăng nhập ezID. Từng thao tác được phép hoặc bị từ chối theo quyền trên Central ACL. Ứng dụng không có trang riêng để gán vai trò.

**Why this priority**: Phần quản lý nhìn thấy dữ liệu của nhiều khách. Quyền phải do ACL quyết định, cùng cách các hệ thống nội bộ ezCloud khác đang làm. Luồng khách xin hỗ trợ ở US1–US3 vẫn chạy được trước khi màn quản lý có.

**Independent Test**: Đăng nhập ezID bằng ba tài khoản: không có quyền quản lý, chỉ được xem, được đóng yêu cầu. Với ACL không liên lạc được, mọi thao tác quản lý bị từ chối trừ trang kết nối ACL.

**Acceptance Scenarios**:

1. **Given** người đã đăng nhập ezID nhưng ACL không cấp quyền xem, **When** họ mở danh sách yêu cầu của mọi khách, **Then** hệ thống từ chối và không trả dữ liệu.
2. **Given** ACL cấp quyền xem nhưng không cấp quyền thay đổi, **When** người đó mở danh sách, **Then** họ thấy yêu cầu; **When** họ đóng yêu cầu của người khác, **Then** hệ thống từ chối.
3. **Given** ACL cấp quyền thay đổi, **When** người đó đóng một yêu cầu đang chờ, **Then** yêu cầu chuyển sang đã đóng và không dùng để kết nối nữa.
4. **Given** một route quản lý mới chưa được khai báo cần quyền gì, **When** có người gọi route đó, **Then** hệ thống từ chối.
5. **Given** chế độ đang bắt buộc và Central ACL không trả lời quá thời gian cho phép, **When** người quản trị làm một thao tác quản lý, **Then** hệ thống từ chối thay vì cho qua.
6. **Given** URL hoặc khóa kết nối ACL bị sai, **When** người có quyền quản trị cục bộ mở trang cấu hình ACL, **Then** họ vẫn sửa được kết nối. Trang này không phụ thuộc quyền trên ACL.
7. **Given** ứng dụng desktop của khách hoặc nhân viên hỗ trợ, **When** họ yêu cầu hỗ trợ hoặc nhận một yêu cầu trong hàng đợi, **Then** các bước đó không hỏi Central ACL.

---

### Edge Cases

- Đăng nhập ezID hết hạn giữa lúc đang chờ hỗ trợ: máy rời trạng thái sẵn sàng, yêu cầu đang chờ được đóng, nhân viên không kết nối được nữa.
- Khách mất mạng rồi có mạng lại khi vẫn còn phiên đăng nhập hợp lệ: máy trở lại trạng thái sẵn sàng của đúng yêu cầu còn mở, không tạo yêu cầu trùng.
- Hai nhân viên cùng bấm kết nối một yêu cầu: chỉ một lượt kết nối có hiệu lực; lượt còn lại bị từ chối.
- Khách đăng xuất trong lúc hộp thoại chấp nhận đang hiện: hộp thoại đóng, kết nối không được thiết lập.
- Tài khoản ezID đăng nhập đúng nhưng không đủ vai trò nhân viên: không thấy hàng đợi và không tự kết nối tới máy người khác.
- Người dùng cài bản điều khiển từ xa gốc và trỏ vào hệ thống của ezCloud: máy đó không được nhận hỗ trợ và không kết nối được vào máy khách ezCloud Remote.
- Khách bấm đồng ý nhầm rồi muốn dừng: khách kết thúc phiên ngay và nhân viên hết quyền điều khiển.
- ACL trả quyền rồi người bị gỡ quyền: lần kiểm tra kế tiếp từ chối thao tác quản lý mới; phiên điều khiển đang mở không bị cắt bởi lần kiểm tra này.
- Bật chế độ bắt buộc khi chính người bật không được ACL cấp quyền nào: hệ thống không cho bật.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hệ thống MUST cho phép khách và nhân viên đăng nhập bằng tài khoản ezID đã có. Hệ thống MUST NOT tự tạo tài khoản ezID.
- **FR-002**: Hệ thống MUST coi định danh ổn định của ezID là khóa của người dùng, kể cả khi email của người đó đổi.
- **FR-003**: Hệ thống MUST phân biệt khách và nhân viên hỗ trợ bằng vai trò trên tài khoản ezID. Tên vai trò nhân viên do ezCloud cấu hình khi ezID cung cấp claim vai trò.
- **FR-004**: Máy của khách MUST chỉ ở trạng thái nhận hỗ trợ sau khi đăng nhập ezID thành công và phiên đăng nhập còn hiệu lực.
- **FR-005**: Hệ thống MUST ngừng nhận kết nối hỗ trợ mới trong vòng một phút sau khi khách đăng xuất hoặc phiên đăng nhập hết hiệu lực.
- **FR-006**: Khách MUST tạo được một yêu cầu hỗ trợ cho máy đang đăng nhập. Một máy MUST NOT có hai yêu cầu đang chờ hoặc đang hỗ trợ cùng lúc.
- **FR-007**: Nhân viên hỗ trợ MUST thấy hàng đợi các yêu cầu đang chờ, gồm tên khách, máy và thời điểm tạo.
- **FR-008**: Nhân viên MUST chỉ bắt đầu kết nối từ một yêu cầu đang chờ hoặc đang hỗ trợ. Hệ thống MUST NOT cung cấp cách gõ mã máy hoặc địa chỉ máy để vào trực tiếp.
- **FR-009**: Mỗi lượt kết nối MUST chỉ có hiệu lực cho đúng một yêu cầu, đúng một máy, và chỉ dùng được một lần. Lượt hết hạn hoặc đã dùng MUST bị từ chối.
- **FR-010**: Trước khi nhân viên xem hoặc điều khiển máy, khách MUST thấy tên nhân viên và MUST chủ động chấp nhận. Từ chối hoặc không trả lời trước khi yêu cầu bị hủy MUST không mở phiên điều khiển.
- **FR-011**: Hệ thống MUST NOT cho phép vào máy khách khi không có người chấp nhận tại máy đó.
- **FR-012**: Khách hoặc nhân viên MUST kết thúc được phiên đang mở. Yêu cầu đã đóng MUST NOT dùng để kết nối lại.
- **FR-013**: Người không có vai trò nhân viên hỗ trợ MUST NOT xem hàng đợi của người khác và MUST NOT chủ động kết nối tới máy của người khác.
- **FR-014**: Một bản điều khiển từ xa không thuộc ezCloud Remote MUST NOT đăng ký nhận hỗ trợ trên hệ thống ezCloud và MUST NOT kết nối vào máy khách của ezCloud Remote.
- **FR-015**: Ứng dụng MUST hiển thị tên ezCloud Remote và MUST ghi trong phần giới thiệu rằng đây là bản đã sửa của RustDesk, kèm giấy phép công khai của dự án gốc.
- **FR-016**: Khi ezCloud phát một bản cho khách hoặc nhân viên, ezCloud MUST cung cấp mã nguồn của đúng bản đó cho người nhận, gồm các sửa đổi của bản phát hành.
- **FR-017**: Hệ thống MUST NOT thu phí giấy phép phần mềm. ezCloud MAY tiếp tục hỗ trợ khách trong quan hệ dịch vụ sẵn có.
- **FR-018**: Khi khách đang được điều khiển, khách MUST nhìn thấy đang có phiên hỗ trợ và MUST dừng được phiên đó từ máy của mình.
- **FR-019**: Phần quản lý MUST cho người vận hành đăng nhập bằng ezID, rồi MUST hỏi Central ACL để quyết định từng thao tác. ezID MUST NOT được dùng thay cho quyết định quyền của phần quản lý.
- **FR-020**: Ứng dụng MUST giữ danh mục quyền quản lý trong mã nguồn và MUST NOT có trang gán vai trò riêng. Việc gán vai trò nằm trên Central ACL.
- **FR-021**: Mỗi thao tác quản lý MUST gắn với một quyền đã khai báo. Thao tác chưa khai báo MUST bị từ chối.
- **FR-022**: Khi không hỏi được Central ACL ở chế độ bắt buộc, phần quản lý MUST từ chối thao tác. Thiếu quyền và không liên lạc được ACL MUST là hai kết quả khác nhau để người vận hành phân biệt.
- **FR-023**: Trang cấu hình kết nối tới Central ACL MUST không phụ thuộc quyền trên ACL. Hệ thống MUST NOT cho bật chế độ bắt buộc nếu người đang bật không nhận được quyền nào từ ACL. MUST có cách tắt khẩn cấp chế độ bắt buộc mà không cần ACL trả lời.
- **FR-024**: Màn hình quản lý MUST chỉ hiện thao tác mà backend xác nhận là được phép. Màn hình MUST NOT tự gọi Central ACL và MUST NOT nhận khóa kết nối ACL.
- **FR-025**: Luồng khách đăng nhập, tạo yêu cầu, chấp nhận kết nối, và luồng nhân viên nhận yêu cầu trên ứng dụng desktop MUST NOT phụ thuộc Central ACL.
- **FR-026**: Cửa sổ xem log trên chính máy chủ MUST NOT được coi là phần quản lý đa người dùng và MUST NOT được mở ra cho người dùng từ xa.

### Key Entities

- **Người dùng**: Một tài khoản ezID, là khách hoặc nhân viên hỗ trợ. Khóa là định danh ezID, không phải email.
- **Máy**: Máy đang chạy ezCloud Remote, gắn với người dùng đang đăng nhập trên máy đó.
- **Yêu cầu hỗ trợ**: Một lần khách xin hỗ trợ trên một máy. Trạng thái: đang chờ, đang hỗ trợ, đã đóng. Một máy chỉ có một yêu cầu đang chờ hoặc đang hỗ trợ.
- **Lượt kết nối**: Quyền ngắn hạn để một nhân viên xin vào đúng một máy của một yêu cầu. Hết hạn hoặc dùng một lần thì mất hiệu lực.
- **Phiên điều khiển**: Khoảng thời gian nhân viên xem và điều khiển máy sau khi khách đã chấp nhận.
- **Quyền quản lý**: Hành động trên phần quản lý, khai báo trong mã nguồn. Ai được quyền nào do Central ACL gán, không lưu trong ứng dụng.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% máy chưa đăng nhập ezID bị từ chối khi có người cố kết nối hỗ trợ.
- **SC-002**: Khách đã có tài khoản ezID hoàn tất đăng nhập và tạo được một yêu cầu hỗ trợ trong vòng 3 phút ở điều kiện mạng bình thường, không phải đọc hay gửi mã máy cho nhân viên.
- **SC-003**: 100% phiên điều khiển thành công đều có bước khách thấy tên nhân viên và bấm chấp nhận trước khi nhân viên xem được màn hình.
- **SC-004**: 100% lần từ chối hoặc lần dùng lại lượt kết nối đã dùng đều không dẫn tới phiên điều khiển.
- **SC-005**: Sau khi đăng xuất hoặc đóng phiên, nhân viên hết quyền điều khiển trong vòng một phút.
- **SC-006**: Trong bản phát cho người dùng, phần giới thiệu ghi đúng tên ezCloud Remote và ghi nhận RustDesk cùng giấy phép của dự án gốc trên mọi máy được kiểm.
- **SC-007**: 100% thao tác quản lý của tài khoản không được ACL cấp quyền bị từ chối, và 100% lần ACL không trả lời ở chế độ bắt buộc cũng bị từ chối.
- **SC-008**: Người chỉ có quyền xem hoàn tất mở danh sách yêu cầu và bị từ chối khi đóng yêu cầu, trong một phiên thử không cần cấu hình lại ứng dụng.

## Assumptions

- Khách và nhân viên đã có tài khoản ezID. Việc cấp tài khoản nằm ngoài phạm vi.
- Vai trò nhân viên hỗ trợ là một claim vai trò của ezID. Giá trị cụ thể do team ezID xác nhận và được cấu hình, không gắn cứng trong đặc tả này.
- Bản đầu dùng trên máy tính để bàn của khách và của nhân viên (Windows và macOS). Ứng dụng điện thoại nằm ngoài phạm vi bản này.
- Một nhân viên hỗ trợ một máy tại một thời điểm. Nhiều nhân viên cùng điều khiển một máy nằm ngoài phạm vi.
- ezCloud tự vận hành hạ tầng kết nối. Máy khách không dùng hạ tầng công cộng của RustDesk.
- Phát triển diễn ra trên git nội bộ. Khi bản được phát cho khách hoặc nhân viên, mã nguồn của đúng bản đó được publish công khai.
- Phần quản lý trong bản này là các thao tác vận hành trên dịch vụ hỗ trợ (xem mọi yêu cầu, đóng yêu cầu, xem máy đang chờ, cấu hình kết nối ACL). Ghi hình phiên và sổ địa chỉ dùng chung vẫn ngoài phạm vi.
- Ứng dụng chưa được đăng ký trên Central ACL và chưa có API key. Super Admin ACL đăng ký ứng dụng và chỉ định App Admin. App Admin tạo key. Key không nằm trong git.
- Chưa có bảng phân quyền cũ để nhập lên ACL. Không có bước chuyển vai trò từ hệ thống cũ.
- Cửa sổ log cục bộ đi kèm `rustdesk-server` không phải UI quản lý.
- Đặc tả này mô tả hành vi người dùng nhìn thấy. Cách gắn đăng nhập vào phần mềm điều khiển từ xa hiện có được quyết định ở bước lập kế hoạch, sau khi đặc tả được duyệt.
